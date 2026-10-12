import React from 'react';
import ReactDOM from 'react-dom/client';
import {App} from '@/App';
import {StoreProvider} from '@/state/store';
import '@/styles/theme.css';
import '@/styles/global.css';
import '@/styles/app.css';

const rootElement = document.getElementById('root');
if (!rootElement) {
	throw new Error('Missing #root element');
}

ReactDOM.createRoot(rootElement).render(
	<React.StrictMode>
		<StoreProvider>
			<App />
		</StoreProvider>
	</React.StrictMode>,
);
