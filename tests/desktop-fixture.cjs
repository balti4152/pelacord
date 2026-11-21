const {app, ipcMain, session} = require('electron');
const {setTimeout: delay} = require('node:timers/promises');

app.setPath('userData', process.env.PELACORD_TEST_PROFILE);
app.setPath('downloads', process.env.PELACORD_TEST_PROFILE);
app.commandLine.appendSwitch('use-fake-device-for-media-stream');
app.commandLine.appendSwitch('use-fake-ui-for-media-stream');
app.commandLine.appendSwitch('disable-background-timer-throttling');
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
	}
	handle(channel, handler);
};

require('../electron/main.cjs');
