/** Momento en que se compiló esta build (lo inyecta Vite en build time). */
export const BUILD_TIME: string = typeof __BUILD_TIME__ === 'string' ? __BUILD_TIME__ : new Date().toISOString();

/** Versión de la app (sale de package.json). */
export const APP_VERSION: string = typeof __APP_VERSION__ === 'string' ? __APP_VERSION__ : '0.0.0';

/** Fecha y hora local de la compilación, en formato corto: "dd/mm HH:MM". */
export function formatBuildTime(): string {
	const date = new Date(BUILD_TIME);
	const day = date.toLocaleDateString([], {day: '2-digit', month: '2-digit'});
	const time = date.toLocaleTimeString([], {hour: '2-digit', minute: '2-digit', hour12: false});
	return `${day} ${time}`;
}

/** Fecha y hora local completa: "12/10/2026 a las 20:56". */
export function formatBuildFull(): string {
	const date = new Date(BUILD_TIME);
	const day = date.toLocaleDateString([], {day: '2-digit', month: '2-digit', year: 'numeric'});
	const time = date.toLocaleTimeString([], {hour: '2-digit', minute: '2-digit', hour12: false});
	return `${day} a las ${time}`;
}
