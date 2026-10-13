// Temporal: corre la prueba de la malla (mesh-test.html) en Electron, que es el entorno real.
const {app, BrowserWindow} = require('electron');

// Igual que la app: sin mDNS, para que los candidatos sean las IPs de verdad (ZeroTier).
app.commandLine.appendSwitch('disable-features', 'WebRtcHideLocalIpsWithMdns');

app.whenReady().then(async () => {
	const win = new BrowserWindow({
		width: 900,
		height: 600,
		show: false,
		backgroundColor: '#0b0912',
		webPreferences: {contextIsolation: true, nodeIntegration: false, backgroundThrottling: false},
	});
	win.webContents.on('console-message', (_event, _level, message) => console.log(`[pagina] ${message}`));
	await win.loadURL('http://localhost:5175/tests/mesh-test.html');
	const js = (code) => win.webContents.executeJavaScript(code).catch((error) => `ERROR ${error.message}`);
	const resultado = await js(`(async () => {
		const limite = Date.now() + 80000;
		while (!window.__resultado && Date.now() < limite) await new Promise((r) => setTimeout(r, 500));
		return JSON.stringify(window.__resultado);
	})()`);
	console.log(`[prueba] ${resultado}`);
	app.quit();
});
