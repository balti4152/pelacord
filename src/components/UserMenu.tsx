import type {CSSProperties} from 'react';
import {ColorAvatar, Icon} from '@/components/primitives';
import {usePeerVolume} from '@/components/RemoteMedia';
import {voiceMesh} from '@/lib/media';
import type {AvatarCrop, Presence} from '@/types';

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
	presence?: Presence;
	bio?: string;
	status?: string;
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
}: {
	user: UserLike;
	x: number;
	y: number;
	canVolume: boolean;
	onClose: () => void;
	onViewProfile: () => void;
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
