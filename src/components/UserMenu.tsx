import type {CSSProperties} from 'react';
import {ColorAvatar, Icon} from '@/components/primitives';
import {ProfileOverlay} from '@/components/ProfileOverlay';
import {usePeerVolume} from '@/components/RemoteMedia';
import {voiceMesh} from '@/lib/media';
import type {AvatarCrop, Member, ParticleDirection, Presence, VoiceParticipant} from '@/types';

export interface UserLike {
	id: string;
	name: string;
	tag?: string;
	color: string;
	avatarUrl?: string;
	avatarCrop?: AvatarCrop;
	bannerUrl?: string;
	bannerColor?: string;
	effect?: string;
	decoration?: string;
	decorationColor?: string;
	customDeco?: string;
	decoImage?: string;
	decoSize?: number;
	original?: boolean;
	customParticle?: string;
	particleImage?: string;
	particleDirection?: ParticleDirection;
	particleOriginal?: boolean;
	particleSpeed?: number;
	particleLife?: number;
	particleSize?: number;
	particleCount?: number;
	profileEffect?: string;
	profileEffectColor?: string;
	presence?: Presence;
	bio?: string;
	status?: string;
}

/**
 * Perfil completo a partir de un miembro (lista de amigos, miembros del servidor).
 *
 * Es el mapeo ÚNICO de miembro a perfil: si se agrega un campo de perfil nuevo, se agrega acá y
 * queda para todos los lugares que abren un perfil.
 */
export function userFromMember(member: Member): UserLike {
	return {
		id: member.id,
		name: member.name,
		tag: member.tag,
		color: member.avatarColor,
		avatarUrl: member.avatarUrl,
		avatarCrop: member.avatarCrop,
		bannerUrl: member.bannerUrl,
		bannerColor: member.bannerColor,
		effect: member.effect,
		decoration: member.decoration,
		decorationColor: member.decorationColor,
		customDeco: member.customDeco,
		decoImage: member.decoImage,
		decoSize: member.decoSize,
		original: member.particleOriginal,
		customParticle: member.customParticle,
		particleImage: member.particleImage,
		particleDirection: member.particleDirection,
		particleOriginal: member.particleOriginal,
		particleSpeed: member.particleSpeed,
		particleLife: member.particleLife,
		particleSize: member.particleSize,
		particleCount: member.particleCount,
		profileEffect: member.profileEffect,
		profileEffectColor: member.profileEffectColor,
		presence: member.presence,
		bio: member.bio,
		status: member.status,
	};
}

/**
 * Perfil de alguien que está en un canal de voz (clic derecho en la llamada o en la barra).
 *
 * OJO: lo que viaja por la VOZ (VoiceParticipant) lleva SÓLO nombre, color, foto y marco. El
 * banner, los efectos y la bio NO viajan por ahí: viven en la presencia. Si el perfil se armaba
 * sólo con el participante, se abría incompleto — salía nada más que la foto y el nombre.
 * Por eso se completa con el miembro (que tiene el perfil entero) y la voz sólo pisa lo que sí
 * lleva, para que la foto sea la más nueva.
 */
export function userFromParticipant(participant: VoiceParticipant, members: Member[]): UserLike {
	const member = members.find((entry) => entry.id === participant.id);
	if (!member) {
		// Todavía no llegó su presencia: se muestra lo que hay (mejor que un perfil vacío).
		return {
			id: participant.id,
			name: participant.name,
			color: participant.color,
			avatarUrl: participant.avatarUrl,
			avatarCrop: participant.avatarCrop,
			decoration: participant.decoration,
			decorationColor: participant.decorationColor,
			customDeco: participant.customDeco,
			decoImage: participant.decoImage,
			decoSize: participant.decoSize,
			original: participant.original,
			presence: 'online',
		};
	}
	return {
		...userFromMember(member),
		name: participant.name || member.name,
		color: participant.color || member.avatarColor,
		avatarUrl: participant.avatarUrl ?? member.avatarUrl,
		avatarCrop: participant.avatarCrop ?? member.avatarCrop,
	};
}

function clampPosition(x: number, y: number, width: number, height: number): {left: number; top: number} {
	return {
		left: Math.min(x, Math.max(8, window.innerWidth - width - 8)),
		top: Math.min(y, Math.max(8, window.innerHeight - height - 8)),
	};
}

/** Menú contextual de usuario (click derecho), estilo Discord. Solo acciones reales. */
export function UserContextMenu({
	user,
	x,
	y,
	canVolume,
	onClose,
	onViewProfile,
	voice,
	onMute,
	onDeafen,
	onDisconnect,
}: {
	user: UserLike;
	x: number;
	y: number;
	canVolume: boolean;
	onClose: () => void;
	onViewProfile: () => void;
	/** Estado del participante en la llamada (para mostrar "Silenciar" o "Activar micrófono"). */
	voice?: {muted: boolean; deafened: boolean};
	onMute?: () => void;
	onDeafen?: () => void;
	onDisconnect?: () => void;
}): JSX.Element {
	const volume = usePeerVolume(user.id);
	const position = clampPosition(x, y, 15 * 16, 13 * 16);
	return (
		<>
			<div
				className="call-menu-backdrop"
				onClick={onClose}
				onContextMenu={(event) => {
					event.preventDefault();
					onClose();
				}}
			/>
			<div className="call-menu" style={position} onClick={(event) => event.stopPropagation()}>
				<div className="call-menu-title">{user.name}</div>
				<button
					type="button"
					className="call-menu-item"
					onClick={() => {
						onViewProfile();
						onClose();
					}}>
					<Icon name="user" size={16} />
					<span>Ver perfil</span>
				</button>
				{onMute ? (
					<button
						type="button"
						className="call-menu-item"
						onClick={() => {
							onMute();
							onClose();
						}}>
						<Icon name={voice?.muted ? 'micOff' : 'mic'} size={16} />
						<span>{voice?.muted ? 'Activar micrófono' : 'Silenciar'}</span>
					</button>
				) : null}
				{onDeafen ? (
					<button
						type="button"
						className="call-menu-item"
						onClick={() => {
							onDeafen();
							onClose();
						}}>
						<Icon name={voice?.deafened ? 'headphonesOff' : 'headphones'} size={16} />
						<span>{voice?.deafened ? 'Activar audio' : 'Ensordecer'}</span>
					</button>
				) : null}
				{onDisconnect ? (
					<button
						type="button"
						className="call-menu-item is-danger"
						onClick={() => {
							onDisconnect();
							onClose();
						}}>
						<Icon name="phoneOff" size={16} />
						<span>Desconectar de la llamada</span>
					</button>
				) : null}
				{canVolume ? (
					<label className="call-menu-volume">
						<Icon name="speaker" size={16} />
						<input
							type="range"
							min={0}
							max={1}
							step={0.05}
							value={volume}
							onChange={(event) => voiceMesh.setPeerVolume(user.id, Number(event.target.value))}
						/>
						<span className="call-menu-value">{Math.round(volume * 100)}%</span>
					</label>
				) : null}
				<div className="call-menu-divider" />
				<button
					type="button"
					className="call-menu-item"
					onClick={() => {
						void navigator.clipboard.writeText(user.id);
						onClose();
					}}>
					<span>Copiar ID</span>
				</button>
			</div>
		</>
	);
}

/** Perfil compacto (popover). */
export function ProfilePopover({
	user,
	canVolume,
	onClose,
}: {
	user: UserLike;
	canVolume: boolean;
	onClose: () => void;
}): JSX.Element {
	const volume = usePeerVolume(user.id);
	// Igual que en Ajustes: si hay banner propio se usa, si no el color o el degradado.
	const bannerStyle: CSSProperties = user.bannerUrl
		? {backgroundImage: `url(${user.bannerUrl})`}
		: {background: user.bannerColor ?? `linear-gradient(135deg, ${user.color}, var(--brand-secondary))`};
	return (
		<>
			<div className="modal-backdrop" onClick={onClose} />
			<div className="profile-popover" onClick={(event) => event.stopPropagation()}>
				<ProfileOverlay
					key={`${user.id}-${user.profileEffect ?? 'none'}`}
					effect={user.profileEffect}
					color={user.profileEffectColor}
					particle={user.customParticle}
					imageId={user.particleImage}
					direction={user.particleDirection}
					size={user.particleSize}
					count={user.particleCount}
					speed={user.particleSpeed}
					life={user.particleLife}
					original={user.particleOriginal}
				/>
				<div className="profile-popover-banner" style={bannerStyle} />
				<div className="profile-popover-body">
					<div className="profile-popover-avatar">
						<ColorAvatar
							name={user.name}
							color={user.color}
							url={user.avatarUrl}
							crop={user.avatarCrop}
							effect={user.effect}
							decoration={user.decoration}
							decorationColor={user.decorationColor}
							customDeco={user.customDeco}
							decoImage={user.decoImage}
							decoSize={user.decoSize}
							original={user.original}
							size={80}
							status={user.presence}
							statusBorderColor="var(--background-secondary)"
						/>
					</div>
					<div className="profile-popover-name">{user.name}</div>
					{user.tag ? <div className="profile-popover-sub">#{user.tag}</div> : null}
					{user.status ? <div className="profile-popover-status">{user.status}</div> : null}
					{user.bio ? <div className="profile-popover-bio">{user.bio}</div> : null}
					{canVolume ? (
						<label className="call-menu-volume">
							<Icon name="speaker" size={16} />
							<input
								type="range"
								min={0}
								max={1}
								step={0.05}
								value={volume}
								onChange={(event) => voiceMesh.setPeerVolume(user.id, Number(event.target.value))}
							/>
							<span className="call-menu-value">{Math.round(volume * 100)}%</span>
						</label>
					) : null}
					<div className="profile-popover-actions">
						<button
							type="button"
							className="button secondary"
							onClick={() => {
								void navigator.clipboard.writeText(user.id);
							}}>
							Copiar ID
						</button>
						<button type="button" className="button primary" onClick={onClose}>
							Cerrar
						</button>
					</div>
				</div>
			</div>
		</>
	);
}
