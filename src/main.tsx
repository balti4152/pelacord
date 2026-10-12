import React from 'react';
import ReactDOM from 'react-dom/client';
import {App} from '@/App';
import {ErrorBoundary} from '@/components/ErrorBoundary';
import {StoreProvider} from '@/state/store';
import '@/styles/theme.css';
import '@/styles/global.css';
import '@/styles/app.css';

const rootElement = document.getElementById('root');
if (!rootElement) {
	throw new Error('Missing #root element');
}

window.addEventListener('error', (event) => {
	console.error('[pelacord-error] window error:', event.error ?? event.message);
});
window.addEventListener('unhandledrejection', (event) => {
	console.error('[pelacord-error] unhandled rejection:', event.reason);
});

ReactDOM.createRoot(rootElement).render(
	<React.StrictMode>
		<ErrorBoundary>
			<StoreProvider>
				<App />
			</StoreProvider>
		</ErrorBoundary>
	</React.StrictMode>,
);
