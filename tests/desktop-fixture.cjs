const {app, globalShortcut, ipcMain, session} = require('electron');
const {setTimeout: delay} = require('node:timers/promises');

app.setPath('userData', process.env.PELACORD_TEST_PROFILE);
app.setPath('downloads', process.env.PELACORD_TEST_PROFILE);
app.commandLine.appendSwitch('use-fake-device-for-media-stream');
if (!process.env.PELACORD_TEST_NATIVE_SHARE) app.commandLine.appendSwitch('use-fake-ui-for-media-stream');
app.commandLine.appendSwitch('disable-background-timer-throttling');
app.on('web-contents-created', (_event, contents) => contents.setAudioMuted(true));
app.whenReady().then(() => {
	session.defaultSession.webRequest.onBeforeRequest((details, callback) => {
		const url = new URL(details.url);
		const external = /^https?:$/.test(url.protocol) && !['127.0.0.1', 'localhost'].includes(url.hostname);
		callback({cancel: external});
	});
});

const handle = ipcMain.handle.bind(ipcMain);
ipcMain.handle = (channel, handler) => {
	if (channel === 'pelacord:yt-search') {
		handler = (_event, title) => [{id: title, title, author: 'Prueba', duration: 90, url: title, thumbnail: ''}];
	} else if (channel === 'pelacord:yt-audio-url') {
		const resolveRealAudio = handler;
		handler = async (event, id) => {
			if (process.env.PELACORD_TEST_YOUTUBE && id === 'jNQXAC9IVRw') return resolveRealAudio(event, id);
			if (id === 'Tema lento') await delay(2500);
			return `${process.env.PELACORD_TEST_HTTP}/audio.wav?track=${encodeURIComponent(id)}`;
		};
	} else if (channel === 'pelacord:spotify-discover') {
		handler = () => ({playlists: []});
	} else if (channel === 'pelacord:desktop-sources' && process.env.PELACORD_TEST_UI) {
		const sources = [
			{kind: 'window', name: 'Notas de la reunión', color: '#ddd6ff'},
			{kind: 'window', name: 'Navegador', color: '#ade0d6'},
			{kind: 'window', name: 'Editor de código', color: '#685b95'},
			{kind: 'window', name: 'Explorador de archivos', color: '#a3c3ff'},
			{kind: 'screen', name: 'Pantalla principal', color: '#adc7e8'},
		];
		handler = () => sources.map(({kind, name, color}, index) => ({
			kind, name, id: `${kind}:${index + 100}:0`, appIcon: '',
			thumbnail: 'data:image/svg+xml;base64,' + Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 320 180"><rect width="320" height="180" fill="${color}"/><rect x="22" y="20" width="276" height="140" rx="8" fill="#242139"/><path d="M45 55h230m-230 22h160m-160 22h200m-200 22h100" stroke="${color}" stroke-width="6" opacity=".7"/></svg>`).toString('base64'),
		}));
	} else if (channel === 'pelacord:set-hotkeys' && process.env.PELACORD_TEST_HOTKEYS) {
		const configure = handler;
		handler = (event, bindings) => {
			if (bindings?.[0]?.action !== 'probe') return configure(event, bindings);
			return globalShortcut.register(bindings[0].accelerator, () => event.sender.send('pelacord:hotkey', {action: 'probe'})) ? [] : bindings;
		};
	}
	handle(channel, handler);
};

require('../electron/main.cjs');
