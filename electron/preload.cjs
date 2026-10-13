// Preload: exposes the desktop transport bridge to the renderer.
const {contextBridge, ipcRenderer, webUtils} = require('electron');

contextBridge.exposeInMainWorld('pelacordTransport', {
	isDesktop: true,
	hello: (identity) => ipcRenderer.send('pelacord:hello', identity),
	publishPresence: (payload) => ipcRenderer.send('pelacord:presence', payload),
	sendSignal: (to, payload) => ipcRenderer.send('pelacord:signal', {to, payload}),
	/** Comando para un peer puntual (moverlo de canal de voz, etc.). */
	sendCommand: (to, payload) => ipcRenderer.send('pelacord:command', {to, payload}),
	sendMusic: (payload) => ipcRenderer.send('pelacord:music', payload),
	onMusic: (callback) => {
		const handler = (_event, message) => callback(message);
		ipcRenderer.on('pelacord:music', handler);
		return () => ipcRenderer.removeListener('pelacord:music', handler);
	},
	sendMessages: (payload, to) => ipcRenderer.send('pelacord:messages', {to, payload}),
	onMessages: (callback) => {
		const handler = (_event, message) => callback(message);
		ipcRenderer.on('pelacord:messages', handler);
		return () => ipcRenderer.removeListener('pelacord:messages', handler);
	},
	onCommand: (callback) => {
		const handler = (_event, message) => callback(message);
		ipcRenderer.on('pelacord:command', handler);
		return () => ipcRenderer.removeListener('pelacord:command', handler);
	},
	onPresence: (callback) => {
		const handler = (_event, message) => callback(message);
		ipcRenderer.on('pelacord:presence', handler);
		return () => ipcRenderer.removeListener('pelacord:presence', handler);
	},
	onSignal: (callback) => {
		const handler = (_event, message) => callback(message);
		ipcRenderer.on('pelacord:signal', handler);
		return () => ipcRenderer.removeListener('pelacord:signal', handler);
	},
	onPeerLeft: (callback) => {
		const handler = (_event, message) => callback(message);
		ipcRenderer.on('pelacord:peer-left', handler);
		return () => ipcRenderer.removeListener('pelacord:peer-left', handler);
	},
	getRoster: () => ipcRenderer.invoke('pelacord:roster'),
	getRosterPath: () => ipcRenderer.invoke('pelacord:rosterPath'),
	getPeers: () => ipcRenderer.invoke('pelacord:peers'),
	getDesktopSources: () => ipcRenderer.invoke('pelacord:desktop-sources'),
	selectSource: (id) => ipcRenderer.send('pelacord:select-source', id),
	getFileEndpoint: () => ipcRenderer.invoke('pelacord:file-endpoint'),
	/** Preview de un link (título, descripción, imagen). */
	getLinkPreview: (url) => ipcRenderer.invoke('pelacord:link-preview', url),
	/** Música: versión de yt-dlp, búsqueda y URL de audio para streamear. */
	getYtDlpVersion: () => ipcRenderer.invoke('pelacord:ytdlp-version'),
	searchYouTube: (query, limit) => ipcRenderer.invoke('pelacord:yt-search', query, limit),
	getAudioUrl: (target) => ipcRenderer.invoke('pelacord:yt-audio-url', target),
	shareFile: (payload) => ipcRenderer.invoke('pelacord:share-file', payload),
	shareBuffer: (payload) => ipcRenderer.invoke('pelacord:share-buffer', payload),
	shareAvatar: (payload) => ipcRenderer.invoke('pelacord:share-avatar', payload),
	shareProfileAsset: (payload) => ipcRenderer.invoke('pelacord:share-profile-asset', payload),
	cacheMedia: (payload) => ipcRenderer.invoke('pelacord:cache-media', payload),
	openPath: (target) => ipcRenderer.invoke('pelacord:open-path', target),
	downloadFile: (payload) => ipcRenderer.invoke('pelacord:download-file', payload),
	cancelDownload: (id) => ipcRenderer.invoke('pelacord:cancel-download', id),
	onDownloadProgress: (callback) => {
		const handler = (_event, message) => callback(message);
		ipcRenderer.on('pelacord:download-progress', handler);
		return () => ipcRenderer.removeListener('pelacord:download-progress', handler);
	},
	getPathForFile: (file) => webUtils.getPathForFile(file),
	notify: (payload) => ipcRenderer.send('pelacord:notify', payload),
	cacheAvatar: (payload) => ipcRenderer.invoke('pelacord:cache-avatar', payload),
	getLoginItem: () => ipcRenderer.invoke('pelacord:get-login-item'),
	setLoginItem: (enabled) => ipcRenderer.invoke('pelacord:set-login-item', enabled),
	setHotkeys: (bindings) => ipcRenderer.invoke('pelacord:set-hotkeys', bindings),
	onHotkey: (callback) => {
		const handler = (_event, message) => callback(message);
		ipcRenderer.on('pelacord:hotkey', handler);
		return () => ipcRenderer.removeListener('pelacord:hotkey', handler);
	},
	setBadge: (payload) => ipcRenderer.send('pelacord:badge', payload),
	setTitleBar: (payload) => ipcRenderer.send('pelacord:set-titlebar', payload),
	onNotificationClick: (callback) => {
		const handler = (_event, message) => callback(message);
		ipcRenderer.on('pelacord:notification-click', handler);
		return () => ipcRenderer.removeListener('pelacord:notification-click', handler);
	},
	checkUpdate: () => ipcRenderer.invoke('pelacord:check-update'),
	installUpdate: () => ipcRenderer.invoke('pelacord:install-update'),
	onUpdateStatus: (callback) => {
		const handler = (_event, message) => callback(message);
		ipcRenderer.on('pelacord:update-status', handler);
		return () => ipcRenderer.removeListener('pelacord:update-status', handler);
	},
});
