// Proceso principal de la app de escritorio de Pelacord.
//
// Sin servidor y sin configuración manual:
//   - Descubre a los demás peers automáticamente por broadcast UDP sobre la red de ZeroTier.
//   - Abre un servidor WebSocket de señalización en el puerto PORT.
//   - Se conecta directo a cada peer descubierto y rutea presencia y señales WebRTC.
//
// Nadie edita nada: cada uno abre la app, pone su nombre y ya se ve con los demás.

const {app, BrowserWindow, desktopCapturer, ipcMain, net, protocol, session, shell} = require('electron');
const path = require('node:path');
const os = require('node:os');
const dgram = require('node:dgram');
const http = require('node:http');
const https = require('node:https');
const fs = require('node:fs');
const crypto = require('node:crypto');
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

function broadcast(message, exceptSocket) {
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

function createWindow() {
	mainWindow = new BrowserWindow({
		width: 1280,
		height: 800,
		minWidth: 940,
		backgroundColor: '#0b0912',
		autoHideMenuBar: true,
		webPreferences: {
			preload: path.join(__dirname, 'preload.cjs'),
			contextIsolation: true,
			nodeIntegration: false,
			autoplayPolicy: 'no-user-gesture-required',
		},
	});
	mainWindow.webContents.setWindowOpenHandler(({url}) => {
		void shell.openExternal(url);
		return {action: 'deny'};
	});
	if (process.env.PELACORD_DEV_URL || !app.isPackaged) {
		void mainWindow.loadURL(DEV_URL);
	} else {
		void mainWindow.loadFile(path.join(__dirname, '..', 'dist', 'index.html'));
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

ipcMain.on('pelacord:signal', (_event, message) => {
	if (!myPeerId || !message) return;
	broadcast({type: 'signal', from: myPeerId, to: message.to, payload: message.payload});
});

ipcMain.handle('pelacord:peers', () => [...peers.keys()]);

// ---------- Compartir archivos (servidos desde el disco, con reanudación) ----------

/** id -> {path, name, size, mime} */
const sharedFiles = new Map();
let fileServerPort = 0;

function localAddress() {
	const all = localInterfaces();
	const zt = all.find((entry) => entry.isZeroTier);
	return (zt ?? all[0])?.address ?? '127.0.0.1';
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
		const match = /^\/file\/(.+)$/.exec(new URL(req.url, 'http://localhost').pathname);
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
	server.listen(0, '0.0.0.0', () => {
		fileServerPort = server.address().port;
		console.log(`[pelacord] servidor de archivos en tcp/${fileServerPort}`);
	});
	server.on('error', (error) => console.error('[pelacord] file server error', error.message));
}

ipcMain.handle('pelacord:file-endpoint', () => ({host: localAddress(), port: fileServerPort}));

ipcMain.handle('pelacord:share-file', (_event, payload) => {
	const {filePath, name, mime, size} = payload ?? {};
	if (!filePath || !fs.existsSync(filePath)) return null;
	const id = crypto.randomUUID();
	sharedFiles.set(id, {path: filePath, name: name || path.basename(filePath), mime: mime || '', size: size || fs.statSync(filePath).size});
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
const PROFILE_ASSETS = ['avatar', 'banner'];

function profileAssetDirectory() {
	return path.join(app.getPath('userData'), 'profile-assets');
}

function assetMime(filePath) {
	if (/\.gif$/i.test(filePath)) return 'image/gif';
	if (/\.png$/i.test(filePath)) return 'image/png';
	if (/\.jpe?g$/i.test(filePath)) return 'image/jpeg';
	return 'image/webp';
}

function registerSavedProfileAssets() {
	try {
		const dir = profileAssetDirectory();
		let restored = 0;
		for (const name of fs.readdirSync(dir)) {
			const match = /^(avatar|banner)\.(gif|webp|png|jpe?g)$/i.exec(name);
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
	fs.mkdirSync(dir, {recursive: true});
	cleanupMediaCache();
	protocol.handle('pelacord-media', (request) => {
		const url = new URL(request.url);
		const name = path.basename(decodeURIComponent(url.pathname));
		const filePath = path.join(dir, name);
		if (!name || !fs.existsSync(filePath)) return new Response('No encontrado', {status: 404});
		return net.fetch(pathToFileURL(filePath).toString());
	});
}

// ---------- Actualizaciones (electron-updater) ----------

/**
 * Cada cuánto se vuelve a chequear MIENTRAS la app está abierta, así una versión nueva
 * aparece sola sin tener que cerrar y volver a abrir. Si un chequeo falla (sin internet,
 * rate limit), el intervalo se duplica hasta 5 minutos para no golpear de más.
 */
const UPDATE_INTERVAL_MS = Number(process.env.PELACORD_UPDATE_INTERVAL || 10000);
const UPDATE_MAX_INTERVAL_MS = 300000;

function setupUpdater() {
	if (!autoUpdater) return;
	// Se puede pisar el feed con PELACORD_UPDATE_URL (carpeta estática, GitHub Releases, R2, etc.).
	if (process.env.PELACORD_UPDATE_URL) {
		try {
			autoUpdater.setFeedURL({provider: 'generic', url: process.env.PELACORD_UPDATE_URL});
		} catch (error) {
			console.error('[pelacord] setFeedURL error', String(error));
		}
	}
	autoUpdater.autoDownload = true;
	autoUpdater.autoInstallOnAppQuit = true;
	const send = (payload) => sendToRenderer('pelacord:update-status', payload);
	autoUpdater.on('checking-for-update', () => send({state: 'checking'}));
	autoUpdater.on('update-available', (info) => send({state: 'available', version: info?.version}));
	autoUpdater.on('update-not-available', () => send({state: 'none'}));
	autoUpdater.on('download-progress', (progress) => send({state: 'downloading', percent: Math.round(progress?.percent ?? 0)}));
	autoUpdater.on('update-downloaded', (info) => send({state: 'downloaded', version: info?.version}));
	autoUpdater.on('error', (error) => send({state: 'error', error: String(error?.message ?? error)}));
	if (!app.isPackaged) return;

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

	// Chequeo periódico mientras la app está abierta: una versión nueva aparece sola,
	// sin tener que cerrar y volver a abrir.
	loop = startUpdateLoop({
		task: () => autoUpdater.checkForUpdates(),
		interval: UPDATE_INTERVAL_MS,
		maxInterval: UPDATE_MAX_INTERVAL_MS,
		delay: 5000,
		shouldSkip: () => downloading,
		log: () => console.log(`[pelacord] chequeo de actualización (${new Date().toLocaleTimeString()})`),
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

ipcMain.handle('pelacord:install-update', () => {
	if (!autoUpdater) return false;
	try {
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
		if (mainWindow) {
			if (mainWindow.isMinimized()) mainWindow.restore();
			mainWindow.focus();
		}
	});

	app.whenReady().then(() => {
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
		registerSavedProfileAssets();
		registerMediaProtocol();
		setupUpdater();
		createWindow();
		app.on('activate', () => {
			if (BrowserWindow.getAllWindows().length === 0) createWindow();
		});
	});
}

app.on('window-all-closed', () => {
	if (process.platform !== 'darwin') app.quit();
});
