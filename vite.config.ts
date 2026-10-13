import {defineConfig} from 'vite';
import react from '@vitejs/plugin-react';
import {fileURLToPath, URL} from 'node:url';
import pkg from './package.json';

export default defineConfig({
	base: './',
	plugins: [react()],
	define: {
		__BUILD_TIME__: JSON.stringify(new Date().toISOString()),
		__APP_VERSION__: JSON.stringify(pkg.version),
	},
	resolve: {
		alias: {
			'@': fileURLToPath(new URL('./src', import.meta.url)),
		},
	},
	server: {
		port: 5175,
		host: true,
	},
});
