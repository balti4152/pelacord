// Run with `npm run dev` and `node tests/desktop-integration.test.cjs`.
const assert = require('node:assert/strict');
const {spawn} = require('node:child_process');
const {once} = require('node:events');
const fs = require('node:fs/promises');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const {setTimeout: delay} = require('node:timers/promises');
const {WebSocket} = require('ws');

const devUrl = process.env.PELACORD_TEST_DEV_URL || 'http://127.0.0.1:5175';
const cleanup = [];

async function eventually(probe, label, timeout = 12000) {
	const until = Date.now() + timeout;
	let last;
	while (Date.now() < until) {
		try {
			const value = await probe();
			if (value) return value;
		} catch (error) {
			last = error;
		}
		await delay(120);
	}
	throw new Error(`Timeout: ${label}${last ? ` (${last.message})` : ''}`);
}

async function listen(handler) {
	const server = http.createServer(handler);
	server.listen(0, '127.0.0.1');
	await once(server, 'listening');
	return server;
}

function makeWav() {
	const size = 90 * 8000;
	const wav = Buffer.alloc(44 + size, 128);
	wav.write('RIFF');
	wav.writeUInt32LE(36 + size, 4);
	wav.write('WAVEfmt ', 8);
	wav.writeUInt32LE(16, 16);
	wav.writeUInt16LE(1, 20);
	wav.writeUInt16LE(1, 22);
	wav.writeUInt32LE(8000, 24);
	wav.writeUInt32LE(8000, 28);
	wav.writeUInt16LE(1, 32);
	wav.writeUInt16LE(8, 34);
	wav.write('data', 36);
	wav.writeUInt32LE(size, 40);
	return wav;
}

async function startElectron(id, root, fixtureUrl, signalling = '0') {
	const reserved = await listen();
	const debug = reserved.address().port;
	await new Promise((resolve) => reserved.close(resolve));
	const profile = await fs.mkdtemp(path.join(root, `${id}-`));
	const child = spawn(require('electron'), [path.join(__dirname, 'desktop-fixture.cjs'), '--hidden', `--remote-debugging-port=${debug}`], {
		env: {...process.env, PELACORD_TEST_PROFILE: profile, PELACORD_DEV_URL: devUrl, PELACORD_TEST_HTTP: fixtureUrl, PELACORD_PORT: signalling, PELACORD_DISCOVERY_PORT: '0'},
		windowsHide: true,
	});
	let logs = '';
	child.stdout.on('data', (data) => { logs += data; });
	child.stderr.on('data', (data) => { logs += data; });
	cleanup.push(async () => {
		if (child.exitCode === null && child.signalCode === null) {
			const exited = once(child, 'exit');
			child.kill();
			await exited;
		}
	});
	const targets = await eventually(async () => {
		const list = await (await fetch(`http://127.0.0.1:${debug}/json/list`)).json();
		return list.find((entry) => entry.type === 'page' && entry.url.startsWith(devUrl));
	}, `${id} window`).catch((error) => { throw new Error(`${error.message}\n${logs}`); });
	const ws = new WebSocket(targets.webSocketDebuggerUrl);
	await once(ws, 'open');
	cleanup.push(() => ws.terminate());
	let sequence = 0;
	const pending = new Map();
	ws.on('message', (data) => {
		const message = JSON.parse(data);
		const callback = pending.get(message.id);
		if (!callback) return;
		pending.delete(message.id);
		callback(message);
	});
	const call = (method, params = {}) => new Promise((resolve, reject) => {
		const id = ++sequence;
		const timeout = setTimeout(() => { pending.delete(id); reject(new Error(`CDP ${method}`)); }, 16000);
		pending.set(id, (message) => {
			clearTimeout(timeout);
			if (message.error) reject(new Error(message.error.message));
			else resolve(message.result);
		});
		ws.send(JSON.stringify({id, method, params}));
	});
	const js = async (expression) => {
		const result = await call('Runtime.evaluate', {expression, awaitPromise: true, returnByValue: true});
		if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);
		return result.result.value;
	};
	const seed = `
		localStorage.clear();
		localStorage.setItem('pelacord.identity', ${JSON.stringify(JSON.stringify({id, name: id, color: '#7654e0'}))});
		localStorage.setItem('pelacord.named', '1');
	`;
	const watchAudio = `
		const NativeAudio = window.Audio;
		window.Audio = class extends NativeAudio {
			constructor(...args) { super(...args); if (!args.length) window.lastAudio = this; }
		};
	`;
	await call('Page.enable');
	await eventually(() => js(`location.origin === ${JSON.stringify(devUrl)}`), `${id} local origin`);
	await js(`(() => { ${seed} })()`);
	await call('Page.navigate', {url: `${devUrl}/?desktop-test=${id}`});
	await eventually(() => js('!!document.querySelector(".chat-header")'), `${id} chat`).catch(async (error) => {
		throw new Error(`${error.message}\n${await js('document.body.innerText')}\n${logs}`);
	});
	await js(`(() => { ${watchAudio} })()`);
	return {js, call, logs: () => logs};
}

async function click(peer, selector, label) {
	await eventually(() => peer.js(`(() => { const button = document.querySelector(${JSON.stringify(selector)}); if (!button || button.disabled) return false; button.click(); return true; })()`), label || selector);
}

async function join(peer, channel) {
	await eventually(() => peer.js(`(() => { const button = [...document.querySelectorAll('.channel')].find((el) => el.textContent.trim() === ${JSON.stringify(channel)}); if (!button) return false; button.click(); return true; })()`), `join ${channel}`);
	await eventually(() => peer.js(`document.querySelector('.call-stage-name')?.textContent === ${JSON.stringify(channel)}`), `show ${channel}`);
}

async function queueTrack(peer, title, action) {
	await click(peer, '.sidebar .music-button');
	await eventually(() => peer.js(`(() => { const input = document.querySelector('.music-search input'); if (!input) return false;
		Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, ${JSON.stringify(title)});
		input.dispatchEvent(new Event('input', {bubbles: true})); return true; })()`), 'music search');
	await eventually(() => peer.js(`document.querySelector('.music-row-title')?.textContent.trim() === ${JSON.stringify(title)}`), `result ${title}`);
	await click(peer, `.music-row button[title^="${action}"]`);
}

async function playing(peer, title) {
	return eventually(() => peer.js(`lastAudio?.src.includes('track=' + encodeURIComponent(${JSON.stringify(title)})) && !lastAudio.paused && lastAudio.currentTime > 0`), `playing ${title}`);
}

async function run() {
	const root = await fs.mkdtemp(path.join(os.tmpdir(), 'pelacord-test-'));
	cleanup.push(() => fs.rm(root, {recursive: true, force: true, maxRetries: 4, retryDelay: 150}));
	const wav = makeWav();
	const bytes = Buffer.alloc(128 * 1024, 0x51);
	let resumeRange;
	const fixtures = await listen((req, res) => {
		res.setHeader('Access-Control-Allow-Origin', '*');
		if (req.url.startsWith('/audio.wav')) {
			res.writeHead(200, {'Content-Type': 'audio/wav', 'Content-Length': wav.length}).end(wav);
		} else if (req.headers.range) {
			resumeRange = req.headers.range;
			const start = Number(/\d+/.exec(resumeRange)[0]);
			res.writeHead(206, {'Content-Length': bytes.length - start, 'Content-Range': `bytes ${start}-${bytes.length - 1}/${bytes.length}`}).end(bytes.subarray(start));
		} else {
			res.writeHead(200, {'Content-Length': bytes.length}).write(bytes.subarray(0, 16384));
			setTimeout(() => res.destroy(), 250);
		}
	});
	cleanup.push(() => { fixtures.closeAllConnections(); fixtures.close(); });
	const fixtureUrl = `http://127.0.0.1:${fixtures.address().port}`;
	const a = await startElectron('peer-a', root, fixtureUrl);
	const portA = (await a.js('pelacordTransport.getFileEndpoint()')).port;
	const b = await startElectron('peer-b', root, fixtureUrl, String(portA));
	const portB = (await b.js('pelacordTransport.getFileEndpoint()')).port;
	assert.notEqual(portA, portB);
	assert.equal((await a.js(`pelacordTransport.setNetworkPeers('127.0.0.1:${portB}')`)).ok, true);
	await eventually(() => a.js(`pelacordTransport.getPeers().then((peers) => peers.includes('peer-b'))`), 'manual peer connection');
	await eventually(() => b.js(`pelacordTransport.getPeers().then((peers) => peers.includes('peer-a'))`), 'reciprocal hello');
	console.log('OK manual ZeroTier route, reciprocal handshake and signalling port fallback');

	await b.js(`window.relay = null; pelacordTransport.onSignal((message) => { if (message.from === 'far-away') window.relay = message; }); true`);
	const neighbor = new WebSocket(`ws://127.0.0.1:${portA}`);
	await once(neighbor, 'open');
	cleanup.push(() => neighbor.terminate());
	neighbor.send(JSON.stringify({type: 'hello', from: 'neighbor'}));
	neighbor.send(JSON.stringify({type: 'signal', from: 'far-away', to: 'peer-b', msgId: 'relay-example', payload: {kind: 'ready'}}));
	await eventually(() => b.js(`window.relay?.payload.kind === 'ready'`), 'relay addressed signal');
	const peers = await a.js('pelacordTransport.getPeers()');
	assert.ok(peers.includes('neighbor') && !peers.includes('far-away'));
	neighbor.close();
	console.log('OK directed relay preserves the physical neighbor');

	await a.js(`(() => { const dataTransfer = new DataTransfer(); dataTransfer.items.add(new File(['contenido de prueba'], 'muestra.txt', {type: 'text/plain'})); window.dispatchEvent(new DragEvent('drop', {dataTransfer, bubbles: true, cancelable: true})); })()`);
	await eventually(() => a.js(`document.querySelector('.composer-attachment-name')?.textContent === 'muestra.txt'`), 'staged attachment');
	await click(a, '[aria-label="Enviar mensaje"]');
	await eventually(() => b.js(`document.querySelector('.code-card-body')?.textContent === 'contenido de prueba'`), 'remote text preview');
	await click(b, '.attachment-file button', 'download attachment');
	await eventually(() => b.js(`document.querySelector('.attachment-file-size')?.textContent === 'Guardado en Descargas'`), 'downloaded status');
	const id = await a.js(`pelacordTransport.shareBuffer({name: 'range.txt', mime: 'text/plain', data: new TextEncoder().encode('12345').buffer})`);
	const fileUrl = `http://127.0.0.1:${portA}/file/${id}`;
	const range = await fetch(fileUrl, {headers: {Range: 'bytes=2-40000'}});
	assert.equal(range.headers.get('content-range'), 'bytes 2-4/5');
	assert.equal(await range.text(), '345');
	assert.equal((await fetch(fileUrl, {headers: {Range: 'bytes=8-9'}})).status, 416);
	assert.equal((await fetch(fileUrl, {method: 'HEAD'})).headers.get('content-length'), '5');
	const networkInfo = await a.js('pelacordTransport.getNetworkInfo()');
	for (const address of networkInfo.addresses) {
		const file = await fetch(`http://${address}/file/${id}`, {signal: AbortSignal.timeout(4000)});
		assert.equal(await file.text(), '12345');
	}
	if (networkInfo.addresses.length) console.log(`OK attachment service reachable on ${networkInfo.addresses.length} local ZeroTier adapters`);
	const download = (id) => b.js(`pelacordTransport.downloadFile({id:${JSON.stringify(id)}, attachmentId:'resume-test', url:${JSON.stringify(fixtureUrl + '/download')}, name:'resume.bin', size:${bytes.length}})`);
	assert.equal((await download('first')).resumable, true);
	const result = await download('second');
	assert.equal(result.ok, true, result.error);
	assert.equal(resumeRange, 'bytes=16384-');
	assert.deepEqual(await fs.readFile(result.path), bytes);
	console.log('OK attachment through the chat, Range/HEAD and byte-for-byte resume');

	await join(a, 'General');
	await join(b, 'General');
	for (const peer of [a, b]) await eventually(() => peer.js(`document.querySelector('.voice-panel-sub')?.textContent === 'Voz conectada'`), 'connected voice');
	await click(a, '.user-panel [title="Ajustes"]');
	await eventually(() => a.js(`(() => { const tab = [...document.querySelectorAll('.modal-nav-item')].find((button) => button.textContent.trim() === 'Voz'); if (!tab) return false; tab.click(); return true; })()`), 'voice settings');
	assert.equal(await a.js(`[...document.querySelectorAll('.settings-section button')].find((button) => button.textContent.trim() === 'Escucharme')?.disabled`), true);
	await click(a, '.modal-close');
	await queueTrack(a, 'Tema general', 'Reproducir');
	await Promise.all([playing(a, 'Tema general'), playing(b, 'Tema general')]);
	await join(a, 'Gaming');
	assert.equal(await a.js('lastAudio.paused'), true);
	await playing(b, 'Tema general');
	await queueTrack(a, 'Tema lento', 'Reproducir');
	await join(a, 'General');
	await Promise.all([playing(a, 'Tema general'), playing(b, 'Tema general')]);
	await delay(2800);
	assert.equal(await a.js('lastAudio.paused'), false);
	assert.ok(Math.abs((await a.js('lastAudio.currentTime')) - (await b.js('lastAudio.currentTime'))) < 2);
	for (const peer of [a, b]) await eventually(() => peer.js(`document.querySelector('.voice-panel-sub')?.textContent === 'Voz conectada'`), 'voice after switch');
	for (const peer of [a, b]) {
		await eventually(() => peer.js(`[...document.querySelectorAll('audio')].filter((audio) => audio.srcObject && !audio.paused).length === 1`), 'one voice player per peer');
		assert.equal(await peer.js(`document.querySelector('audio').srcObject.getAudioTracks().length`), 1);
	}
	await click(a, '.sidebar .music-button');
	await click(a, '.music-play');
	await eventually(() => b.js('lastAudio.paused'), 'host pause reaches follower');
	await click(a, '.music-skip');
	await eventually(() => b.js(`lastAudio.paused && !lastAudio.getAttribute('src')`), 'empty Jam reaches follower');
	console.log('OK voice rejoin, Jam host handoff, late audio, synchronized pause and stop');
	console.log('OK mic monitoring disabled in calls and exactly one output per voice peer');

	assert.equal(await a.js(`!!document.querySelector('.music-search') && !document.querySelector('.spotify-view')`), true);
	await click(a, '.music-tabs .spotify-tab');
	assert.equal(await a.js(`!document.querySelector('.music-search')`), true);
	if (process.env.PELACORD_TEST_SCREENSHOTS) {
		const dir = process.env.PELACORD_TEST_SCREENSHOTS;
		await fs.mkdir(dir, {recursive: true});
		await click(a, '.music-tabs button:first-child');
		const capture = async (name, peer) => {
			const {data} = await peer.call('Page.captureScreenshot', {format: 'png'});
			await fs.writeFile(path.join(dir, `${name}.png`), Buffer.from(data, 'base64'));
		};
		await capture('musica', a);
		await capture('llamada', b);
		await click(b, '[title="Volver al chat"]');
		await capture('chat', b);
	}
	console.log('OK music tabs are independent');
	if (process.env.PELACORD_TEST_YOUTUBE) {
		const url = await a.js(`pelacordTransport.getAudioUrl('jNQXAC9IVRw')`);
		assert.ok(url, 'real YouTube audio resolved');
		const res = await fetch(url, {headers: {Range: 'bytes=0-1023'}, signal: AbortSignal.timeout(15000)});
		assert.equal(res.status, 206);
		assert.equal((await res.arrayBuffer()).byteLength, 1024);
		console.log('OK YouTube audio via yt-dlp, bundled Electron Node and local HTTP proxy');
	}
}

run().catch((error) => { console.error(error); process.exitCode = 1; }).finally(async () => {
	for (const dispose of cleanup.reverse()) {
		try { await dispose(); } catch (error) { console.warn(error.message); }
	}
});
