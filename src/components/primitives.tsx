import {type CSSProperties, type ReactNode, useEffect, useState} from 'react';
import type {AvatarCrop, Member, Presence} from '@/types';

const ICONS: Record<string, ReactNode> = {
	hash: (
		<>
			<line x1="4" y1="9" x2="20" y2="9" />
			<line x1="4" y1="15" x2="20" y2="15" />
			<line x1="10" y1="3" x2="8" y2="21" />
			<line x1="16" y1="3" x2="14" y2="21" />
		</>
	),
	speaker: (
		<>
			<polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
			<path d="M15.54 8.46a5 5 0 0 1 0 7.07" />
			<path d="M19.07 4.93a10 10 0 0 1 0 14.14" />
		</>
	),
	mic: (
		<>
			<rect x="9" y="2" width="6" height="11" rx="3" />
			<path d="M5 10a7 7 0 0 0 14 0" />
			<line x1="12" y1="17" x2="12" y2="21" />
		</>
	),
	micOff: (
		<>
			<line x1="2" y1="2" x2="22" y2="22" />
			<path d="M9 9v3a3 3 0 0 0 5.12 2.12" />
			<path d="M15 9.34V5a3 3 0 0 0-5.94-.6" />
			<path d="M17 16.95A7 7 0 0 1 5 12" />
			<line x1="12" y1="19" x2="12" y2="23" />
		</>
	),
	headphones: (
		<>
			<path d="M4 14v-2a8 8 0 0 1 16 0v2" />
			<rect x="3" y="14" width="4" height="6" rx="2" />
			<rect x="17" y="14" width="4" height="6" rx="2" />
		</>
	),
	headphonesOff: (
		<>
			<line x1="2" y1="2" x2="22" y2="22" />
			<path d="M4 14v-2a8 8 0 0 1 12.5-6.7" />
			<rect x="17" y="14" width="4" height="6" rx="2" />
			<path d="M6 14H3v6h2a1 1 0 0 0 1-1z" />
		</>
	),
	settings: (
		<>
			<circle cx="12" cy="12" r="3" />
			<path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" />
		</>
	),
	plus: (
		<>
			<line x1="12" y1="5" x2="12" y2="19" />
			<line x1="5" y1="12" x2="19" y2="12" />
		</>
	),
	members: (
		<>
			<path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
			<circle cx="9" cy="7" r="4" />
			<path d="M23 21v-2a4 4 0 0 0-3-3.87" />
			<path d="M16 3.13a4 4 0 0 1 0 7.75" />
		</>
	),
	search: (
		<>
			<circle cx="11" cy="11" r="8" />
			<line x1="21" y1="21" x2="16.65" y2="16.65" />
		</>
	),
	inbox: (
		<>
			<path d="M22 12h-6l-2 3h-4l-2-3H2" />
			<path d="M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z" />
		</>
	),
	help: (
		<>
			<circle cx="12" cy="12" r="10" />
			<path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3" />
			<line x1="12" y1="17" x2="12" y2="17.01" />
		</>
	),
	compass: (
		<>
			<circle cx="12" cy="12" r="10" />
			<polygon points="16.24 7.76 14.12 14.12 7.76 16.24 9.88 9.88 16.24 7.76" />
		</>
	),
	gift: (
		<>
			<polyline points="20 12 20 22 4 22 4 12" />
			<rect x="2" y="7" width="20" height="5" />
			<line x1="12" y1="22" x2="12" y2="7" />
			<path d="M12 7H7.5a2.5 2.5 0 0 1 0-5C11 2 12 7 12 7z" />
			<path d="M12 7h4.5a2.5 2.5 0 0 0 0-5C13 2 12 7 12 7z" />
		</>
	),
	sticker: (
		<>
			<rect x="3" y="3" width="18" height="18" rx="2" />
			<path d="M8 12h8" />
			<path d="M12 8v8" />
		</>
	),
	emoji: (
		<>
			<circle cx="12" cy="12" r="10" />
			<path d="M8 14s1.5 2 4 2 4-2 4-2" />
			<line x1="9" y1="9" x2="9.01" y2="9" />
			<line x1="15" y1="9" x2="15.01" y2="9" />
		</>
	),
	attach: (
		<path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48" />
	),
	send: (
		<>
			<line x1="22" y1="2" x2="11" y2="13" />
			<polygon points="22 2 15 22 11 13 2 9 22 2" />
		</>
	),
	image: (
		<>
			<rect x="3" y="3" width="18" height="18" rx="2" />
			<circle cx="8.5" cy="8.5" r="1.5" />
			<polyline points="21 15 16 10 5 21" />
		</>
	),
	file: (
		<>
			<path d="M13 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z" />
			<polyline points="13 2 13 9 20 9" />
		</>
	),
	download: (
		<>
			<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
			<polyline points="7 10 12 15 17 10" />
			<line x1="12" y1="15" x2="12" y2="3" />
		</>
	),
	chevronDown: <polyline points="6 9 12 15 18 9" />,
	chevronRight: <polyline points="9 18 15 12 9 6" />,
	check: <polyline points="20 6 9 17 4 12" />,
	video: (
		<>
			<path d="M23 7l-7 5 7 5V7z" />
			<rect x="1" y="5" width="15" height="14" rx="2" />
		</>
	),
	music: (
		<>
			<path d="M9 18V5l12-2v13" />
			<circle cx="6" cy="18" r="3" />
			<circle cx="18" cy="16" r="3" />
		</>
	),
	grid: (
		<>
			<rect x="3" y="3" width="7" height="7" />
			<rect x="14" y="3" width="7" height="7" />
			<rect x="14" y="14" width="7" height="7" />
			<rect x="3" y="14" width="7" height="7" />
		</>
	),
	eye: (
		<>
			<path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
			<circle cx="12" cy="12" r="3" />
		</>
	),
	eyeOff: (
		<>
			<path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24" />
			<line x1="1" y1="1" x2="23" y2="23" />
		</>
	),
	screenShare: (
		<>
			<rect x="2" y="3" width="20" height="14" rx="2" />
			<line x1="8" y1="21" x2="16" y2="21" />
			<line x1="12" y1="17" x2="12" y2="21" />
			<path d="M12 7v6" />
			<path d="M9 10l3-3 3 3" />
		</>
	),
	phoneOff: (
		<>
			<path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z" />
			<line x1="23" y1="1" x2="1" y2="23" />
		</>
	),
	x: (
		<>
			<line x1="18" y1="6" x2="6" y2="18" />
			<line x1="6" y1="6" x2="18" y2="18" />
		</>
	),
	bell: (
		<>
			<path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
			<path d="M13.73 21a2 2 0 0 1-3.46 0" />
		</>
	),
	palette: (
		<>
			<circle cx="13.5" cy="6.5" r=".5" />
			<circle cx="17.5" cy="10.5" r=".5" />
			<circle cx="8.5" cy="7.5" r=".5" />
			<circle cx="6.5" cy="12.5" r=".5" />
			<path d="M12 2a10 10 0 0 0 0 20c1.1 0 2-.9 2-2 0-.5-.2-1-.5-1.3-.3-.4-.5-.8-.5-1.2 0-1.1.9-2 2-2h2.5A3.5 3.5 0 0 0 21 12c0-5.5-4-10-9-10z" />
		</>
	),
	user: (
		<>
			<path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
			<circle cx="12" cy="7" r="4" />
		</>
	),
	maximize: (
		<>
			<path d="M8 3H5a2 2 0 0 0-2 2v3" />
			<path d="M21 8V5a2 2 0 0 0-2-2h-3" />
			<path d="M3 16v3a2 2 0 0 0 2 2h3" />
			<path d="M16 21h3a2 2 0 0 0 2-2v-3" />
		</>
	),
	minimize: (
		<>
			<path d="M8 3v3a2 2 0 0 1-2 2H3" />
			<path d="M21 8h-3a2 2 0 0 1-2-2V3" />
			<path d="M3 16h3a2 2 0 0 1 2 2v3" />
			<path d="M16 21v-3a2 2 0 0 1 2-2h3" />
		</>
	),
	chat: (
		<>
			<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
		</>
	),
};

export type IconName = keyof typeof ICONS;

export function Icon({name, size = 20, className}: {name: IconName; size?: number; className?: string}): JSX.Element {
	return (
		<svg
			xmlns="http://www.w3.org/2000/svg"
			width={size}
			height={size}
			viewBox="0 0 24 24"
			fill="none"
			stroke="currentColor"
			strokeWidth={2}
			strokeLinecap="round"
			strokeLinejoin="round"
			className={className}
			aria-hidden="true">
			{ICONS[name]}
		</svg>
	);
}

const PRESENCE_LABEL: Record<Presence, string> = {
	online: 'Online',
	idle: 'Idle',
	dnd: 'Do Not Disturb',
	offline: 'Offline',
};

/** Decoración del avatar: overlay por encima, con el centro libre para no tapar la cara. */
function avatarDecoNode(decoration?: string): ReactNode {
	if (!decoration || decoration === 'none') return null;
	return <span className="avatar-deco" data-deco={decoration} aria-hidden="true" />;
}

/** Anillo/brillo decorativo alrededor del avatar (efecto de perfil elegido). */
function avatarEffectNode(effect?: string): ReactNode {
	if (!effect || effect === 'none') return null;
	return <span className="avatar-effect" data-effect={effect} aria-hidden="true" />;
}

/** Elige la imagen del avatar: para tamaños chicos conviene un cuadro fijo (un GIF grande rinde peor). */
function avatarSource(url: string | undefined, poster: string | undefined, size: number): string | undefined {
	if (!url) return undefined;
	if (poster && size <= 48) return poster;
	return url;
}

/** Aplica el recorte guardado (zoom + desplazamiento) a la imagen del avatar. */
function avatarCropStyle(crop?: AvatarCrop): CSSProperties | undefined {
	if (!crop) return undefined;
	if (crop.zoom === 1 && crop.x === 0 && crop.y === 0) return undefined;
	return {transform: `translate(${crop.x}%, ${crop.y}%) scale(${crop.zoom})`};
}

export function Avatar({
	member,
	size = 32,
	showStatus = false,
	statusBorderColor,
	effect,
	decoration,
}: {
	member: Member;
	size?: number;
	showStatus?: boolean;
	statusBorderColor?: string;
	effect?: string;
	decoration?: string;
}): JSX.Element {
	const initial = member.name.trim().charAt(0).toUpperCase() || '?';
	const primary = avatarSource(member.avatarUrl, member.avatarPoster, size);
	const fallback = member.avatarPoster && member.avatarPoster !== primary ? member.avatarPoster : undefined;
	const [brokenPrimary, setBrokenPrimary] = useState(false);
	const [brokenFallback, setBrokenFallback] = useState(false);
	// Si cambia la URL (p. ej. al reconstruirse con el puerto nuevo) se vuelve a intentar:
	// si no, un error durante el arranque dejaba el avatar sin foto para siempre.
	useEffect(() => {
		setBrokenPrimary(false);
		setBrokenFallback(false);
	}, [primary]);
	const src = !brokenPrimary ? primary : !brokenFallback ? fallback : undefined;
	const showImage = Boolean(src);
	const style: CSSProperties = {
		width: size,
		height: size,
		fontSize: size * 0.42,
	};
	const innerStyle: CSSProperties = showImage ? {} : {backgroundColor: member.avatarColor};
	return (
		<div className="avatar" style={style} title={`${member.name} - ${PRESENCE_LABEL[member.presence]}`}>
			{avatarEffectNode(effect ?? member.effect)}
			<div className="avatar-inner" style={innerStyle}>
				{src ? (
					<img
						src={src}
						alt=""
						style={avatarCropStyle(member.avatarCrop)}
						onError={() => (brokenPrimary ? setBrokenFallback(true) : setBrokenPrimary(true))}
					/>
				) : (
					initial
				)}
			</div>
			{avatarDecoNode(decoration ?? member.decoration)}
			{showStatus ? (
				<span
					className="status-dot"
					data-status={member.presence}
					style={statusBorderColor ? {borderColor: statusBorderColor} : undefined}
				/>
			) : null}
		</div>
	);
}

export function ColorAvatar({
	name,
	color,
	url,
	poster,
	crop,
	effect,
	decoration,
	size = 32,
	status,
	statusBorderColor,
}: {
	name: string;
	color: string;
	url?: string;
	poster?: string;
	crop?: AvatarCrop;
	effect?: string;
	decoration?: string;
	size?: number;
	status?: Presence;
	statusBorderColor?: string;
}): JSX.Element {
	const initial = name.trim().charAt(0).toUpperCase() || '?';
	const primary = avatarSource(url, poster, size);
	const fallback = poster && poster !== primary ? poster : undefined;
	const [brokenPrimary, setBrokenPrimary] = useState(false);
	const [brokenFallback, setBrokenFallback] = useState(false);
	// Igual que en Avatar: si cambia la URL, se reintenta.
	useEffect(() => {
		setBrokenPrimary(false);
		setBrokenFallback(false);
	}, [primary]);
	const src = !brokenPrimary ? primary : !brokenFallback ? fallback : undefined;
	return (
		<div className="avatar" style={{width: size, height: size, fontSize: size * 0.42}}>
			{avatarEffectNode(effect)}
			<div className="avatar-inner" style={src ? {} : {backgroundColor: color}}>
				{src ? (
					<img
						src={src}
						alt=""
						style={avatarCropStyle(crop)}
						onError={() => (brokenPrimary ? setBrokenFallback(true) : setBrokenPrimary(true))}
					/>
				) : (
					initial
				)}
			</div>
			{avatarDecoNode(decoration)}
			{status ? (
				<span className="status-dot" data-status={status} style={statusBorderColor ? {borderColor: statusBorderColor} : undefined} />
			) : null}
		</div>
	);
}

export function IconButton({
	icon,
	label,
	onClick,
	active,
	muted,
	size = 20,
	className,
}: {
	icon: IconName;
	label: string;
	onClick?: () => void;
	active?: boolean;
	muted?: boolean;
	size?: number;
	className?: string;
}): JSX.Element {
	const classes = ['icon-btn'];
	if (active) classes.push('is-active');
	if (muted) classes.push('is-muted');
	if (className) classes.push(className);
	return (
		<button type="button" className={classes.join(' ')} title={label} aria-label={label} onClick={onClick}>
			<Icon name={icon} size={size} />
		</button>
	);
}

export function formatBytes(bytes: number): string {
	if (bytes < 1024) return `${bytes} B`;
	if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
	if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
	return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}
