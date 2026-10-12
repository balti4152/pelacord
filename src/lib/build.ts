/** Momento en que se compiló esta build (lo inyecta Vite en build time). */
export const BUILD_TIME: string = typeof __BUILD_TIME__ === 'string' ? __BUILD_TIME__ : new Date().toISOString();

/** Fecha y hora local de la compilación, en formato corto: "dd/mm HH:MM". */
export function formatBuildTime(): string {
	const date = new Date(BUILD_TIME);
	const day = date.toLocaleDateString([], {day: '2-digit', month: '2-digit'});
	const time = date.toLocaleTimeString([], {hour: '2-digit', minute: '2-digit', hour12: false});
	return `${day} ${time}`;
}
