import {Component, type ErrorInfo, type ReactNode} from 'react';

interface State {
	error: Error | null;
}

/** Captura errores de render y los muestra en pantalla (en vez de quedar todo gris). */
export class ErrorBoundary extends Component<{children: ReactNode}, State> {
	state: State = {error: null};

	static getDerivedStateFromError(error: Error): State {
		return {error};
	}

	componentDidCatch(error: Error, info: ErrorInfo): void {
		console.error('[pelacord-error] fallo de interfaz:', error, info?.componentStack);
	}

	render(): ReactNode {
		if (this.state.error) {
			return (
				<div className="crash-screen">
					<h1>Se rompió la interfaz</h1>
					<p>Copiame este texto y lo arreglo:</p>
					<pre>{String(this.state.error?.stack ?? this.state.error?.message ?? this.state.error)}</pre>
					<div className="crash-actions">
						<button type="button" className="button primary" onClick={() => this.setState({error: null})}>
							Reintentar
						</button>
						<button type="button" className="button secondary" onClick={() => window.location.reload()}>
							Recargar
						</button>
					</div>
				</div>
			);
		}
		return this.props.children;
	}
}
