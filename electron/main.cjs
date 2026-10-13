// Proceso principal de la app de escritorio de Pelacord.
//
// Sin servidor y sin configuración manual:
//   - Descubre a los demás peers automáticamente por broadcast UDP sobre la red de ZeroTier.
//   - Abre un servidor WebSocket de señalización en el puerto PORT.
//   - Se conecta directo a cada peer descubierto y rutea presencia y señales WebRTC.
//
// Nadie edita nada: cada uno abre la app, pone su nombre y ya se ve con los demás.

const {app, BrowserWindow, desktopCapturer, globalShortcut, ipcMain, Menu, net, protocol, safeStorage, session, shell, Notification, nativeImage, Tray, webContents} = require('electron');
const path = require('node:path');
const os = require('node:os');
const dgram = require('node:dgram');
const http = require('node:http');
const https = require('node:https');
const fs = require('node:fs');
const crypto = require('node:crypto');
const {spawn} = require('node:child_process');
const {pathToFileURL} = require('node:url');
const {WebSocketServer, WebSocket} = require('ws');
const {startUpdateLoop} = require('./update-loop.cjs');

let autoUpdater = null;
try {
	({autoUpdater} = require('electron-updater'));
} catch {
	autoUpdater = null;
}

const PORT = Number(process.env.PELACORD_PORT || 7788);
const DISCOVERY_PORT = Number(process.env.PELACORD_DISCOVERY_PORT || 7787);
const DEV_URL = process.env.PELACORD_DEV_URL || 'http://localhost:5175';

// WebRTC: sin esto, Chromium esconde las IPs locales con mDNS y los peers no se ven por ZeroTier.
app.commandLine.appendSwitch('disable-features', 'WebRtcHideLocalIpsWithMdns');

// Protocolo propio para reproducir videos cacheados temporalmente.
protocol.registerSchemesAsPrivileged([
	{scheme: 'pelacord-media', privileges: {stream: true, bypassCSP: true, supportFetchAPI: true}},
]);

// Codificación por hardware (NVENC / Media Foundation) para no cargar la CPU al compartir.
app.commandLine.appendSwitch('ignore-gpu-blocklist');
app.commandLine.appendSwitch('enable-gpu-rasterization');
app.commandLine.appendSwitch('enable-zero-copy');
app.commandLine.appendSwitch('enable-accelerated-video-encode');
app.commandLine.appendSwitch('enable-features', 'AcceleratedVideoEncoder,AcceleratedVideoDecodeLinuxGL');

let mainWindow = null;
let tray = null;
/** Cerrar la ventana la esconde (como Discord); sólo se sale de verdad desde la bandeja. */
let isQuitting = false;
let myPeerId = null;
let myName = '';
let listenPort = PORT;

/** peerId -> socket */
const peers = new Map();
/** socket -> peerId */
const socketIds = new Map();
/** conexiones salientes (para presentarse cuando el nombre ya está listo) */
const outgoingSockets = new Set();
/** peerId -> {host, port} ya intentado */
const knownPeers = new Map();

function sendHello(socket) {
	if (myPeerId && socket.readyState === WebSocket.OPEN) {
		socket.send(JSON.stringify({type: 'hello', from: myPeerId, name: myName}));
	}
}

function sendToRenderer(channel, payload) {
	if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send(channel, payload);
}

/** Quita una conexión y avisa a la interfaz si el peer ya no tiene ninguna otra. */
function dropSocket(socket) {
	const id = socketIds.get(socket);
	socketIds.delete(socket);
	if (!id) return;
	// Si queda otra conexión viva con el mismo peer, re-apuntar el envío a esa.
	let replacement = null;
	for (const [otherSocket, otherId] of socketIds) {
		if (otherId === id && otherSocket.readyState === WebSocket.OPEN) {
			replacement = otherSocket;
			break;
		}
	}
	if (replacement) {
		peers.set(id, replacement);
		return;
	}
	peers.delete(id);
	sendToRenderer('pelacord:peer-left', {id});
}

// ---------- Interfaces de red (ZeroTier primero) ----------

function localInterfaces() {
	const result = [];
	const interfaces = os.networkInterfaces();
	for (const [name, addresses] of Object.entries(interfaces)) {
		if (!addresses) continue;
		for (const address of addresses) {
			if (address.family !== 'IPv4' || address.internal) continue;
			result.push({
				name,
				address: address.address,
				netmask: address.netmask,
				isZeroTier: /zerotier|^zt/i.test(name),
			});
		}
	}
	return result;
}

function broadcastAddress(ip, netmask) {
	const ipParts = ip.split('.').map(Number);
	const maskParts = netmask.split('.').map(Number);
	return ipParts.map((part, index) => (part & maskParts[index]) | (~maskParts[index] & 255)).join('.');
}

function broadcastTargets() {
	const all = localInterfaces();
	const zt = all.filter((entry) => entry.isZeroTier);
	const chosen = zt.length > 0 ? zt : all;
	const targets = new Set();
	for (const entry of chosen) {
		targets.add(broadcastAddress(entry.address, entry.netmask));
	}
	targets.add('255.255.255.255');
	return [...targets];
}

// ---------- Descubrimiento automático (UDP broadcast) ----------

let discoverySocket = null;

function startDiscovery() {
	discoverySocket = dgram.createSocket({type: 'udp4', reuseAddr: true});
	discoverySocket.on('error', (error) => console.error('[pelacord] discovery error', error.message));
	discoverySocket.on('message', (buffer, rinfo) => {
		let message;
		try {
			message = JSON.parse(buffer.toString());
		} catch {
			return;
		}
		if (!message || message.type !== 'announce' || !message.id) return;
		if (message.id === myPeerId) return;
		if (!knownPeers.has(message.id)) {
			knownPeers.set(message.id, {host: rinfo.address, port: Number(message.port || PORT)});
			console.log(`[pelacord] peer descubierto: ${message.name || message.id} @ ${rinfo.address}`);
			connectPeer(message.id, rinfo.address, Number(message.port || PORT));
		}
	});
	discoverySocket.bind(DISCOVERY_PORT, () => {
		discoverySocket.setBroadcast(true);
		console.log(`[pelacord] descubrimiento escuchando en udp/${DISCOVERY_PORT}`);
	});
	setInterval(announce, 3000);
}

function announce() {
	if (!myPeerId || !discoverySocket) return;
	const payload = Buffer.from(JSON.stringify({type: 'announce', id: myPeerId, name: myName, port: listenPort}));
	for (const target of broadcastTargets()) {
		discoverySocket.send(payload, 0, payload.length, DISCOVERY_PORT, target, () => {});
	}
	// Re-presentarse en las conexiones salientes (por si el saludo inicial se perdió).
	for (const socket of outgoingSockets) sendHello(socket);
}

// ---------- Señalización (WebSocket) ----------

/**
 * Ids de mensajes ya vistos.
 *
 * La malla REENVÍA: un mensaje dirigido puede llegar dos veces (directo y por un tercero que lo
 * retransmitió). Sin esto, el mismo comando se aplicaba DOS veces — a la Jam le duplicaba la cola
 * (agregabas 12 canciones y quedaban 24) — y las señales de la llamada llegaban repetidas, que es
 * lo que rompía el WebRTC ("Called in wrong state: stable").
 *
 * Con 2 personas no pasaba: no había un tercero que reenviara. Apareció al ser 3.
 */
const seenMessages = new Map();

function rememberMessage(msgId) {
	if (!msgId) return true;
	const now = Date.now();
	if (seenMessages.has(msgId)) return false;
	seenMessages.set(msgId, now);
	if (seenMessages.size > 4000) {
		for (const [key, when] of seenMessages) {
			if (now - when > 120000) seenMessages.delete(key);
		}
	}
	return true;
}

function broadcast(message, exceptSocket) {
	// Cada mensaje sale con su id. El que lo reenvía mantiene el MISMO id, así el destinatario
	// puede descartar la copia que le llegó de más.
	if (message && !message.msgId) message.msgId = crypto.randomUUID();
	const data = JSON.stringify(message);
	for (const socket of peers.values()) {
		if (socket === exceptSocket) continue;
		if (socket.readyState === WebSocket.OPEN) socket.send(data);
	}
}

function handleMessage(socket, raw) {
	let message;
	try {
		message = JSON.parse(raw.toString());
	} catch {
		return;
	}
	if (!message || typeof message.type !== 'string') return;
	// Mensaje repetido: se descarta ACÁ, antes de entregarlo o de aplicarlo.
	if (message.msgId && !rememberMessage(message.msgId)) return;

	// Registrar al remitente con cualquier mensaje entrante. Así el envío de vuelta queda habilitado
	// aunque la presentación (hello) se haya perdido.
	if (typeof message.from === 'string' && message.from !== myPeerId) {
		if (!peers.has(message.from)) {
			console.log(`[pelacord] registrado peer ${message.from} (${message.type})`);
		}
		peers.set(message.from, socket);
		socketIds.set(socket, message.from);
	}

	if (message.type === 'hello') return;

	if (message.type === 'presence') {
		// Ignora el eco de la propia presencia: en una malla bidireccional vuelve por el otro lado.
		if (message.from === myPeerId) return;
		sendToRenderer('pelacord:presence', {from: message.from, payload: message.payload});
		broadcast(message, socket);
		return;
	}

	// Música de la Jam: viaja por la MALLA (broadcast), igual que la presencia. Nada de Firestore:
	// es tiempo real y no puede gastar cuota ni depender de que internet funcione.
	if (message.type === 'music') {
		if (message.from === myPeerId) return;
		sendToRenderer('pelacord:music', {from: message.from, payload: message.payload});
		broadcast(message, socket);
		return;
	}

	// Salas de Pelaflix: viajan por la MALLA (broadcast), igual que la música y la presencia. Es
	// tiempo real (quién está mirando qué y por dónde va), así que no puede gastar cuota ni depender
	// de internet: nada de Firebase.
	if (message.type === 'movie-room') {
		if (message.from === myPeerId) return;
		sendToRenderer('pelacord:movie-room', {from: message.from, payload: message.payload});
		broadcast(message, socket);
		return;
	}

	if (message.type === 'signal') {
		if (message.to === myPeerId) {
			sendToRenderer('pelacord:signal', {from: message.from, payload: message.payload});
			return;
		}
		if (message.to && peers.has(message.to)) {
			const target = peers.get(message.to);
			if (target.readyState === WebSocket.OPEN) target.send(JSON.stringify(message));
			return;
		}
		broadcast(message, socket);
		return;
	}

	// El log de mensajes: la reconciliación del historial entre peers. Si viene dirigido, se
	// entrega al destinatario (y si no lo tengo identificado, lo reenvía el que lo originó); si no,
	// se difunde como la Jam.
	if (message.type === 'messages') {
		if (message.to) {
			if (message.to === myPeerId) {
				sendToRenderer('pelacord:messages', {from: message.from, payload: message.payload});
				return;
			}
			if (peers.has(message.to)) {
				const target = peers.get(message.to);
				if (target.readyState === WebSocket.OPEN) {
					target.send(JSON.stringify(message));
					return;
				}
			}
			// Sólo lo retransmite el que lo originó, para que no se arme un bucle.
			if (message.from === myPeerId) broadcast(message, socket);
			return;
		}
		if (message.from === myPeerId) return;
		sendToRenderer('pelacord:messages', {from: message.from, payload: message.payload});
		broadcast(message, socket);
		return;
	}

	// Comandos para otro peer (mover de canal de voz, y lo que venga después).
	if (message.type === 'command') {
		if (message.to === myPeerId) {
			sendToRenderer('pelacord:command', {from: message.from, payload: message.payload});
			return;
		}
		if (message.to && peers.has(message.to)) {
			const target = peers.get(message.to);
			if (target.readyState === WebSocket.OPEN) {
				target.send(JSON.stringify(message));
				return;
			}
		}
		// Si no lo tengo identificado (o el socket no está abierto), se manda a todos: el que
		// sea el destinatario lo aplica y el resto lo ignora. Sólo lo reenvía el que lo originó,
		// para que no se arme un bucle de retransmisiones.
		if (message.from === myPeerId) broadcast(message, socket);
	}
}

function createSignallingServer(port) {
	const wss = new WebSocketServer({port, host: '0.0.0.0'});
	wss.on('connection', (socket) => {
		socket.on('message', (raw) => handleMessage(socket, raw));
		socket.on('close', () => dropSocket(socket));
		socket.on('error', () => {});
	});
	return wss;
}

function onListening(wss) {
	listenPort = wss.address().port;
	console.log(`[pelacord] señalización escuchando en tcp/${listenPort}`);
	announce();
}

function startServer() {
	let wss = createSignallingServer(PORT);
	wss.on('listening', () => onListening(wss));
	wss.on('error', (error) => {
		if (error.code === 'EADDRINUSE') {
			console.warn(`[pelacord] tcp/${PORT} ocupado; usando un puerto libre`);
			wss = createSignallingServer(0);
			wss.on('listening', () => onListening(wss));
			wss.on('error', (fallbackError) => console.error('[pelacord] signalling error', fallbackError.message));
			return;
		}
		console.error('[pelacord] signalling error', error.message);
	});
}

function connectPeer(peerId, host, port) {
	if (peers.has(peerId)) return;
	const socket = new WebSocket(`ws://${host}:${port}`);
	socket.on('open', () => {
		outgoingSockets.add(socket);
		sendHello(socket);
		console.log(`[pelacord] conectado a ${host}:${port}`);
	});
	socket.on('message', (raw) => handleMessage(socket, raw));
	socket.on('close', () => {
		outgoingSockets.delete(socket);
		dropSocket(socket);
		knownPeers.delete(peerId);
		setTimeout(() => {
			if (!peers.has(peerId)) connectPeer(peerId, host, port);
		}, 3000);
	});
	socket.on('error', () => {});
}

// ---------- Ventana ----------

/** Ruta del ícono de la app: en la instalada va a resources, en dev al repo. */
function appIconPath() {
	const packaged = process.resourcesPath ? path.join(process.resourcesPath, 'icon.ico') : null;
	if (packaged && fs.existsSync(packaged)) return packaged;
	const dev = path.join(__dirname, '..', 'build', 'icon.ico');
	if (fs.existsSync(dev)) return dev;
	const png = path.join(__dirname, '..', 'build', 'icons', '32x32.png');
	return fs.existsSync(png) ? png : null;
}

function createWindow() {
	const iconPath = appIconPath();
	// Si arrancó con la PC (--hidden), se abre directo en la bandeja sin molestar.
	const startHidden = process.argv.includes('--hidden');
	mainWindow = new BrowserWindow({
		width: 1280,
		height: 800,
		minWidth: 940,
		show: !startHidden,
		backgroundColor: '#0b0912',
		autoHideMenuBar: true,
		// Barra de título integrada al tema: sin el texto "Pelacord" y con los botones nativos.
		titleBarStyle: 'hidden',
		titleBarOverlay: {color: '#1a181e', symbolColor: '#b1acbb', height: 40},
		icon: iconPath ?? undefined,
		webPreferences: {
			preload: path.join(__dirname, 'preload.cjs'),
			contextIsolation: true,
			nodeIntegration: false,
			autoplayPolicy: 'no-user-gesture-required',
			// El reproductor de películas usa <webview>: es la única forma de controlar el video de
			// otro origen (leer su tiempo, mandarle play/pausa/seek) y de taparle los clics.
			webviewTag: true,
		},
	});
	/**
	 * Reglas para el <webview> del reproductor de películas.
	 *
	 * Los embeds de películas abren publicidad al hacer clic y a veces al arrancar. Acá se cierra
	 * esa puerta: sin ventanas nuevas, sin navegar afuera, sin Node, y con nuestro puente cargado
	 * (que además deja el video sin clics).
	 */
	mainWindow.webContents.on('will-attach-webview', (event, webPreferences, params) => {
		delete webPreferences.preloadURL;
		webPreferences.nodeIntegration = false;
		webPreferences.contextIsolation = true;
		webPreferences.preload = path.join(__dirname, 'movie-preload.cjs');
		if (!/^https:\/\/([a-z0-9-]+\.)?cinesrc\.st\//i.test(String(params.src || ''))) event.preventDefault();
	});
	// Nada de ventanas emergentes desde el reproductor (ni desde nadie que no sea la app).
	app.on('web-contents-created', (_event, contents) => {
		if (contents.getType() !== 'webview') return;
		contents.setWindowOpenHandler(() => ({action: 'deny'}));
		contents.on('will-navigate', (event, url) => {
			if (!/^https:\/\/([a-z0-9-]+\.)?cinesrc\.st\//i.test(url)) event.preventDefault();
		});
	});
	mainWindow.webContents.setWindowOpenHandler(({url}) => {
		void shell.openExternal(url);
		return {action: 'deny'};
	});
	// Cerrar (la X) esconde la ventana: la app sigue viva en la bandeja.
	// Si la bandeja no existe, cerrar cierra DE VERDAD (nunca dejar al usuario encerrado).
	mainWindow.on('close', (event) => {
		if (isQuitting || !tray) return;
		event.preventDefault();
		mainWindow.hide();
	});
	if (process.env.PELACORD_DEV_URL || !app.isPackaged) {
		void mainWindow.loadURL(DEV_URL);
	} else {
		void mainWindow.loadFile(path.join(__dirname, '..', 'dist', 'index.html'));
	}
}

function showWindow() {
	if (!mainWindow || mainWindow.isDestroyed()) return;
	if (mainWindow.isMinimized()) mainWindow.restore();
	mainWindow.show();
	mainWindow.focus();
}

/** Registra (o saca) el arranque automático con Windows, abierto en la bandeja. */
function setLoginItem(enabled) {
	if (!app.isPackaged) return;
	try {
		app.setLoginItemSettings({openAtLogin: Boolean(enabled), args: ['--hidden']});
	} catch (error) {
		console.error('[pelacord] login item error', String(error));
	}
}

function loginItemEnabled() {
	if (!app.isPackaged) return false;
	try {
		return app.getLoginItemSettings().openAtLogin;
	} catch {
		return false;
	}
}

function createTray() {
	const iconPath = appIconPath();
	if (!iconPath) {
		console.warn('[pelacord] sin ícono: no se crea la bandeja (cerrar cerrará la app)');
		return;
	}
	try {
		tray = new Tray(iconPath);
		tray.setToolTip('Pelacord');
		const refresh = () => {
			tray.setContextMenu(
				Menu.buildFromTemplate([
					{label: 'Abrir Pelacord', click: () => showWindow()},
					{type: 'separator'},
					{
						label: 'Abrir al prender la PC',
						type: 'checkbox',
						checked: loginItemEnabled(),
						click: (item) => {
							setLoginItem(item.checked);
							refresh();
						},
					},
					{type: 'separator'},
					{
						label: 'Salir',
						click: () => {
							isQuitting = true;
							app.quit();
						},
					},
				]),
			);
		};
		refresh();
		// Click en el ícono (o doble click) trae la ventana al frente.
		tray.on('click', () => showWindow());
	} catch (error) {
		console.error('[pelacord] tray error', String(error));
	}
}

// ---------- Puente con la interfaz ----------

ipcMain.on('pelacord:hello', (_event, identity) => {
	if (identity && typeof identity.id === 'string') {
		myPeerId = identity.id;
		myName = identity.name || '';
		// Presentarse en todas las conexiones ya abiertas (pudieron abrirse antes de tener nombre).
		for (const socket of outgoingSockets) sendHello(socket);
		broadcast({type: 'hello', from: myPeerId, name: myName});
		announce();
	}
});

ipcMain.on('pelacord:presence', (_event, payload) => {
	if (!myPeerId || !payload) return;
	broadcast({type: 'presence', from: myPeerId, payload});
});

ipcMain.on('pelacord:signal', (_event, message) => {	if (!myPeerId || !message) return;
	broadcast({type: 'signal', from: myPeerId, to: message.to, payload: message.payload});
});

/** Manda un comando a un peer puntual (por ejemplo: moverlo a otro canal de voz). */
ipcMain.on('pelacord:command', (_event, message) => {
	if (!myPeerId || !message || !message.to) return;
	broadcast({type: 'command', from: myPeerId, to: message.to, payload: message.payload});
});

/** Difunde el estado de la Jam a todos los de la malla. */
ipcMain.on('pelacord:music', (_event, payload) => {
	if (!myPeerId) return;
	broadcast({type: 'music', from: myPeerId, payload});
});

/** Difunde el estado de mi sala de Pelaflix (película, minuto y si está pausada). */
ipcMain.on('pelacord:movie-room', (_event, payload) => {
	if (!myPeerId) return;
	broadcast({type: 'movie-room', from: myPeerId, payload});
});

/** Manda el log de mensajes: dirigido a un peer (reconciliación) o difundido (mensaje nuevo). */ipcMain.on('pelacord:messages', (_event, message) => {
	if (!myPeerId || !message || !message.payload) return;
	broadcast({type: 'messages', from: myPeerId, to: message.to, payload: message.payload});
});

ipcMain.handle('pelacord:peers', () => [...peers.keys()]);

// ---------- yt-dlp (bajar el audio de un link, para el reproductor de música) ----------

/** Ruta del binario: empaquetado vive en resources, en desarrollo en la carpeta del proyecto. */
function ytDlpPath() {
	const packaged = process.resourcesPath ? path.join(process.resourcesPath, 'yt-dlp.exe') : null;
	if (packaged && fs.existsSync(packaged)) return packaged;
	const dev = path.join(__dirname, '..', 'resources', 'yt-dlp.exe');
	return fs.existsSync(dev) ? dev : null;
}

/** Procesos de yt-dlp vivos. Sin esto quedan huérfanos cuando se cierra o reinicia la app. */
const ytDlpChildren = new Set();
/** La búsqueda en curso: si llega otra, se mata la anterior (si no, se apilan procesos). */
let currentSearch = null;

/** Mata un proceso y TODA su descendencia (yt-dlp puede lanzar ffmpeg). */
function killTree(child) {
	if (!child || !child.pid) return;
	try {
		if (process.platform === 'win32') {
			// En Windows child.kill() no mata a los hijos: taskkill /T se lleva el árbol entero.
			spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], {windowsHide: true});
		} else {
			child.kill('SIGKILL');
		}
	} catch {
		// se ignora
	}
}

function killAllYtDlp() {
	for (const child of ytDlpChildren) killTree(child);
	ytDlpChildren.clear();
	currentSearch = null;
}

// Al cerrar la app no puede quedar ningún yt-dlp corriendo.
app.on('will-quit', killAllYtDlp);

/** Corre yt-dlp y devuelve la salida. `onSpawn` recibe el proceso por si hay que matarlo después. */
function runYtDlp(args, timeoutMs = 60000, onSpawn) {
	return new Promise((resolve) => {
		const bin = ytDlpPath();
		if (!bin) {
			resolve({ok: false, error: 'yt-dlp no está disponible'});
			return;
		}
		const child = spawn(bin, args, {windowsHide: true});
		ytDlpChildren.add(child);
		if (onSpawn) onSpawn(child);
		let out = '';
		let err = '';
		let finished = false;
		const finish = (result) => {
			if (finished) return;
			finished = true;
			clearTimeout(timer);
			ytDlpChildren.delete(child);
			resolve(result);
		};
		const timer = setTimeout(() => {
			killTree(child);
			finish({ok: false, error: 'tardó demasiado'});
		}, timeoutMs);
		child.stdout.on('data', (chunk) => {
			out += chunk.toString();
		});
		child.stderr.on('data', (chunk) => {
			err += chunk.toString();
		});
		child.on('error', (error) => finish({ok: false, error: String(error)}));
		child.on('close', (code) => {
			finish(code === 0 ? {ok: true, output: out.trim()} : {ok: false, error: err.trim() || `salió con ${code}`});
		});
	});
}

ipcMain.handle('pelacord:ytdlp-version', async () => {
	const result = await runYtDlp(['--version'], 20000);
	return result.ok ? result.output : null;
});

/** Convierte una entrada de yt-dlp en un resultado de búsqueda (mismo formato en todos lados). */
function ytEntryToResult(entry) {
	return {
		id: String(entry?.id || ''),
		title: String(entry?.title || ''),
		duration: Number(entry?.duration) || 0,
		thumbnail: String(entry?.thumbnails?.[entry.thumbnails.length - 1]?.url || `https://i.ytimg.com/vi/${entry?.id}/mqdefault.jpg`),
		author: String(entry?.uploader || entry?.channel || ''),
		url: String(entry?.url || `https://www.youtube.com/watch?v=${entry?.id}`),
	};
}

/**
 * Busca en YouTube y devuelve la lista (título, duración, miniatura, autor).
 * Es la búsqueda del reproductor: lo que el usuario escribe o el tema de una playlist de Spotify.
 */
ipcMain.handle('pelacord:yt-search', async (_event, query, limit = 15) => {
	const clean = String(query || '').trim();
	if (!clean) return [];
	// Una sola búsqueda a la vez: la anterior se mata. Sin esto se apilan procesos de yt-dlp.
	if (currentSearch) {
		killTree(currentSearch);
		currentSearch = null;
	}
	const count = Math.min(25, Math.max(1, Number(limit) || 15));
	// "flat-playlist" trae sólo los datos de la lista: rápido, no toca cada video.
	const result = await runYtDlp(
		['--dump-single-json', '--flat-playlist', '--no-warnings', `ytsearch${count}:${clean}`],
		30000,
		(child) => {
			currentSearch = child;
		},
	);
	currentSearch = null;
	if (!result.ok) return [];
	try {
		const parsed = JSON.parse(result.output);
		const entries = parsed.entries || [];
		return entries.map(ytEntryToResult);
	} catch (error) {
		console.warn('[pelacord] búsqueda de YouTube ilegible:', String(error));
		return [];
	}
});

/**
 * Resuelve VARIAS búsquedas de una sola vez (una corrida de yt-dlp para todas).
 *
 * Se usa al agregar una playlist de Spotify entera: lanzar un proceso por canción tardaría
 * minutos. Devuelve un resultado por consulta, EN EL MISMO ORDEN (null si esa no encontró nada).
 */
ipcMain.handle('pelacord:yt-search-batch', async (_event, queries) => {
	const list = (Array.isArray(queries) ? queries : []).map((query) => String(query || '').trim()).filter(Boolean);
	if (list.length === 0) return [];
	const args = ['--dump-json', '--flat-playlist', '--no-warnings', '--ignore-errors', ...list.map((query) => `ytsearch1:${query}`)];
	const result = await runYtDlp(args, 90000);
	const lines = result.ok ? result.output.split('\n').filter((line) => line.trim().startsWith('{')) : [];
	// Si alguna búsqueda no devolvió nada, las líneas se desalinean y quedaría una canción por otra:
	// en ese caso se resuelve de a una (más lento, pero seguro).
	if (lines.length === list.length) {
		return lines.map((line) => {
			try {
				return ytEntryToResult(JSON.parse(line));
			} catch {
				return null;
			}
		});
	}
	const single = [];
	for (const query of list) {
		const one = await runYtDlp(['--dump-single-json', '--flat-playlist', '--no-warnings', `ytsearch1:${query}`], 30000);
		if (!one.ok) {
			single.push(null);
			continue;
		}
		try {
			const entry = JSON.parse(one.output)?.entries?.[0];
			single.push(entry ? ytEntryToResult(entry) : null);
		} catch {
			single.push(null);
		}
	}
	return single;
});

/**
 * Devuelve la URL directa del audio (para streamear, sin descargar el archivo).
 * Se pide en el momento de reproducir: esas URLs vencen, así que no se cachean.
 */
ipcMain.handle('pelacord:yt-audio-url', async (_event, target) => {
	const url = await resolveAudioUrl(target);
	if (!url) return null;
	// Se sirve desde la app (ver serveAudio): así no depende de IPv6 ni de las cabeceras de CORS
	// de googlevideo, y si la URL vence se vuelve a resolver sola.
	const token = crypto.randomUUID();
	audioStreams.set(token, {target: String(target || ''), url});
	// Se guardan las últimas 20 para no crecer sin control (una por tema que suena).
	if (audioStreams.size > 20) {
		const [oldest] = audioStreams.keys();
		audioStreams.delete(oldest);
	}
	return fileServerPort ? `http://127.0.0.1:${fileServerPort}/audio/${token}` : url;
});

/**
 * Se actualiza solo, en el canal NIGHTLY (sale build casi todos los días): YouTube cambia
 * seguido y así siempre tenemos lo último. Se corre al arrancar y cada 6 h, sin molestar:
 * si falla, se sigue con la versión que hay.
 */
async function updateYtDlp() {
	const result = await runYtDlp(['--update-to', 'nightly'], 180000);
	console.log('[pelacord] yt-dlp update:', result.ok ? result.output.split('\n').slice(-1)[0] : result.error);
}

// ---------- Spotify (iniciar sesión y traer TUS playlists) ----------
//
// Se usa el flujo "Authorization Code + PKCE": es el único que deja iniciar sesión a una persona
// y ver SUS playlists (el flujo de credenciales de cliente no sabe de quién son las cosas).
// PKCE no necesita el secreto del cliente; el secreto de abajo es para el OTRO flujo (buscar
// playlists públicas sin iniciar sesión), que todavía no se usa.
//
// OJO: la Redirect URI tiene que estar registrada IGUAL (letra por letra) en el panel de Spotify.

const SPOTIFY_CLIENT_ID = '79a44472751948cdba2b111fa2fd8b4b';
// Viaja dentro de la app: es un grupo de amigos y el usuario decidió no rotarlo.
const SPOTIFY_CLIENT_SECRET = 'cc2179f8def94ecdbf101610b22c2ff1';
const SPOTIFY_REDIRECT = 'http://127.0.0.1:8899/callback';
const SPOTIFY_SCOPES = 'playlist-read-private playlist-read-collaborative user-read-private user-read-email';

function spotifyStorePath() {
	return path.join(app.getPath('userData'), 'spotify.json');
}

/** Lee la sesión guardada (el refresh token va cifrado con lo que dé Windows, si se puede). */
function readSpotifyStore() {
	try {
		const data = JSON.parse(fs.readFileSync(spotifyStorePath(), 'utf8'));
		if (data && data.encrypted) {
			if (!safeStorage.isEncryptionAvailable()) return null;
			return JSON.parse(safeStorage.decryptString(Buffer.from(data.encrypted, 'base64')));
		}
		return data && data.refreshToken ? data : null;
	} catch {
		return null;
	}
}

function writeSpotifyStore(value) {
	try {
		const payload = safeStorage.isEncryptionAvailable()
			? {encrypted: safeStorage.encryptString(JSON.stringify(value)).toString('base64')}
			: value;
		fs.writeFileSync(spotifyStorePath(), JSON.stringify(payload), 'utf8');
	} catch (error) {
		console.warn('[pelacord] no se pudo guardar la sesión de Spotify:', String(error));
	}
}

function clearSpotifyStore() {
	try {
		fs.unlinkSync(spotifyStorePath());
	} catch {
		// no estaba: nada que borrar
	}
}

/** Access token vigente. Se refresca solo cuando está por vencer (duran una hora). */
let spotifyAccess = null;
async function spotifyToken() {
	const store = readSpotifyStore();
	if (!store?.refreshToken) return null;
	if (spotifyAccess && spotifyAccess.expiresAt > Date.now() + 30000) return spotifyAccess.token;
	const res = await fetch('https://accounts.spotify.com/api/token', {
		method: 'POST',
		headers: {'Content-Type': 'application/x-www-form-urlencoded'},
		body: new URLSearchParams({grant_type: 'refresh_token', refresh_token: store.refreshToken, client_id: SPOTIFY_CLIENT_ID}),
	});
	if (!res.ok) {
		// Si el refresh token ya no sirve, se olvida la sesión (así la interfaz vuelve a pedir login).
		if (res.status === 400) {
			console.warn('[pelacord] la sesión de Spotify ya no sirve: se pide iniciar sesión de nuevo');
			clearSpotifyStore();
			spotifyAccess = null;
		}
		return null;
	}
	const data = await res.json();
	if (!data.access_token) return null;
	spotifyAccess = {token: data.access_token, expiresAt: Date.now() + (data.expires_in ?? 3600) * 1000};
	// Spotify a veces entrega un refresh token nuevo: se guarda para no perderlo.
	if (data.refresh_token) writeSpotifyStore({...store, refreshToken: data.refresh_token});
	return spotifyAccess.token;
}

/** Lee el detalle del error que manda Spotify (a veces explica exactamente qué pasa). */
async function spotifyDetail(res) {
	try {
		const data = await res.json();
		const message = data?.error?.message;
		if (typeof message === 'string') return message;
		if (typeof data?.error_description === 'string') return data.error_description;
		if (typeof data?.error === 'string') return data.error;
		return '';
	} catch {
		return '';
	}
}

/** Mensaje legible para los códigos de error de Spotify. */
function spotifyErrorMessage(status, detail = '') {
	// 403 por NO estar habilitado como usuario de la app (modo Development). Es el caso típico de
	// "mi amigo se logueó y no le aparece nada": el login anda, pero la API le responde 403 a todo.
	if (status === 403 && /not registered|may not be registered/i.test(detail)) {
		return 'Tu cuenta todavía no está habilitada para esta app. El dueño de la app tiene que agregarte en el panel de Spotify (Settings → Users Management → Add new user, con tu nombre real y tu email de Spotify) y después volvés a iniciar sesión.';
	}
	if (status === 401) return 'La sesión de Spotify venció: volvé a iniciar sesión.';
	if (status === 403) return 'Spotify no entrega las canciones de esta playlist por API (sólo lo hace con las tuyas). Se intenta leer la página pública.';
	if (status === 404) return 'Esa playlist ya no existe.';
	if (status === 429) return 'Spotify está limitando los pedidos: probá de nuevo en un rato.';
	return detail ? `Spotify respondió ${status}: ${detail}` : `Spotify respondió ${status}.`;
}

function base64Url(buffer) {
	return Buffer.from(buffer).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** El par de PKCE: un secreto que se manda hasheado y se guarda para el canje. */
function pkcePair() {
	const verifier = base64Url(crypto.randomBytes(48));
	return {verifier, challenge: base64Url(crypto.createHash('sha256').update(verifier).digest())};
}

/**
 * Inicia sesión: abre el navegador en la pantalla de Spotify, escucha la vuelta en
 * 127.0.0.1:8899 y canjea el código por los tokens. Devuelve cuando terminó (o falló).
 */
ipcMain.handle('pelacord:spotify-login', async () => {
	const {verifier, challenge} = pkcePair();
	const state = base64Url(crypto.randomBytes(12));
	const authUrl = `https://accounts.spotify.com/authorize?${new URLSearchParams({
		client_id: SPOTIFY_CLIENT_ID,
		response_type: 'code',
		redirect_uri: SPOTIFY_REDIRECT,
		code_challenge_method: 'S256',
		code_challenge: challenge,
		state,
		scope: SPOTIFY_SCOPES,
	})}`;

	return new Promise((resolve) => {
		let settled = false;
		let timer = null;
		const finish = (result) => {
			if (settled) return;
			settled = true;
			clearTimeout(timer);
			try {
				server.close();
			} catch {
				// ya estaba cerrado
			}
			resolve(result);
		};

		const server = http.createServer(async (req, res) => {
			const url = new URL(req.url, SPOTIFY_REDIRECT);
			if (url.pathname !== '/callback') {
				res.writeHead(404);
				res.end();
				return;
			}
			const page = (title, detail) =>
				`<!doctype html><meta charset="utf-8"><title>${title}</title>` +
				`<body style="font-family:Segoe UI,system-ui,sans-serif;background:#121212;color:#fff;display:flex;` +
				`align-items:center;justify-content:center;height:100vh;margin:0"><div style="text-align:center">` +
				`<h1 style="color:#1ed760;margin:0 0 8px">${title}</h1><p style="color:#b3b3b3;margin:0">${detail}</p></div>`;
			const code = url.searchParams.get('code');
			const denied = url.searchParams.get('error');
			if (denied || !code || url.searchParams.get('state') !== state) {
				res.writeHead(200, {'Content-Type': 'text/html; charset=utf-8'});
				res.end(page('No se pudo iniciar sesión', 'Podés cerrar esta pestaña y volver a Pelacord.'));
				finish({ok: false, error: denied ? 'Cancelaste el inicio de sesión en Spotify.' : 'La respuesta de Spotify no era la esperada.'});
				return;
			}
			res.writeHead(200, {'Content-Type': 'text/html; charset=utf-8'});
			res.end(page('¡Listo!', 'Ya podés volver a Pelacord: tus playlists están ahí.'));
			const tokenRes = await fetch('https://accounts.spotify.com/api/token', {
				method: 'POST',
				headers: {'Content-Type': 'application/x-www-form-urlencoded'},
				body: new URLSearchParams({
					grant_type: 'authorization_code',
					code,
					redirect_uri: SPOTIFY_REDIRECT,
					client_id: SPOTIFY_CLIENT_ID,
					code_verifier: verifier,
				}),
			});
			const data = await tokenRes.json().catch(() => ({}));
			if (!tokenRes.ok || !data.refresh_token) {
				const detail = String(data.error_description || data.error || `HTTP ${tokenRes.status}`);
				finish({
					ok: false,
					error: /redirect/i.test(detail)
						? `Spotify rechazó la redirección. En tu panel de Spotify (Redirect URIs) agregá exactamente: ${SPOTIFY_REDIRECT}`
						: detail,
				});
				return;
			}
			spotifyAccess = {token: data.access_token, expiresAt: Date.now() + (data.expires_in ?? 3600) * 1000};
			writeSpotifyStore({refreshToken: data.refresh_token});
			finish({ok: true});
		});

		server.on('error', (error) => {
			finish({
				ok: false,
				error:
					error.code === 'EADDRINUSE'
						? 'El puerto 8899 está ocupado (¿hay otra app usándolo?). Cerrá lo que lo esté usando y probá de nuevo.'
						: `No se pudo escuchar la vuelta de Spotify: ${error.message}`,
			});
		});
		server.listen(8899, '127.0.0.1', () => {
			void shell.openExternal(authUrl).catch((error) => finish({ok: false, error: `No se pudo abrir el navegador: ${error.message}`}));
		});
		timer = setTimeout(() => finish({ok: false, error: 'Pasaron 3 minutos sin respuesta de Spotify.'}), 180000);
	});
});

/**
 * Token de APLICACIÓN (Client Credentials): sirve para lo que no necesita saber quién sos, como
 * buscar playlists públicas. Es el único uso que le quedó al secreto del cliente.
 */
let spotifyAppAccess = null;
async function spotifyAppToken() {
	if (spotifyAppAccess && spotifyAppAccess.expiresAt > Date.now() + 30000) return spotifyAppAccess.token;
	const basic = Buffer.from(`${SPOTIFY_CLIENT_ID}:${SPOTIFY_CLIENT_SECRET}`).toString('base64');
	const res = await fetch('https://accounts.spotify.com/api/token', {
		method: 'POST',
		headers: {'Content-Type': 'application/x-www-form-urlencoded', Authorization: `Basic ${basic}`},
		body: 'grant_type=client_credentials',
	});
	if (!res.ok) return null;
	const data = await res.json().catch(() => ({}));
	if (!data.access_token) return null;
	spotifyAppAccess = {token: data.access_token, expiresAt: Date.now() + (data.expires_in ?? 3600) * 1000};
	return spotifyAppAccess.token;
}

/** Con qué se arma el grid de playlists destacadas del buscador. */
const SPOTIFY_DISCOVER_TERMS = ['top hits', 'éxitos', 'rock clásico', 'reggaeton', 'cumbia', 'pop', 'música de los 80', 'indie'];

let spotifyDiscoverCache = null;

/**
 * Playlists destacadas para el buscador.
 *
 * Se arman con búsquedas reales de Spotify: los endpoints de "destacados" ya no existen (dan 403
 * desde febrero 2026). Devuelve sólo los datos de la tarjeta; las canciones se leen después del
 * embed público, playlist por playlist (porque la API no entrega el contenido de playlists ajenas).
 */
ipcMain.handle('pelacord:spotify-discover', async () => {
	if (spotifyDiscoverCache && Date.now() - spotifyDiscoverCache.at < 30 * 60 * 1000) {
		return {ok: true, playlists: spotifyDiscoverCache.playlists, cached: true};
	}
	const token = await spotifyAppToken();
	if (!token) return {ok: false, error: 'No se pudieron buscar playlists destacadas.', playlists: []};
	const found = new Map();
	for (const term of SPOTIFY_DISCOVER_TERMS) {
		const res = await fetch(`https://api.spotify.com/v1/search?q=${encodeURIComponent(term)}&type=playlist&limit=6`, {
			headers: {Authorization: `Bearer ${token}`},
		});
		if (!res.ok) continue;
		const data = await res.json().catch(() => ({}));
		for (const item of data.playlists?.items ?? []) {
			if (!item?.id || found.has(item.id)) continue;
			found.set(item.id, {
				id: String(item.id),
				name: String(item.name || 'Playlist'),
				owner: String(item.owner?.display_name || item.owner?.id || ''),
				tracks: Number(item.tracks?.total) || 0,
				// Las ajenas no se pueden leer por API: se leen del embed público.
				readable: false,
				image: String(item.images?.[0]?.url || ''),
				url: String(item.external_urls?.spotify || ''),
			});
		}
	}
	const playlists = [...found.values()].slice(0, 24);
	spotifyDiscoverCache = {playlists, at: Date.now()};
	return {ok: true, playlists};
});

/** ¿Hay sesión? Devuelve también el nombre para saludar y la dirección de vuelta que hay que registrar. */
ipcMain.handle('pelacord:spotify-status', async () => {
	const store = readSpotifyStore();
	if (!store?.refreshToken) return {connected: false, redirectUri: SPOTIFY_REDIRECT};
	const token = await spotifyToken();
	if (!token) return {connected: false, redirectUri: SPOTIFY_REDIRECT};
	const res = await fetch('https://api.spotify.com/v1/me', {headers: {Authorization: `Bearer ${token}`}});
	if (!res.ok) {
		// Ojo: acá es donde se ve si la cuenta está habilitada. Un 403 significa que el dueño de la
		// app no la agregó como usuario: el login anda, pero no puede pedir nada.
		const error = spotifyErrorMessage(res.status, await spotifyDetail(res));
		return {connected: true, name: store.name ?? '', redirectUri: SPOTIFY_REDIRECT, error, blocked: res.status === 403};
	}
	const me = await res.json().catch(() => ({}));
	const name = me.display_name || me.id || '';
	if (name && name !== store.name) writeSpotifyStore({...store, name});
	return {connected: true, name, image: me.images?.[0]?.url ?? '', redirectUri: SPOTIFY_REDIRECT};
});

/** Todas las playlists del usuario (con paginado: Spotify devuelve de a 50). */
ipcMain.handle('pelacord:spotify-playlists', async () => {
	const token = await spotifyToken();
	if (!token) return {ok: false, error: 'No hay sesión de Spotify.'};
	const playlists = [];
	let url = 'https://api.spotify.com/v1/me/playlists?limit=50';
	for (let page = 0; page < 20 && url; page++) {
		const res = await fetch(url, {headers: {Authorization: `Bearer ${token}`}});
		if (!res.ok) return {ok: false, error: spotifyErrorMessage(res.status, await spotifyDetail(res)), playlists};
		const data = await res.json().catch(() => ({}));
		for (const item of data.items ?? []) {
			if (!item) continue;
			// OJO: Spotify renombró "tracks" a "items" (febrero 2026). Y para las playlists que NO son
			// tuyas ya no manda el contenido: viene solo la metadata y `items` no está. Por eso se
			// marca `readable`: la interfaz dice la verdad en vez de mostrar "0 canciones".
			const info = item.items ?? item.tracks;
			playlists.push({
				id: String(item.id || ''),
				name: String(item.name || 'Playlist'),
				owner: String(item.owner?.display_name || item.owner?.id || ''),
				tracks: Number(info?.total) || 0,
				readable: Boolean(item.items),
				image: String(item.images?.[0]?.url || ''),
				url: String(item.external_urls?.spotify || ''),
			});
		}
		url = data.next || '';
	}
	return {ok: true, playlists};
});

/** Las canciones de una playlist (nombre, artistas, duración). */
ipcMain.handle('pelacord:spotify-tracks', async (_event, playlistId) => {
	const token = await spotifyToken();
	if (!token) return {ok: false, error: 'No hay sesión de Spotify.'};
	const id = String(playlistId || '').trim();
	if (!id) return {ok: false, error: 'Falta la playlist.'};
	// Spotify renombró /tracks a /items (y el campo "track" a "item"): se prueban los dos.
	let useItems = true;
	let url = `https://api.spotify.com/v1/playlists/${encodeURIComponent(id)}/items?limit=100`;
	const tracks = [];
	for (let page = 0; page < 30 && url; page++) {
		const res = await fetch(url, {headers: {Authorization: `Bearer ${token}`}});
		if (res.status === 404 && useItems) {
			useItems = false;
			url = `https://api.spotify.com/v1/playlists/${encodeURIComponent(id)}/tracks?limit=100`;
			continue;
		}
		if (!res.ok) return {ok: false, error: spotifyErrorMessage(res.status, await spotifyDetail(res)), tracks};
		const data = await res.json().catch(() => ({}));
		for (const item of data.items ?? []) {
			const track = item?.item ?? item?.track;
			if (!track?.name) continue;
			// La portada del álbum (la más chica alcanza para una fila de lista).
			const images = track.album?.images ?? [];
			const image = String(images[images.length - 1]?.url || images[0]?.url || '');
			tracks.push({
				title: String(track.name),
				artists: (track.artists ?? []).map((artist) => artist.name).filter(Boolean).join(', '),
				duration: Math.round((Number(track.duration_ms) || 0) / 1000),
				image,
			});
		}
		url = data.next || '';
	}
	return {ok: true, tracks};
});

/**
 * Lee las canciones de una playlist PÚBLICA de otra persona.
 *
 * Por qué así: Spotify cerró la puerta por API. El contenido de una playlist ajena no se entrega
 * ni con el token de la cuenta ni con el de la aplicación, aunque sea pública. Lo que SÍ sigue
 * público es el EMBED (`open.spotify.com/embed/playlist/ID`), que arma la lista con JavaScript en
 * el navegador. Así que se carga ese embed en una ventana OCULTA y se leen las filas del DOM.
 *
 * Es leer una página pública, no saltarse un login (no usa cookies ni sesión). Si Spotify cambia
 * el embed, esto deja de andar: por eso se devuelve un error claro en vez de inventar canciones.
 */
const SPOTIFY_EMBED_READER = `(() => {
	const rows = [...document.querySelectorAll('li[data-testid^="tracklist-row"]')];
	// El "E" de explícito es una etiqueta adentro del título/artista: se saca antes de leer el texto.
	const clean = (cell) => {
		if (!cell) return '';
		const copy = cell.cloneNode(true);
		copy.querySelectorAll('[data-testid="tag"]').forEach((tag) => tag.remove());
		return (copy.textContent || '').trim();
	};
	return rows.map((row) => {
		const duration = (row.querySelector('[data-testid="duration-cell"]')?.textContent || '').trim();
		const [minutes, seconds] = duration.split(':').map((part) => Number(part) || 0);
		return {title: clean(row.querySelector('h3')), artists: clean(row.querySelector('h4')), duration: minutes * 60 + seconds};
	}).filter((track) => track.title);
})()`;

/** Lo ya leído de una playlist pública (para no volver a abrir la ventana cada vez). */
const spotifyPublicCache = new Map();

ipcMain.handle('pelacord:spotify-public-playlist', async (_event, playlistId) => {
	const id = String(playlistId || '').trim();
	if (!/^[A-Za-z0-9]{16,40}$/.test(id)) return {ok: false, error: 'Esa playlist no tiene un id válido.'};
	const cached = spotifyPublicCache.get(id);
	if (cached && Date.now() - cached.at < 10 * 60 * 1000) return {ok: true, tracks: cached.tracks, cached: true};

	const win = new BrowserWindow({
		show: false,
		width: 1100,
		height: 900,
		webPreferences: {
			// Ventana aislada: sin Node y con su propia partición (no toca ninguna sesión).
			contextIsolation: true,
			nodeIntegration: false,
			partition: 'pelacord-spotify-public',
			// Sin esto, Windows frena los temporizadores de una ventana oculta y la lista no se arma.
			backgroundThrottling: false,
		},
	});
	try {
		await win.loadURL(`https://open.spotify.com/embed/playlist/${id}`);
		for (let attempt = 0; attempt < 24; attempt++) {
			const tracks = await win.webContents.executeJavaScript(SPOTIFY_EMBED_READER, true);
			if (Array.isArray(tracks) && tracks.length > 0) {
				spotifyPublicCache.set(id, {tracks, at: Date.now()});
				return {ok: true, tracks};
			}
			await new Promise((resolve) => setTimeout(resolve, 500));
		}
		return {ok: false, error: 'La página de Spotify no devolvió las canciones (¿la playlist es privada?).'};
	} catch (error) {
		return {ok: false, error: `No se pudo abrir la página de Spotify: ${error.message}`};
	} finally {
		try {
			win.destroy();
		} catch {
			// ya estaba cerrada
		}
	}
});

/** Cerrar sesión: se olvida el token guardado. */
ipcMain.handle('pelacord:spotify-logout', () => {
	clearSpotifyStore();
	spotifyAccess = null;
	return true;
});

// ---------- TMDB (catálogo de películas) ----------
//
// Sólo se usa para el CATÁLOGO (títulos, sinopsis, portadas, duración). El video lo pone el
// reproductor. El token de lectura es de la cuenta del usuario y viaja en la app (es un dato
// pensado para clientes, no un secreto).

const TMDB_TOKEN =
	'eyJhbGciOiJIUzI1NiJ9.eyJhdWQiOiJmMzA2NTcxNzY3OGM5ZGYyMmM4MzJkNjA4YTNmNWQ0ZCIsIm5iZiI6MTc0MDU1MzAzNi4yNzYsInN1YiI6IjY3YmViYjRjMzljYjc4MjBkMGVmYTZhZCIsInNjb3BlcyI6WyJhcGlfcmVhZCJdLCJ2ZXJzaW9uIjoxfQ.YywcjHmQXKeINIMDHIrukk8dtXTQbW_c04_Qg9vR3j8';
const TMDB_BASE = 'https://api.themoviedb.org/3';
/** Los datos en español: títulos y sinopsis se leen como corresponde. */
const TMDB_LANGUAGE = 'es-AR';

/** Una película o serie, con las imágenes ya resueltas y sólo lo que usa la interfaz. */
function tmdbMovie(item, mediaType = 'movie') {
	if (!item?.id) return null;
	return {
		id: Number(item.id),
		// Ojo: las series usan "name" en vez de "title" y "first_air_date" en vez de "release_date".
		mediaType: item.media_type === 'tv' || item.media_type === 'movie' ? String(item.media_type) : mediaType,
		title: String(item.title || item.name || ''),
		overview: String(item.overview || ''),
		poster: item.poster_path ? `https://image.tmdb.org/t/p/w500${item.poster_path}` : '',
		backdrop: item.backdrop_path ? `https://image.tmdb.org/t/p/w1280${item.backdrop_path}` : '',
		year: String(item.release_date || item.first_air_date || '').slice(0, 4),
		rating: Math.round((Number(item.vote_average) || 0) * 10) / 10,
		/** Cuántos votos tiene: se usa para dejar afuera lo que no conoce nadie. */
		votes: Number(item.vote_count) || 0,
		popularity: Number(item.popularity) || 0,
		runtime: Number(item.runtime) || Number(item.episode_run_time?.[0]) || 0,
		genres: (item.genres ?? []).map((genre) => genre.name).filter(Boolean),
	};
}

/**
 * Las filas del catálogo.
 *
 * Para sumar SERIES más adelante alcanza con agregar entradas acá (`/tv/...` con mediaType 'tv'):
 * todo el resto (detalle, imágenes y el reproductor) ya trabaja con el tipo de contenido.
 */
const TMDB_ROWS = [
	{title: 'Tendencias de la semana', path: '/trending/movie/week', mediaType: 'movie', minVotes: 300},
	{title: 'Populares', path: '/movie/popular', mediaType: 'movie', minVotes: 300},
	{title: 'Mejor valoradas', path: '/movie/top_rated', mediaType: 'movie', minVotes: 300},
	{title: 'En cartel', path: '/movie/now_playing', mediaType: 'movie', minVotes: 50},
	// Lo que todavía no se estrenó no tiene votos: no se filtra.
	{title: 'Próximamente', path: '/movie/upcoming', mediaType: 'movie', minVotes: 0},
];

/** Con esto se deja afuera lo que no conoce nadie (proyectos chicos, cosas raras). */
const TMDB_MIN_POPULARITY = 15;
/** En la búsqueda se es más permisivo: si buscás algo puntual, tiene que aparecer. */
const TMDB_SEARCH_MIN_VOTES = 20;

async function tmdb(path, params = {}) {
	const url = new URL(`${TMDB_BASE}${path}`);
	url.searchParams.set('language', TMDB_LANGUAGE);
	for (const [key, value] of Object.entries(params)) url.searchParams.set(key, String(value));
	try {
		const res = await fetch(url, {headers: {Authorization: `Bearer ${TMDB_TOKEN}`, accept: 'application/json'}});
		if (!res.ok) {
			console.warn('[pelacord] TMDB respondió', res.status, path);
			return null;
		}
		return await res.json();
	} catch (error) {
		console.warn('[pelacord] TMDB no respondió:', String(error));
		return null;
	}
}

/** Las filas del catálogo en un solo pedido, ya filtradas. */
ipcMain.handle('pelacord:tmdb-rows', async () => {
	const data = await Promise.all(TMDB_ROWS.map((row) => tmdb(row.path)));
	const rows = TMDB_ROWS.map((row, index) => {
		const movies = (data[index]?.results ?? [])
			.map((item) => tmdbMovie(item, row.mediaType))
			.filter((movie) => Boolean(movie))
			// Se deja afuera lo que no conoce nadie: proyectos chicos, cosas raras.
			.filter((movie) => movie.votes >= row.minVotes && movie.popularity >= TMDB_MIN_POPULARITY);
		return {title: row.title, movies};
	}).filter((row) => row.movies.length > 0);
	const hero = rows[0]?.movies?.find((movie) => movie.backdrop) ?? rows[0]?.movies?.[0] ?? null;
	return {ok: rows.length > 0, rows, hero};
});

/**
 * Buscar películas por nombre.
 *
 * Se busca en los DOS idiomas y se junta: así da igual si escribís "el padrino" o "the godfather".
 * El español va primero, así los títulos quedan en castellano cuando existen en los dos.
 */
ipcMain.handle('pelacord:tmdb-search', async (_event, query) => {
	const clean = String(query || '').trim();
	if (!clean) return {ok: true, movies: []};
	const [spanish, english] = await Promise.all([
		tmdb('/search/movie', {query: clean, page: 1, include_adult: false}),
		tmdb('/search/movie', {query: clean, page: 1, include_adult: false, language: 'en-US'}),
	]);
	const found = new Map();
	for (const data of [spanish, english]) {
		for (const item of data?.results ?? []) {
			const movie = tmdbMovie(item);
			// En la búsqueda se es permisivo (si buscás algo puntual tiene que aparecer) pero se
			// exige un mínimo de votos para colar basura.
			if (!movie || movie.votes < TMDB_SEARCH_MIN_VOTES || found.has(movie.id)) continue;
			found.set(movie.id, movie);
		}
	}
	// Los más conocidos primero.
	const movies = [...found.values()].sort((a, b) => b.popularity - a.popularity).slice(0, 40);
	return {ok: true, movies};
});

/** El detalle de una película (o serie) con duración y géneros. */
ipcMain.handle('pelacord:tmdb-movie', async (_event, id, mediaType = 'movie') => {
	const movieId = Number(id) || 0;
	if (!movieId) return {ok: false, movie: null};
	const type = mediaType === 'tv' ? 'tv' : 'movie';
	const data = await tmdb(`/${type}/${movieId}`);
	return {ok: Boolean(data), movie: data ? tmdbMovie(data, type) : null};
});

/**
 * Subtítulos: se muestran a pedido (los elige cada persona).
 *
 * El video NO recibe clics a propósito (así no salta publicidad), pero su panel de subtítulos
 * necesita clics de verdad. Así que esto hace el ida y vuelta: cuando se pide, muestra su barra y
 * le devuelve los clics al reproductor para que la persona elija; cuando se apaga, lo vuelve a
 * dejar cerrado y sin clics.
 */
ipcMain.handle('pelacord:movie-subtitles', async (_event, viewId, enable) => {
	const guest = webContents.fromId(Number(viewId) || 0);
	if (!guest || guest.getType() !== 'webview') return {ok: false, error: 'No encontré el reproductor.'};
	const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
	const js = (code) => guest.executeJavaScript(code).catch(() => null);

	if (!enable) {
		await js('window.__pelacordClicsPermitidos = false; true');
		await js("document.body.style.pointerEvents = 'none'; document.body.style.userSelect = 'none'; true");
		await js("document.dispatchEvent(new KeyboardEvent('keydown', {key: 'Escape', bubbles: true})); true");
		await js(`(() => {
			if (document.getElementById('pelacord-movie-css')) return true;
			const style = document.createElement('style');
			style.id = 'pelacord-movie-css';
			style.textContent = 'media-control-bar, .notflix-controlbar { display: none !important; }';
			document.head.appendChild(style);
			return true;
		})()`);
		return {ok: true};
	}

	// Se muestra su barra y se devuelven los clics, para poder elegir los subtítulos.
	await js("document.getElementById('pelacord-movie-css')?.remove(); true");
	await js('window.__pelacordClicsPermitidos = true; true');
	await js("document.body.style.pointerEvents = 'auto'; document.body.style.userSelect = 'auto'; true");
	await wait(600);
	// Y se abre su panel de subtítulos con un clic de verdad (los sintéticos los ignora).
	const caja = await js(`(() => {
		const el = [...document.querySelectorAll('button')].find((b) => /subtitle settings/i.test(b.getAttribute('aria-label') || ''));
		if (!el) return null;
		const r = el.getBoundingClientRect();
		if (r.width < 2 || r.height < 2) return null;
		return {x: r.left + r.width / 2, y: r.top + r.height / 2};
	})()`);
	if (caja) {
		const x = Math.round(caja.x);
		const y = Math.round(caja.y);
		guest.sendInputEvent({type: 'mouseMove', x, y});
		await wait(100);
		guest.sendInputEvent({type: 'mouseDown', x, y, button: 'left', clickCount: 1});
		await wait(70);
		guest.sendInputEvent({type: 'mouseUp', x, y, button: 'left', clickCount: 1});
	}
	return {ok: true};
});

// ---------- Preview de links (se baja acá porque en el renderer lo bloquea el CORS) ----------

const linkPreviews = new Map();

/** Saca las etiquetas og: del HTML, sin traer un parser de por medio. */
function extractLinkMeta(html, url) {
	const meta = (name) => {
		const patterns = [
			new RegExp(`<meta[^>]+property=["']og:${name}["'][^>]+content=["']([^"']+)["']`, 'i'),
			new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:${name}["']`, 'i'),
			new RegExp(`<meta[^>]+name=["']${name}["'][^>]+content=["']([^"']+)["']`, 'i'),
		];
		for (const pattern of patterns) {
			const match = html.match(pattern);
			if (match && match[1]) return match[1];
		}
		return '';
	};
	const decode = (value) =>
		value
			.replace(/&quot;/g, '"')
			.replace(/&#0?39;/g, "'")
			.replace(/&amp;/g, '&')
			.replace(/&lt;/g, '<')
			.replace(/&gt;/g, '>')
			.trim();
	const rawTitle = meta('title') || (html.match(/<title[^>]*>([^<]*)<\/title>/i) || [])[1] || '';
	let image = meta('image');
	if (image.startsWith('//')) image = `https:${image}`;
	else if (image.startsWith('/')) {
		try {
			image = new URL(image, url).toString();
		} catch {
			image = '';
		}
	}
	return {
		url,
		title: decode(rawTitle).slice(0, 160),
		description: decode(meta('description')).slice(0, 300),
		image,
		siteName: decode(meta('site_name')).slice(0, 80),
	};
}

ipcMain.handle('pelacord:link-preview', async (_event, target) => {
	if (typeof target !== 'string' || !/^https?:/i.test(target)) return null;
	if (linkPreviews.has(target)) return linkPreviews.get(target);
	// YouTube no manda og: en el HTML que se baja sin sesión, pero tiene su propia API de datos.
	const YOUTUBE_PATTERN = /(?:youtube\.com\/(?:watch\?(?:.*&)?v=|shorts\/|embed\/|live\/)|youtu\.be\/)([A-Za-z0-9_-]{6,})/i;

	try {
		const videoId = (target.match(YOUTUBE_PATTERN) || [])[1];
		if (videoId) {
			const info = await net.fetch(`https://www.youtube.com/oembed?url=${encodeURIComponent(target)}&format=json`);
			if (info.ok) {
				const data = await info.json();
				const preview = {
					url: target,
					title: String(data.title || '').slice(0, 160),
					description: String(data.author_name || '').slice(0, 120),
					image: String(data.thumbnail_url || ''),
					siteName: 'YouTube',
				};
				linkPreviews.set(target, preview);
				return preview;
			}
		}
		const controller = new AbortController();
		const timer = setTimeout(() => controller.abort(), 6000);
		const response = await net.fetch(target, {redirect: 'follow', signal: controller.signal});
		clearTimeout(timer);
		if (!response.ok) throw new Error(`HTTP ${response.status}`);
		const type = response.headers.get('content-type') || '';
		if (!type.includes('html')) throw new Error('no es HTML');
		// Sólo el principio: alcanza para las etiquetas y no baja un sitio entero.
		const html = (await response.text()).slice(0, 250000);
		const preview = extractLinkMeta(html, target);
		linkPreviews.set(target, preview);
		return preview;
	} catch (error) {
		console.warn('[pelacord] sin preview de', target, String(error));
		linkPreviews.set(target, null);
		return null;
	}
});

// ---------- Compartir archivos (servidos desde el disco, con reanudación) ----------

/** id -> {path, name, size, mime} */
const sharedFiles = new Map();
let fileServerPort = 0;

/**
 * Registro en disco de los adjuntos compartidos.
 *
 * Sin esto, al reiniciar la app el mapa quedaba vacío y TODAS las URLs ya mandadas respondían 404
 * para siempre (se veía en la consola del usuario: "10.243...:7789/file/<id> 404" en bucle).
 * Con el registro, el id sigue vivo mientras el archivo siga en disco.
 */
function sharedFilesIndexPath() {
	return path.join(app.getPath('userData'), 'shared-files.json');
}

function saveSharedFiles() {
	try {
		// Sólo los adjuntos: los assets de perfil (avatar, banner, marco, partículas) ya se guardan
		// aparte y con ids fijos.
		const entries = [...sharedFiles.entries()]
			.filter(([id]) => !PROFILE_ASSETS.includes(id))
			.slice(-500)
			.map(([id, file]) => ({id, ...file}));
		fs.writeFileSync(sharedFilesIndexPath(), JSON.stringify(entries));
	} catch {
		// si no se puede guardar, se sigue igual
	}
}

function restoreSharedFiles() {
	try {
		const entries = JSON.parse(fs.readFileSync(sharedFilesIndexPath(), 'utf8'));
		let restored = 0;
		for (const entry of Array.isArray(entries) ? entries : []) {
			if (!entry?.id || !entry.path || !fs.existsSync(entry.path)) continue;
			sharedFiles.set(entry.id, {path: entry.path, name: entry.name, mime: entry.mime, size: entry.size});
			restored += 1;
		}
		if (restored > 0) console.log(`[pelacord] adjuntos compartidos restaurados: ${restored}`);
	} catch {
		// sin registro: no pasa nada
	}
}

function localAddress() {
	const all = localInterfaces();
	const zt = all.find((entry) => entry.isZeroTier);
	if (zt) return zt.address;
	// Si no se detecta ZeroTier, se EVITAN los adaptadores virtuales (WSL, Hyper-V, VirtualBox,
	// VMware, etc.): si se elige uno de esos, los demás no pueden bajar la foto ni los archivos de
	// este equipo (era justo el caso de "no me ve la foto de perfil").
	const virtuales = /wsl|hyper-v|vethernet|virtualbox|vmware|loopback|docker|tailscale|radmin|hamachi|tap|tun/i;
	const candidatas = all.filter((entry) => !virtuales.test(entry.name) && !entry.address.startsWith('169.254.'));
	return (candidatas[0] ?? all[0])?.address ?? '127.0.0.1';
}

// ---------- Proxy de audio (música de la Jam) ----------
//
// El audio NO se le pasa al reproductor como URL de YouTube: se sirve desde acá. Dos motivos reales:
//
// 1. Esas URLs se firman para una IPv4 (viene "ip=..." adentro). Si Chromium las pide por IPv6
//    responde 403 — y por eso la música andaba "a veces sí, a veces no". Acá se baja SIEMPRE por
//    IPv4, así que el 403 no puede pasar.
// 2. El <audio> de la app la necesita cross-origin con CORS, y googlevideo no manda las cabeceras
//    de CORS: el elemento quedaba SIN NINGUNA FUENTE ("NotSupportedError: The element has no
//    supported sources"). Servido desde localhost con CORS, el reproductor lo toma como propio.
//
// Además, si la URL venció, acá se vuelve a resolver sola y se reintenta (antes se cortaba la música).

/** token -> {target: link de YouTube del tema, url: URL directa de audio} */
const audioStreams = new Map();

async function resolveAudioUrl(target) {
	const value = String(target || '').trim();
	if (!value) return null;
	const url = /^https?:/i.test(value) ? value : `https://www.youtube.com/watch?v=${value}`;
	const result = await runYtDlp(['-f', 'bestaudio[ext=m4a]/bestaudio', '--get-url', '--no-playlist', '--no-warnings', url], 40000);
	if (!result.ok) {
		console.warn('[pelacord] no se pudo sacar el audio:', result.error);
		return null;
	}
	// Puede devolver varias líneas (audio + video): se usa la primera.
	return result.output.split('\n')[0].trim() || null;
}

const AUDIO_USER_AGENT =
	'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36';

/** Baja una URL de audio y la escribe en la respuesta. Devuelve true si salió bien. */
function pipeAudio(url, req, res, onStatus) {
	return new Promise((resolve) => {
		const headers = {'User-Agent': AUDIO_USER_AGENT};
		if (req.headers.range) headers.Range = req.headers.range;
		let terminado = false;
		const terminar = (valor) => {
			if (terminado) return;
			terminado = true;
			resolve(valor);
		};
		const upstream = https.get(url, {headers, family: 4}, (remote) => {
			onStatus(remote.statusCode || 0);
			if (remote.statusCode !== 200 && remote.statusCode !== 206) {
				remote.resume();
				terminar(false);
				return;
			}
			res.writeHead(remote.statusCode, {
				'Content-Type': remote.headers['content-type'] || 'audio/mp4',
				'Content-Length': remote.headers['content-length'],
				'Content-Range': remote.headers['content-range'],
				'Accept-Ranges': 'bytes',
				'Access-Control-Allow-Origin': '*',
				'Access-Control-Expose-Headers': 'Content-Length, Content-Range, Accept-Ranges',
			});
			remote.pipe(res);
			remote.on('end', () => terminar(true));
			remote.on('error', () => terminar(false));
		});
		upstream.on('error', () => terminar(false));
		upstream.setTimeout(30000, () => upstream.destroy());
	});
}

/** Sirve el audio de un tema. Si la URL venció, la resuelve de nuevo y reintenta una vez. */
async function serveAudio(token, req, res) {
	const entry = audioStreams.get(token);
	if (!entry) {
		res.writeHead(404);
		res.end();
		return;
	}
	let status = 0;
	const ok = await pipeAudio(entry.url, req, res, (code) => {
		status = code;
	});
	if (ok) return;
	console.warn(`[pelacord] el audio respondió ${status}: se resuelve de nuevo`);
	const fresh = await resolveAudioUrl(entry.target);
	if (!fresh) {
		if (!res.headersSent) {
			res.writeHead(502);
			res.end();
		}
		return;
	}
	entry.url = fresh;
	const retry = await pipeAudio(fresh, req, res, () => {});
	if (!retry && !res.headersSent) {
		res.writeHead(502);
		res.end();
	}
}

function startFileServer() {
	const server = http.createServer((req, res) => {
		res.setHeader('Access-Control-Allow-Origin', '*');
		res.setHeader('Access-Control-Allow-Headers', 'Range');
		res.setHeader('Access-Control-Expose-Headers', 'Content-Length, Content-Range, Accept-Ranges');
		if (req.method === 'OPTIONS') {
			res.writeHead(204);
			res.end();
			return;
		}
		const pathname = new URL(req.url, 'http://localhost').pathname;
		// Audio de la música: se baja desde acá (ver serveAudio) y se entrega como propio.
		const audio = /^\/audio\/(.+)$/.exec(pathname);
		if (audio) {
			void serveAudio(audio[1], req, res);
			return;
		}
		const match = /^\/file\/(.+)$/.exec(pathname);
		const file = match ? sharedFiles.get(match[1]) : null;
		if (!file || !fs.existsSync(file.path)) {
			res.writeHead(404);
			res.end();
			return;
		}
		const stat = fs.statSync(file.path);
		res.setHeader('Accept-Ranges', 'bytes');
		res.setHeader('Content-Type', file.mime || 'application/octet-stream');
		res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(file.name)}"`);
		const range = req.headers.range && /bytes=(\d*)-(\d*)/.exec(req.headers.range);
		if (range) {
			const start = range[1] ? Number(range[1]) : 0;
			const end = range[2] ? Number(range[2]) : stat.size - 1;
			res.writeHead(206, {'Content-Range': `bytes ${start}-${end}/${stat.size}`, 'Content-Length': end - start + 1});
			fs.createReadStream(file.path, {start, end}).pipe(res);
			return;
		}
		res.writeHead(200, {'Content-Length': stat.size});
		fs.createReadStream(file.path).pipe(res);
	});
	// Puerto FIJO para el servidor de archivos: si fuera efímero (listen(0)), cambiaría en cada
	// arranque y TODAS las URLs ya compartidas (avatares, banners, adjuntos) quedarían muertas con
	// "ERR_CONNECTION_REFUSED". Si el puerto está ocupado, se cae a uno libre.
	const onListening = () => {
		fileServerPort = server.address().port;
		console.log(`[pelacord] servidor de archivos en tcp/${fileServerPort}`);
	};
	server.once('error', (error) => {
		if (error.code === 'EADDRINUSE') {
			console.warn('[pelacord] el puerto de archivos estaba ocupado: se usa uno libre');
			server.listen(0, '0.0.0.0', onListening);
			return;
		}
		console.error('[pelacord] file server error', error.message);
	});
	server.listen(7789, '0.0.0.0', onListening);
}

ipcMain.handle('pelacord:file-endpoint', () => ({host: localAddress(), port: fileServerPort}));

ipcMain.handle('pelacord:share-file', (_event, payload) => {
	const {filePath, name, mime, size} = payload ?? {};
	if (!filePath || !fs.existsSync(filePath)) return null;
	const id = crypto.randomUUID();
	sharedFiles.set(id, {path: filePath, name: name || path.basename(filePath), mime: mime || '', size: size || fs.statSync(filePath).size});
	saveSharedFiles();
	return id;
});

ipcMain.handle('pelacord:share-buffer', (_event, payload) => {
	const {name, mime, data} = payload ?? {};
	if (!name || !data) return null;
	try {
		const dir = path.join(app.getPath('temp'), 'pelacord-shares');
		fs.mkdirSync(dir, {recursive: true});
		const safe = String(name).replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_');
		const filePath = path.join(dir, `${crypto.randomUUID()}-${safe}`);
		fs.writeFileSync(filePath, Buffer.from(data));
		const id = crypto.randomUUID();
		sharedFiles.set(id, {path: filePath, name: safe, mime: mime || '', size: fs.statSync(filePath).size});
		saveSharedFiles();
		return id;
	} catch (error) {
		console.error('[pelacord] share-buffer error', String(error));
		return null;
	}
});

ipcMain.handle('pelacord:open-path', async (_event, target) => {
	if (typeof target === 'string') await shell.openPath(target);
});

// ---------- Assets propios del perfil (avatar y banner, persistentes) ----------
//
// Un GIF animado se sirve desde el servidor P2P en vez de viajar como data URL en cada
// mensaje de presencia: así se conserva la animación y el mensaje queda liviano.
// Los ids "avatar" y "banner" son estables y los archivos se guardan en userData para
// sobrevivir reinicios (si no, al reiniciar se rompían para los demás).
const PROFILE_ASSETS = ['avatar', 'banner', 'particle', 'deco'];

function profileAssetDirectory() {
	return path.join(app.getPath('userData'), 'profile-assets');
}

function assetMime(filePath) {
	if (/\.gif$/i.test(filePath)) return 'image/gif';
	if (/\.png$/i.test(filePath)) return 'image/png';
	if (/\.jpe?g$/i.test(filePath)) return 'image/jpeg';
	return 'image/webp';
}

/**
 * Las versiones anteriores (0.1.5 a 0.1.9) guardaban sólo el avatar en userData/avatar.
 * Se migra una vez para que al actualizar no se pierda la foto.
 */
function migrateLegacyAvatar() {
	try {
		const legacy = path.join(app.getPath('userData'), 'avatar');
		const files = fs.readdirSync(legacy).filter((name) => name.startsWith('avatar.'));
		if (files.length === 0) return;
		const dir = profileAssetDirectory();
		fs.mkdirSync(dir, {recursive: true});
		const target = path.join(dir, files[0]);
		if (!fs.existsSync(target)) {
			fs.copyFileSync(path.join(legacy, files[0]), target);
			console.log('[pelacord] avatar migrado a la carpeta nueva');
		}
	} catch {
		// nada que migrar
	}
}

function registerSavedProfileAssets() {	try {
		const dir = profileAssetDirectory();
		let restored = 0;
		for (const name of fs.readdirSync(dir)) {
			const match = /^(avatar|banner|particle|deco)\.(gif|webp|png|jpe?g)$/i.exec(name);
			if (!match) continue;
			const filePath = path.join(dir, name);
			sharedFiles.set(match[1], {
				path: filePath,
				name,
				mime: assetMime(name),
				size: fs.statSync(filePath).size,
			});
			restored += 1;
		}
		if (restored > 0) console.log(`[pelacord] assets de perfil restaurados: ${restored}`);
	} catch {
		// sin assets guardados: no pasa nada
	}
}

ipcMain.handle('pelacord:share-profile-asset', (_event, payload) => {
	const {kind, name, mime, data} = payload ?? {};
	if (!PROFILE_ASSETS.includes(kind) || !data) return false;
	try {
		const dir = profileAssetDirectory();
		fs.mkdirSync(dir, {recursive: true});
		// Se borra la versión anterior de ese asset (puede tener otra extensión).
		for (const existing of fs.readdirSync(dir)) {
			if (existing.startsWith(`${kind}.`)) {
				try {
					fs.unlinkSync(path.join(dir, existing));
				} catch {
					// se ignora
				}
			}
		}
		const animated = mime === 'image/gif' || /\.gif$/i.test(String(name ?? ''));
		const ext = animated ? 'gif' : 'webp';
		const fileName = `${kind}.${ext}`;
		const filePath = path.join(dir, fileName);
		fs.writeFileSync(filePath, Buffer.from(data));
		sharedFiles.set(kind, {
			path: filePath,
			name: fileName,
			mime: animated ? 'image/gif' : mime || 'image/webp',
			size: fs.statSync(filePath).size,
		});
		return true;
	} catch (error) {
		console.error('[pelacord] share-profile-asset error', String(error));
		return false;
	}
});

// ---------- Cache temporal de videos (se reproducen y se borran solos) ----------

function mediaDirectory() {
	return path.join(app.getPath('temp'), 'pelacord-media');
}

function cleanupMediaCache() {
	const dir = mediaDirectory();
	const maxAge = 3 * 24 * 60 * 60 * 1000;
	const now = Date.now();
	try {
		for (const entry of fs.readdirSync(dir)) {
			try {
				const filePath = path.join(dir, entry);
				if (now - fs.statSync(filePath).mtimeMs > maxAge) fs.rmSync(filePath, {force: true});
			} catch {
				// ignore
			}
		}
	} catch {
		// sin carpeta
	}
}

function registerMediaProtocol() {
	const dir = mediaDirectory();
	const peersDir = peerAvatarDirectory();
	fs.mkdirSync(dir, {recursive: true});
	fs.mkdirSync(peersDir, {recursive: true});
	cleanupMediaCache();
	protocol.handle('pelacord-media', (request) => {
		const url = new URL(request.url);
		const name = path.basename(decodeURIComponent(url.pathname));
		// pelacord-media://peer/<archivo> sirve las fotos de perfil guardadas de los demás.
		const base = url.hostname === 'peer' ? peersDir : dir;
		const filePath = path.join(base, name);
		if (!name || !fs.existsSync(filePath)) return new Response('No encontrado', {status: 404});
		return net.fetch(pathToFileURL(filePath).toString());
	});
}

/** Fotos de perfil de los demás, guardadas en disco para que sigan viéndose offline. */
function peerAvatarDirectory() {
	return path.join(app.getPath('userData'), 'peer-avatars');
}

ipcMain.handle('pelacord:cache-avatar', async (_event, payload) => {
	const {peerId, url, kind} = payload ?? {};
	if (!peerId || typeof url !== 'string' || !/^https?:/i.test(url)) return null;
	try {
		const dir = peerAvatarDirectory();
		fs.mkdirSync(dir, {recursive: true});
		const client = url.startsWith('https') ? https : http;
		const safeId = String(peerId).replace(/[^a-zA-Z0-9_-]/g, '_');
		const safeKind = kind === 'banner' || kind === 'deco' || kind === 'particle' ? kind : 'avatar';
		const result = await new Promise((resolve, reject) => {
			client
				.get(url, (response) => {
					if (response.statusCode !== 200) {
						reject(new Error(`HTTP ${response.statusCode}`));
						return;
					}
					const type = String(response.headers['content-type'] ?? '');
					const extension = type.includes('gif') ? 'gif' : type.includes('png') ? 'png' : 'webp';
					const name = `${safeId}-${safeKind}.${extension}`;
					const target = path.join(dir, name);
					const out = fs.createWriteStream(target);
					response.on('error', reject);
					out.on('error', reject);
					out.on('finish', () => out.close(() => resolve(name)));
					response.pipe(out);
				})
				.on('error', reject);
		});
		return `pelacord-media://peer/${result}`;
	} catch {
		return null;
	}
});

// ---------- Notificaciones de Windows y globito en la barra ----------

/**
 * Windows necesita que el AppUserModelID coincida con el del acceso directo para que las
 * notificaciones aparezcan con el nombre y el ícono de la app (no como "Electron").
 */
app.setAppUserModelId('app.pelacord.desktop');

/**
 * Baja la foto de quien manda el mensaje para usarla como ícono de la notificación.
 *
 * El renderer manda además `iconDataUrl` (un PNG ya convertido): eso es lo primero que se usa,
 * porque `nativeImage` no sabe leer GIF y los avatares animados caían al ícono de la app.
 * Se cachea por URL (la imagen no cambia).
 */
const notificationIcons = new Map();

async function fetchNotificationIcon(url) {
	if (!url || typeof url !== 'string' || !/^https?:/i.test(url)) return null;
	if (notificationIcons.has(url)) return notificationIcons.get(url);
	try {
		const response = await net.fetch(url);
		if (!response.ok) throw new Error(`HTTP ${response.status}`);
		const image = nativeImage.createFromBuffer(Buffer.from(await response.arrayBuffer()));
		if (image.isEmpty()) throw new Error('formato no soportado');
		notificationIcons.set(url, image);
		return image;
	} catch (error) {
		console.warn('[pelacord] no se pudo bajar la foto para la notificación:', String(error));
		return null;
	}
}

ipcMain.on('pelacord:notify', (_event, payload) => {
	const {title, body, channelId, silent, iconUrl, iconDataUrl} = payload ?? {};
	if (!title && !body) return;
	void (async () => {
		try {
			const fromDataUrl =
				typeof iconDataUrl === 'string' && iconDataUrl.startsWith('data:image/')
					? nativeImage.createFromDataURL(iconDataUrl)
					: null;
			const icon = (fromDataUrl && !fromDataUrl.isEmpty() ? fromDataUrl : null) ?? (await fetchNotificationIcon(iconUrl));
			const notification = new Notification({
				title: String(title ?? 'Pelacord'),
				body: String(body ?? ''),
				silent: Boolean(silent),
				icon: icon ?? appIconPath() ?? undefined,
			});
			notification.on('click', () => {
				if (!mainWindow || mainWindow.isDestroyed()) return;
				if (mainWindow.isMinimized()) mainWindow.restore();
				mainWindow.show();
				mainWindow.focus();
				sendToRenderer('pelacord:notification-click', {channelId});
			});
			notification.show();
		} catch (error) {
			console.error('[pelacord] notify error', String(error));
		}
	})();
});

// ---------- Atajos globales (funcionan aunque la app no tenga el foco) ----------

/** Acciones que se pueden disparar con un atajo. */
const HOTKEY_ACTIONS = ['mute', 'deafen', 'shareScreen', 'shareFocused'];
/** Atajos registrados ahora, para poder darlos de baja al cambiarlos. */
let registeredHotkeys = [];

/**
 * Registra los atajos configurados. Devuelve los que fallaron (otro programa ya los usa
 * o el formato no es válido) para poder avisar en la interfaz.
 */
function registerHotkeys(bindings) {
	for (const accelerator of registeredHotkeys) {
		try {
			globalShortcut.unregister(accelerator);
		} catch {
			// se ignora
		}
	}
	registeredHotkeys = [];
	const failed = [];
	if (!Array.isArray(bindings)) return failed;
	for (const entry of bindings) {
		const {action, accelerator} = entry ?? {};
		if (!HOTKEY_ACTIONS.includes(action) || typeof accelerator !== 'string' || !accelerator) continue;
		try {
			// No se trae la ventana al frente: el atajo tiene que funcionar sin robar el foco
			// (si no, "compartir la ventana enfocada" no tendría sentido).
			const ok = globalShortcut.register(accelerator, () => sendToRenderer('pelacord:hotkey', {action}));
			if (ok) registeredHotkeys.push(accelerator);
			else failed.push({action, accelerator});
		} catch {
			failed.push({action, accelerator});
		}
	}
	return failed;
}

ipcMain.handle('pelacord:set-hotkeys', (_event, bindings) => registerHotkeys(bindings));

/** Colores de la barra de título, para que siga el tema elegido. */
ipcMain.on('pelacord:set-titlebar', (_event, payload) => {
	if (!mainWindow || mainWindow.isDestroyed()) return;
	const {color, symbolColor} = payload ?? {};
	try {
		mainWindow.setTitleBarOverlay({
			color: color || '#1a181e',
			symbolColor: symbolColor || '#b1acbb',
			height: 40,
		});
	} catch (error) {
		console.error('[pelacord] titlebar error', String(error));
	}
});

/** Globito (overlay icon) sobre el ícono de la barra de tareas: el típico puntito rojo. */ipcMain.on('pelacord:badge', (_event, payload) => {
	if (!mainWindow || mainWindow.isDestroyed()) return;
	const {dataUrl, description} = payload ?? {};
	try {
		if (!dataUrl) {
			mainWindow.setOverlayIcon(null, '');
			return;
		}
		const image = nativeImage.createFromDataURL(String(dataUrl));
		if (image.isEmpty()) return;
		mainWindow.setOverlayIcon(image, String(description ?? 'Mensajes sin leer'));
	} catch (error) {
		console.error('[pelacord] badge error', String(error));
	}
});

// ---------- Actualizaciones (electron-updater) ----------

/**
 * URL del feed SIN la API de GitHub: `releases/latest/download` siempre apunta a la última
 * release y lo sirve el CDN. La API de GitHub permite sólo 60 pedidos/hora, así que usarla
 * con chequeos seguidos hacía que la cuota se agotara y las actualizaciones no llegaran.
 */
const UPDATE_FEED_URL =
	process.env.PELACORD_UPDATE_URL || 'https://github.com/balti4152/pelacord/releases/latest/download';

/**
 * Cada cuánto se vuelve a chequear MIENTRAS la app está abierta (1 minuto), así una versión
 * nueva aparece sola sin tener que cerrar y volver a abrir. Si un chequeo falla, el intervalo
 * se duplica hasta 30 minutos para no golpear de más. Además se chequea siempre al iniciar.
 */
const UPDATE_INTERVAL_MS = Number(process.env.PELACORD_UPDATE_INTERVAL || 60000);
/**
 * Tope del backoff. Se deja bajo a propósito: un 404 suele ser transitorio (la release
 * todavía se estaba subiendo), así que conviene reintentar pronto y no esperar media hora.
 */
const UPDATE_MAX_INTERVAL_MS = 300000;

/** Deja un registro en userData para poder diagnosticar si algo falla. */
function logUpdater(message) {
	console.log(`[pelacord] ${message}`);
	try {
		const file = path.join(app.getPath('userData'), 'updater.log');
		fs.appendFileSync(file, `${new Date().toISOString()} ${message}\n`);
	} catch {
		// si no se puede escribir, no pasa nada
	}
}

function setupUpdater() {
	if (!autoUpdater) return;
	// El feed va por el CDN (sin API): se puede chequear seguido sin agotar la cuota.
	try {
		autoUpdater.setFeedURL({provider: 'generic', url: UPDATE_FEED_URL});
	} catch (error) {
		console.error('[pelacord] setFeedURL error', String(error));
	}
	autoUpdater.autoDownload = true;
	autoUpdater.autoInstallOnAppQuit = true;
	const send = (payload) => sendToRenderer('pelacord:update-status', payload);
	autoUpdater.on('checking-for-update', () => send({state: 'checking'}));
	autoUpdater.on('update-available', (info) => {
		logUpdater(`actualización disponible: ${info?.version}`);
		send({state: 'available', version: info?.version});
	});
	autoUpdater.on('update-not-available', (info) => {
		logUpdater(`al día (última: ${info?.version ?? '?'})`);
		send({state: 'none'});
	});
	autoUpdater.on('download-progress', (progress) => send({state: 'downloading', percent: Math.round(progress?.percent ?? 0)}));
	autoUpdater.on('update-downloaded', (info) => {
		logUpdater(`descargada: ${info?.version}`);
		send({state: 'downloaded', version: info?.version});
	});
	autoUpdater.on('error', (error) => {
		logUpdater(`error: ${String(error?.message ?? error)}`);
		send({state: 'error', error: String(error?.message ?? error)});
	});
	if (!app.isPackaged) {
		logUpdater('sin chequear: la app no está empaquetada (modo dev)');
		return;
	}

	let downloading = false;
	let loop = null;

	autoUpdater.on('update-available', () => {
		downloading = true;
	});
	autoUpdater.on('update-downloaded', () => {
		downloading = false;
		// Ya está descargada: se deja de chequear (queda el cartel de "Reiniciar").
		if (loop) loop.stop();
	});
	autoUpdater.on('error', () => {
		downloading = false;
	});

	// Chequeo periódico mientras la app está abierta: una versión nueva aparece sola.
	loop = startUpdateLoop({
		task: () => autoUpdater.checkForUpdates(),
		interval: UPDATE_INTERVAL_MS,
		maxInterval: UPDATE_MAX_INTERVAL_MS,
		delay: 5000,
		shouldSkip: () => downloading,
		log: () => logUpdater('chequeando…'),
	});
	app.on('before-quit', () => loop.stop());
}

ipcMain.handle('pelacord:check-update', async () => {
	if (!autoUpdater || !app.isPackaged) return {ok: false, error: 'solo en la app instalada'};
	try {
		await autoUpdater.checkForUpdates();
		return {ok: true};
	} catch (error) {
		return {ok: false, error: String(error?.message ?? error)};
	}
});

ipcMain.handle('pelacord:get-login-item', () => loginItemEnabled());

ipcMain.handle('pelacord:set-login-item', (_event, enabled) => {
	setLoginItem(Boolean(enabled));
	return loginItemEnabled();
});

ipcMain.handle('pelacord:install-update', () => {
	if (!autoUpdater) return false;
	try {
		// Hay que salir de verdad: si no, el cierre sólo esconde la ventana.
		isQuitting = true;
		// Silencioso y volviendo a abrir la app sola: el usuario no ve el instalador.
		autoUpdater.quitAndInstall(true, true);
		return true;
	} catch {
		return false;
	}
});

ipcMain.handle('pelacord:cache-media', async (_event, payload) => {	const {url, name} = payload ?? {};
	if (!url || !name) return {ok: false, error: 'datos'};
	const dir = mediaDirectory();
	fs.mkdirSync(dir, {recursive: true});
	const safe = String(name).replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_');
	const target = path.join(dir, safe);
	if (fs.existsSync(target) && fs.statSync(target).size > 0) return {ok: true, name: safe};
	try {
		const client = url.startsWith('https') ? https : http;
		await new Promise((resolve, reject) => {
			client
				.get(url, (response) => {
					if (response.statusCode !== 200 && response.statusCode !== 206) {
						reject(new Error(`HTTP ${response.statusCode}`));
						return;
					}
					const out = fs.createWriteStream(target);
					response.on('error', reject);
					out.on('error', reject);
					out.on('finish', () => out.close(() => resolve()));
					response.pipe(out);
				})
				.on('error', reject);
		});
		return {ok: true, name: safe};
	} catch (error) {
		try {
			fs.rmSync(target, {force: true});
		} catch {
			// ignore
		}
		return {ok: false, error: String(error)};
	}
});

const activeDownloads = new Map();

ipcMain.handle('pelacord:cancel-download', (_event, id) => {
	const entry = activeDownloads.get(id);
	if (!entry) return false;
	entry.cancelled = true;
	try {
		entry.request?.destroy();
	} catch {
		// ignore
	}
	return true;
});

ipcMain.handle('pelacord:download-file', async (_event, payload) => {
	const {url, name, size} = payload ?? {};
	if (!url || !name) return {ok: false, error: 'datos inválidos'};
	const dir = app.getPath('downloads');
	const safe = String(name).replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_');
	let target = path.join(dir, safe);
	let counter = 1;
	while (fs.existsSync(target)) {
		const ext = path.extname(safe);
		target = path.join(dir, `${path.basename(safe, ext)} (${counter++})${ext}`);
	}
	const part = `${target}.part`;
	const startSize = fs.existsSync(part) ? fs.statSync(part).size : 0;
	const downloadId = crypto.randomUUID();
	activeDownloads.set(downloadId, {request: null, part, cancelled: false});
	const progress = (extra) => sendToRenderer('pelacord:download-progress', {id: downloadId, name: safe, ...extra});
	// Informa de una el punto de reanudación (si hay un .part previo).
	if (startSize > 0) progress({received: startSize, total: size || 0, speed: 0});
	try {
		await new Promise((resolve, reject) => {
			const client = url.startsWith('https') ? https : http;
			const request = client.get(url, {headers: startSize > 0 ? {Range: `bytes=${startSize}-`} : {}}, (response) => {
				if (response.statusCode !== 200 && response.statusCode !== 206) {
					reject(new Error(`HTTP ${response.statusCode}`));
					return;
				}
				const total = startSize + (Number(response.headers['content-length']) || 0);
				const out = fs.createWriteStream(part, {flags: startSize > 0 ? 'a' : 'w'});
				let received = startSize;
				let lastEmit = Date.now();
				let lastBytes = received;
				response.on('data', (chunk) => {
					received += chunk.length;
					const now = Date.now();
					if (now - lastEmit >= 300) {
						const speed = (received - lastBytes) / ((now - lastEmit) / 1000);
						progress({received, total, speed});
						lastEmit = now;
						lastBytes = received;
					}
				});
				response.on('error', reject);
				out.on('error', reject);
				out.on('finish', () => out.close(() => resolve()));
				response.pipe(out);
			});
			const entry = activeDownloads.get(downloadId);
			if (entry) entry.request = request;
			request.on('error', reject);
		});
		activeDownloads.delete(downloadId);
		fs.renameSync(part, target);
		progress({received: fs.statSync(target).size, total: fs.statSync(target).size, done: true, path: target});
		return {ok: true, path: target};
	} catch (error) {
		const entry = activeDownloads.get(downloadId);
		activeDownloads.delete(downloadId);
		if (entry?.cancelled) {
			// Cancelar a propósito: se borra el temporal.
			try {
				fs.rmSync(part, {force: true});
			} catch {
				// ignore
			}
			progress({cancelled: true});
			return {ok: false, cancelled: true};
		}
		// Se cortó (red, etc.): se CONSERVA el .part para poder reanudar.
		progress({error: String(error), resumable: true});
		return {ok: false, error: String(error), resumable: true};
	}
});

let selectedSourceId = null;

ipcMain.handle('pelacord:desktop-sources', async () => {
	try {
		const sources = await desktopCapturer.getSources({
			types: ['screen', 'window'],
			thumbnailSize: {width: 320, height: 180},
			fetchWindowIcons: true,
		});
		return sources.map((source) => ({
			id: source.id,
			name: source.name,
			thumbnail: source.thumbnail ? source.thumbnail.toDataURL() : '',
			appIcon: source.appIcon ? source.appIcon.toDataURL() : '',
			kind: source.id.startsWith('screen:') ? 'screen' : 'window',
		}));
	} catch (error) {
		console.error('[pelacord] desktopCapturer error', String(error));
		return [];
	}
});

ipcMain.on('pelacord:select-source', (_event, id) => {
	selectedSourceId = typeof id === 'string' ? id : null;
});

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
	app.quit();
} else {
	app.on('second-instance', () => {
		// Si ya está abierta (aunque esté oculta en la bandeja), se trae al frente.
		showWindow();
	});

	app.whenReady().then(() => {
		// yt-dlp se actualiza solo (canal nightly) al arrancar y cada 6 h: YouTube cambia seguido
		// y un binario viejo deja de funcionar. Es best-effort: nunca bloquea ni molesta.
		void updateYtDlp();
		setInterval(() => void updateYtDlp(), 6 * 60 * 60 * 1000);
		session.defaultSession.setDisplayMediaRequestHandler(async (_request, callback) => {			try {
				const sources = await desktopCapturer.getSources({types: ['screen', 'window']});
				const chosen = (selectedSourceId && sources.find((source) => source.id === selectedSourceId)) || sources[0];
				if (!chosen) {
					callback({});
					return;
				}
				callback({video: chosen, audio: 'loopback'});
			} catch {
				callback({});
			}
		});
		startServer();
		startDiscovery();
		startFileServer();
		migrateLegacyAvatar();
		registerSavedProfileAssets();
		restoreSharedFiles();
		registerMediaProtocol();
		setupUpdater();
		createWindow();
		createTray();
		app.on('activate', () => {
			if (BrowserWindow.getAllWindows().length === 0) createWindow();
		});
	});
}

app.on('window-all-closed', () => {
	if (process.platform !== 'darwin') app.quit();
});

// Salir de verdad (bandeja, actualización o apagado) no debe esconderse.
app.on('before-quit', () => {
	isQuitting = true;
});

// Los atajos globales hay que darlos de baja al salir.
app.on('will-quit', () => {
	try {
		globalShortcut.unregisterAll();
	} catch {
		// se ignora
	}
});
