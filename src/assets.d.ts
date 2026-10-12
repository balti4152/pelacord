declare module '*.mp3' {
	const src: string;
	export default src;
}

declare const __BUILD_TIME__: string;

declare module '*.wav' {
	const src: string;
	export default src;
}

declare module '*.ogg' {
	const src: string;
	export default src;
}
