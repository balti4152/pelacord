import {type ChangeEvent, type CSSProperties, useEffect, useState} from 'react';
import {AvatarEditor} from '@/components/AvatarEditor';
import {Avatar, ColorAvatar, Icon} from '@/components/primitives';
import {useMediaDevices, useOutputVolume} from '@/components/RemoteMedia';
import {getDesktopTransport} from '@/lib/desktop';
import {fileToDataUrl, fileToRawDataUrl} from '@/lib/image';
import {playSound, setOutputVolume} from '@/lib/sounds';
import {checkUpdates, installUpdate, useUpdater} from '@/lib/updater';
import {useStore} from '@/state/store';
import type {AvatarCrop, Member, Presence, ProfileEffect, ThemeName} from '@/types';

const EDITABLE_VARS = [
	'--brand-primary',
	'--brand-secondary',
	'--brand-primary-light',
	'--background-primary',
	'--background-secondary',
	'--background-secondary-lighter',
	'--background-secondary-alt',
	'--background-tertiary',
	'--background-header-primary',
	'--background-channel-header',
	'--text-primary',
	'--text-secondary',
	'--text-tertiary',
	'--status-online',
	'--status-idle',
	'--status-dnd',
];

const BANNER_PRESETS = [
	'linear-gradient(135deg, hsl(242, 70%, 55%), hsl(278, 85%, 60%))',
	'linear-gradient(135deg, hsl(198, 92%, 55%), hsl(152, 72%, 45%))',
	'linear-gradient(135deg, hsl(340, 82%, 58%), hsl(20, 90%, 55%))',
	'linear-gradient(135deg, hsl(0, 0%, 20%), hsl(0, 0%, 40%))',
];

const PROFILE_EFFECTS: Array<{id: ProfileEffect; label: string}> = [
	{id: 'none', label: 'Ninguno'},
	{id: 'glow', label: 'Glow'},
	{id: 'neon', label: 'Neón'},
	{id: 'fire', label: 'Fuego'},
	{id: 'aurora', label: 'Aurora'},
	{id: 'sparkle', label: 'Destellos'},
];

const THEMES: Array<{id: ThemeName; label: string}> = [	{id: 'dark', label: 'Oscuro'},
	{id: 'light', label: 'Claro'},
	{id: 'coal', label: 'Carbón (AMOLED)'},
];

const PRESENCES: Presence[] = ['online', 'idle', 'dnd', 'offline'];

const PRESENCE_LABELS: Record<Presence, string> = {
	online: 'En línea',
	idle: 'Ausente',
	dnd: 'No molestar',
	offline: 'Desconectado',
};

const BANNER_MAX = 640;
/** Tamaño del avatar estático que se guarda (entra cómodo en el mensaje de presencia). */
const AVATAR_SOURCE = 256;

export function SettingsModal({onClose}: {onClose: () => void}): JSX.Element {
	const {state, updateProfile, updateSettings, setCssVariable} = useStore();
	const me = state.me;
	const outputVolume = useOutputVolume();
	const [tab, setTab] = useState<'account' | 'profile' | 'appearance' | 'voice' | 'customcss'>('account');
	const [avatarFile, setAvatarFile] = useState<File | null>(null);

	function handleAvatar(event: ChangeEvent<HTMLInputElement>): void {
		const file = event.target.files?.[0];
		event.target.value = '';
		if (!file) return;
		// Abre el recortador: recién al confirmar se guarda el avatar.
		setAvatarFile(file);
	}

	/**
	 * Guarda el avatar con el recorte elegido.
	 *
	 * - GIF animado: se sirve por P2P (id fijo "avatar") y se guarda el recorte como
	 *   parámetros, porque recomprimir en canvas le borraría la animación.
	 * - Foto: se reduce y se manda como data URL (chico, y funciona sin depender de nadie).
	 */
	async function saveAvatar(crop: AvatarCrop): Promise<void> {
		const file = avatarFile;
		setAvatarFile(null);
		if (!file) return;
		const transport = getDesktopTransport();
		const animated = file.type === 'image/gif' || /\.gif$/i.test(file.name);

		if (animated && transport) {
			try {
				const data = await file.arrayBuffer();
				const ok = await transport.shareProfileAsset({kind: 'avatar', name: file.name, mime: file.type || 'image/gif', data});
				const endpoint = ok ? await transport.getFileEndpoint() : null;
				if (endpoint?.host && endpoint.port) {
					updateProfile({
						avatarUrl: `http://${endpoint.host}:${endpoint.port}/file/avatar`,
						avatarCrop: crop,
						avatarP2P: true,
					});
					return;
				}
			} catch {
				// cae al data URL
			}
		}

		const dataUrl = animated ? await fileToRawDataUrl(file) : await fileToDataUrl(file, AVATAR_SOURCE, 0.9);
		updateProfile({avatarUrl: dataUrl, avatarCrop: crop, avatarP2P: false});
	}

	/**
	 * Banner: si es un GIF animado se sirve por P2P (así no se pierde la animación ni se
	 * mandan varios MB en cada mensaje de presencia); si no, se reduce a un data URL.
	 */
	async function handleBanner(event: ChangeEvent<HTMLInputElement>): Promise<void> {
		const file = event.target.files?.[0];
		event.target.value = '';
		if (!file) return;
		const transport = getDesktopTransport();
		const animated = file.type === 'image/gif' || /\.gif$/i.test(file.name);
		if (animated && transport) {
			try {
				const data = await file.arrayBuffer();
				const ok = await transport.shareProfileAsset({kind: 'banner', name: file.name, mime: file.type || 'image/gif', data});
				const endpoint = ok ? await transport.getFileEndpoint() : null;
				if (endpoint?.host && endpoint.port) {
					updateProfile({
						bannerUrl: `http://${endpoint.host}:${endpoint.port}/file/banner`,
						bannerColor: undefined,
						bannerP2P: true,
					});
					return;
				}
			} catch {
				// cae al data URL
			}
		}
		const dataUrl = animated ? await fileToRawDataUrl(file) : await fileToDataUrl(file, BANNER_MAX, 0.8);
		updateProfile({bannerUrl: dataUrl, bannerColor: undefined, bannerP2P: false});
	}

	const bannerStyle = me.bannerUrl
		? {backgroundImage: `url(${me.bannerUrl})`}
		: {background: me.bannerColor ?? 'linear-gradient(135deg, var(--brand-primary), var(--brand-secondary))'};

	return (
		<div className="modal-backdrop" onClick={onClose}>
			<div className="modal" onClick={(e) => e.stopPropagation()}>
				<nav className="modal-nav">
					<div className="modal-nav-category">Ajustes</div>
					<button
						type="button"
						className={`modal-nav-item${tab === 'account' ? ' is-active' : ''}`}
						onClick={() => setTab('account')}>
						Mi cuenta
					</button>
					<button
						type="button"
						className={`modal-nav-item${tab === 'profile' ? ' is-active' : ''}`}
						onClick={() => setTab('profile')}>
						Perfil
					</button>
					<button
						type="button"
						className={`modal-nav-item${tab === 'appearance' ? ' is-active' : ''}`}
						onClick={() => setTab('appearance')}>
						Apariencia
					</button>
					<button
						type="button"
						className={`modal-nav-item${tab === 'voice' ? ' is-active' : ''}`}
						onClick={() => setTab('voice')}>
						Voz
					</button>
					<button
						type="button"
						className={`modal-nav-item${tab === 'customcss' ? ' is-active' : ''}`}
						onClick={() => setTab('customcss')}>
						CSS personalizado
					</button>
				</nav>

				<div className="modal-content" style={{position: 'relative'}}>
					<button type="button" className="modal-close" onClick={onClose} title="Cerrar">
						<Icon name="x" size={18} />
					</button>
					<div className="modal-body">
						{tab === 'account' ? (
							<AccountTab
								name={me.name}
								tag={me.tag}
								bio={me.bio ?? ''}
								status={me.status ?? ''}
								presence={me.presence}
								onName={(v) => updateProfile({name: v})}
								onTag={(v) => updateProfile({tag: v})}
								onBio={(v) => updateProfile({bio: v})}
								onStatus={(v) => updateProfile({status: v})}
								onPresence={(v) => updateProfile({presence: v})}
							/>
						) : null}

						{tab === 'profile' ? (
							<ProfileTab
								me={me}
								bannerStyle={bannerStyle}
								onAvatar={handleAvatar}
								onBanner={handleBanner}
								onBannerColor={(v) => updateProfile({bannerColor: v, bannerUrl: undefined, bannerP2P: false})}
								onAccent={(v) => updateProfile({accentColor: v})}
								onEffect={(v) => updateProfile({effect: v})}
								onResetAvatar={() => updateProfile({avatarUrl: undefined, avatarCrop: undefined, avatarP2P: false})}
								onRemoveBanner={() => updateProfile({bannerUrl: undefined, bannerColor: undefined, bannerP2P: false})}
							/>
						) : null}

						{tab === 'appearance' ? (
							<AppearanceTab
								theme={state.settings.theme}
								fontScale={state.settings.fontScale}
								messageDisplay={state.settings.messageDisplay}
								showMembers={state.settings.showMembers}
								onTheme={(v) => updateSettings({theme: v})}
								onFontScale={(v) => updateSettings({fontScale: v})}
								onMessageDisplay={(v) => updateSettings({messageDisplay: v})}
								onShowMembers={(v) => updateSettings({showMembers: v})}
								volume={outputVolume}
								onVolume={setOutputVolume}
								onTestSound={() => playSound('join')}
							/>
						) : null}

						{tab === 'voice' ? (
							<VoiceTab
								inputDeviceId={state.settings.inputDeviceId}
								outputDeviceId={state.settings.outputDeviceId}
								onInput={(v) => updateSettings({inputDeviceId: v})}
								onOutput={(v) => updateSettings({outputDeviceId: v})}
							/>
						) : null}

						{tab === 'customcss' ? (
							<CustomCssTab
								variables={state.settings.cssVariables}
								customCss={state.settings.customCss}
								onVariable={setCssVariable}
								onCustomCss={(v) => updateSettings({customCss: v})}
								onReset={() => {
									for (const name of Object.keys(state.settings.cssVariables)) setCssVariable(name, '');
									updateSettings({customCss: ''});
								}}
							/>
						) : null}
					</div>
				</div>
			</div>
			{avatarFile ? (
				<AvatarEditor file={avatarFile} onCancel={() => setAvatarFile(null)} onSave={(crop) => void saveAvatar(crop)} />
			) : null}
		</div>
	);
}

function AccountTab(props: {
	name: string;
	tag: string;
	bio: string;
	status: string;
	presence: Presence;
	onName: (v: string) => void;
	onTag: (v: string) => void;
	onBio: (v: string) => void;
	onStatus: (v: string) => void;
	onPresence: (v: Presence) => void;
}): JSX.Element {
	return (
		<>
			<h2 className="modal-title">Mi cuenta</h2>
			<div className="settings-section">
				<label className="settings-label" htmlFor="acct-name">
					Nombre
				</label>
				<input id="acct-name" className="input" value={props.name} onChange={(e) => props.onName(e.target.value)} />
			</div>
			<div className="settings-section">
				<label className="settings-label" htmlFor="acct-tag">
					Etiqueta
				</label>
				<input id="acct-tag" className="input" value={props.tag} maxLength={4} onChange={(e) => props.onTag(e.target.value)} />
			</div>
			<div className="settings-section">
				<label className="settings-label" htmlFor="acct-status">
					Estado personalizado
				</label>
				<input
					id="acct-status"
					className="input"
					value={props.status}
					placeholder="¿Qué estás haciendo?"
					onChange={(e) => props.onStatus(e.target.value)}
				/>
			</div>
			<div className="settings-section">
				<label className="settings-label" htmlFor="acct-bio">
					Sobre mí
				</label>
				<textarea
					id="acct-bio"
					className="textarea plain"
					value={props.bio}
					placeholder="Escribe algo sobre ti"
					onChange={(e) => props.onBio(e.target.value)}
				/>
			</div>
			<div className="settings-section">
				<span className="settings-label">Estado</span>
				<div className="input-row">
					{PRESENCES.map((presence) => (
						<button
							key={presence}
							type="button"
							className={`button ${props.presence === presence ? 'primary' : 'secondary'}`}
							onClick={() => props.onPresence(presence)}>
							{PRESENCE_LABELS[presence]}
						</button>
					))}
				</div>
			</div>
		</>
	);
}

function ProfileTab(props: {
	me: Member;
	bannerStyle: CSSProperties;
	onAvatar: (e: ChangeEvent<HTMLInputElement>) => void;
	onBanner: (e: ChangeEvent<HTMLInputElement>) => void;
	onBannerColor: (v: string) => void;
	onAccent: (v: string) => void;
	onEffect: (v: ProfileEffect) => void;
	onResetAvatar: () => void;
	onRemoveBanner: () => void;
}): JSX.Element {
	const {me} = props;
	return (
		<>
			<h2 className="modal-title">Perfil</h2>

			<div className="profile-preview">
				<div className="profile-card">
					<div className="profile-banner" style={props.bannerStyle} />
					<div className="profile-card-body">
						<div className="profile-card-avatar">
							<Avatar member={me} size={72} showStatus statusBorderColor="var(--background-secondary-alt)" />
						</div>
						<div className="profile-card-name">{me.name}</div>
						<div className="profile-card-sub">#{me.tag}</div>
						<div className="profile-card-bio">{me.bio || 'Sin descripción todavía.'}</div>
						<div className="accent-preview" style={{backgroundColor: me.accentColor}} />
					</div>
				</div>
			</div>

			<div className="settings-section">
				<span className="settings-label">Avatar</span>
				<div className="input-row">
					<label className="button primary" style={{cursor: 'pointer'}}>
						Cambiar avatar
						<input type="file" accept="image/*,.gif" hidden onChange={props.onAvatar} />
					</label>
					{me.avatarUrl ? (
						<button type="button" className="button danger" onClick={props.onResetAvatar}>
							Restablecer
						</button>
					) : null}
				</div>
				<p className="settings-hint">
					Foto o GIF animado desde tu compu. Antes de guardarlo vas a poder mover y hacer zoom para centrarlo.
				</p>
			</div>

			<div className="settings-section">
				<span className="settings-label">Efecto del perfil</span>
				<div className="effect-grid">
					{PROFILE_EFFECTS.map((option) => (
						<button
							type="button"
							key={option.id}
							className={`effect-option${(me.effect ?? 'none') === option.id ? ' is-active' : ''}`}
							onClick={() => props.onEffect(option.id)}>
							<ColorAvatar
								name={me.name}
								color={me.avatarColor}
								url={me.avatarUrl}
								crop={me.avatarCrop}
								effect={option.id === 'none' ? undefined : option.id}
								size={44}
							/>
							<span className="effect-option-label">{option.label}</span>
						</button>
					))}
				</div>
				<p className="settings-hint">Se ve alrededor de tu avatar en tu perfil y en el panel de abajo.</p>
			</div>

			<div className="settings-section">
				<span className="settings-label">Banner</span>
				<div className="input-row">
					<label className="button primary" style={{cursor: 'pointer'}}>
						Subir banner
						<input type="file" accept="image/*" hidden onChange={props.onBanner} />
					</label>
					<button type="button" className="button secondary" onClick={props.onRemoveBanner}>
						Quitar
					</button>
				</div>
				<p className="settings-hint">O elige un degradado:</p>
				<div className="input-row" style={{marginTop: '0.5rem'}}>
					{BANNER_PRESETS.map((preset) => (
						<button
							key={preset}
							type="button"
							title="Use gradient"
							onClick={() => props.onBannerColor(preset)}
							style={{
								width: '3rem',
								height: '2rem',
								borderRadius: 'var(--radius-sm)',
								border: '1px solid var(--border-color)',
								background: preset,
								cursor: 'pointer',
							}}
						/>
					))}
					<input
						type="color"
						className="swatch-input"
						value={me.bannerColor?.startsWith('#') ? me.bannerColor : '#4641d9'}
						onChange={(e) => props.onBannerColor(e.target.value)}
					/>
				</div>
			</div>

			<div className="settings-section">
				<span className="settings-label">Color de acento</span>
				<div className="swatch-row">
					<input
						type="color"
						className="swatch-input"
						value={me.accentColor.startsWith('#') ? me.accentColor : '#4641d9'}
						onChange={(e) => props.onAccent(e.target.value)}
					/>
					<span className="settings-hint" style={{marginTop: 0}}>
						Se usa para resaltar tu perfil.
					</span>
				</div>
			</div>
		</>
	);
}

function AppearanceTab(props: {
	theme: ThemeName;
	fontScale: number;
	messageDisplay: 'cozy' | 'compact';
	showMembers: boolean;
	volume: number;
	onTheme: (v: ThemeName) => void;
	onFontScale: (v: number) => void;
	onMessageDisplay: (v: 'cozy' | 'compact') => void;
	onShowMembers: (v: boolean) => void;
	onVolume: (v: number) => void;
	onTestSound: () => void;
}): JSX.Element {
	return (
		<>
			<h2 className="modal-title">Apariencia</h2>
			<div className="settings-section">
				<span className="settings-label">Tema</span>
				<div className="input-row">
					{THEMES.map((theme) => (
						<button
							key={theme.id}
							type="button"
							className={`button ${props.theme === theme.id ? 'primary' : 'secondary'}`}
							onClick={() => props.onTheme(theme.id)}>
							{theme.label}
						</button>
					))}
				</div>
			</div>
			<div className="settings-section">
				<label className="settings-label" htmlFor="font-scale">
					Tamaño de fuente: {Math.round(props.fontScale * 100)}%
				</label>
				<input
					id="font-scale"
					type="range"
					min={0.8}
					max={1.3}
					step={0.05}
					value={props.fontScale}
					onChange={(e) => props.onFontScale(Number(e.target.value))}
					style={{width: '100%'}}
				/>
			</div>
			<div className="settings-section">
				<label className="settings-label" htmlFor="out-volume">
					Volumen de salida: {Math.round(props.volume * 100)}%
				</label>
				<div className="input-row">
					<input
						id="out-volume"
						type="range"
						min={0}
						max={1}
						step={0.05}
						value={props.volume}
						onChange={(e) => props.onVolume(Number(e.target.value))}
						style={{flex: 1}}
					/>
					<button type="button" className="button secondary" onClick={props.onTestSound}>
						Probar
					</button>
				</div>
				<p className="settings-hint">
					Controla la voz de la llamada y los sonidos. Si Windows tiene la app al 1% en el mezclador, esto no lo arregla:
					hay que resetear el mezclador (ver abajo).
				</p>
			</div>
			<div className="settings-section">
				<span className="settings-label">Actualizaciones</span>
				<UpdateSettings />
			</div>
			<div className="settings-section">
				<span className="settings-label">Vista de mensajes</span>
				<div className="input-row">
					<button
						type="button"
						className={`button ${props.messageDisplay === 'cozy' ? 'primary' : 'secondary'}`}
						onClick={() => props.onMessageDisplay('cozy')}>
						Cómoda
					</button>
					<button
						type="button"
						className={`button ${props.messageDisplay === 'compact' ? 'primary' : 'secondary'}`}
						onClick={() => props.onMessageDisplay('compact')}>
						Compacta
					</button>
				</div>
			</div>
			<div className="settings-section">
				<span className="settings-label">Lista de miembros</span>
				<div className="input-row">
					<button
						type="button"
						className={`button ${props.showMembers ? 'primary' : 'secondary'}`}
						onClick={() => props.onShowMembers(!props.showMembers)}>
						{props.showMembers ? 'Visible' : 'Oculta'}
					</button>
				</div>
			</div>
		</>
	);
}

function MicTest({
	deviceId,
	outputDeviceId,
	monitor,
}: {
	deviceId: string;
	outputDeviceId: string;
	monitor: boolean;
}): JSX.Element {
	const [level, setLevel] = useState(0);
	useEffect(() => {
		let active = true;
		let stream: MediaStream | null = null;
		let context: AudioContext | null = null;
		let frame = 0;
		void (async () => {
			try {
				stream = await navigator.mediaDevices.getUserMedia({
					audio: deviceId && deviceId !== 'default' ? {deviceId: {exact: deviceId}} : true,
				});
				if (!active) {
					stream.getTracks().forEach((track) => track.stop());
					return;
				}
				context = new AudioContext();
				if (monitor && outputDeviceId && outputDeviceId !== 'default') {
					const withSink = context as AudioContext & {setSinkId?: (id: string) => Promise<void>};
					if (typeof withSink.setSinkId === 'function') await withSink.setSinkId(outputDeviceId).catch(() => {});
				}
				const source = context.createMediaStreamSource(stream);
				const analyser = context.createAnalyser();
				analyser.fftSize = 512;
				source.connect(analyser);
				if (monitor) source.connect(context.destination);
				const data = new Uint8Array(analyser.frequencyBinCount);
				const tick = () => {
					analyser.getByteTimeDomainData(data);
					let sum = 0;
					for (let i = 0; i < data.length; i++) {
						const value = (data[i] - 128) / 128;
						sum += value * value;
					}
					setLevel(Math.min(1, Math.sqrt(sum / data.length) * 4));
					frame = requestAnimationFrame(tick);
				};
				tick();
			} catch {
				// sin permiso de micrófono
			}
		})();
		return () => {
			active = false;
			cancelAnimationFrame(frame);
			void context?.close();
			stream?.getTracks().forEach((track) => track.stop());
		};
	}, [deviceId, outputDeviceId, monitor]);
	return (
		<div className="mic-meter" title="Nivel del micrófono">
			<div className="mic-meter-fill" style={{width: `${Math.round(level * 100)}%`}} />
		</div>
	);
}

function VoiceTab(props: {
	inputDeviceId: string;
	outputDeviceId: string;
	onInput: (v: string) => void;
	onOutput: (v: string) => void;
}): JSX.Element {
	const {inputs, outputs} = useMediaDevices();
	const [monitor, setMonitor] = useState(false);
	return (
		<>
			<h2 className="modal-title">Voz</h2>
			<div className="settings-section">
				<label className="settings-label" htmlFor="mic-device">
					Micrófono
				</label>
				<select
					id="mic-device"
					className="select"
					value={props.inputDeviceId}
					onChange={(event) => props.onInput(event.target.value)}>
					<option value="default">Predeterminado del sistema</option>
					{inputs.map((device, index) => (
						<option key={device.deviceId || index} value={device.deviceId}>
							{device.label || `Micrófono ${index + 1}`}
						</option>
					))}
				</select>
				<p className="settings-hint">Habla y mirá el nivel:</p>
				<MicTest deviceId={props.inputDeviceId} outputDeviceId={props.outputDeviceId} monitor={monitor} />
				<div className="input-row" style={{marginTop: '0.75rem'}}>
					<button
						type="button"
						className={`button ${monitor ? 'danger' : 'secondary'}`}
						onClick={() => setMonitor((value) => !value)}>
						{monitor ? 'Dejar de escucharme' : 'Escucharme'}
					</button>
				</div>
				<p className="settings-hint">
					{monitor
						? 'Estás escuchando tu propio micrófono. Usá auriculares para evitar acople.'
						: 'Reproduce tu micrófono por el altavoz elegido, para probar que ambos funcionan.'}
				</p>
			</div>
			<div className="settings-section">
				<label className="settings-label" htmlFor="spk-device">
					Altavoz
				</label>
				<select
					id="spk-device"
					className="select"
					value={props.outputDeviceId}
					onChange={(event) => props.onOutput(event.target.value)}>
					<option value="default">Predeterminado del sistema</option>
					{outputs.map((device, index) => (
						<option key={device.deviceId || index} value={device.deviceId}>
							{device.label || `Altavoz ${index + 1}`}
						</option>
					))}
				</select>
				<p className="settings-hint">Se aplica a la voz de la llamada.</p>
			</div>
		</>
	);
}

function UpdateSettings(): JSX.Element {
	const status = useUpdater();
	const text =
		status.state === 'checking'
			? 'Buscando…'
			: status.state === 'available'
				? 'Actualización disponible, descargando…'
				: status.state === 'downloading'
					? `Descargando… ${status.percent ?? 0}%`
					: status.state === 'downloaded'
						? `Lista para instalar${status.version ? ` (v${status.version})` : ''}`
						: status.state === 'none'
							? 'Estás al día'
							: status.state === 'error'
								? `No se pudo actualizar: ${status.error ?? ''}`
								: 'La app busca actualizaciones sola al abrir.';
	return (
		<div className="input-row" style={{alignItems: 'center', flexWrap: 'wrap', gap: '0.5rem'}}>
			<button type="button" className="button secondary" onClick={checkUpdates}>
				Buscar actualizaciones
			</button>
			{status.state === 'downloaded' ? (
				<button type="button" className="button primary" onClick={installUpdate}>
					Reiniciar e instalar
				</button>
			) : null}
			<span className="settings-hint" style={{marginTop: 0}}>
				{text}
			</span>
		</div>
	);
}

function CustomCssTab(props: {
	variables: Record<string, string>;
	customCss: string;
	onVariable: (name: string, value: string) => void;
	onCustomCss: (v: string) => void;
	onReset: () => void;
}): JSX.Element {
	return (
		<>
			<h2 className="modal-title">CSS personalizado</h2>
			<div className="settings-section">
				<span className="settings-label">Variables del tema</span>
				<p className="settings-hint" style={{marginTop: 0, marginBottom: '0.75rem'}}>
					Sobrescribe cualquier variable CSS de Pelacord/Fluxer. Deja vacío para usar el valor del tema.
				</p>
				{EDITABLE_VARS.map((name) => (
					<div className="var-row" key={name}>
						<code>{name}</code>
						<input
							className="input"
							placeholder="default"
							value={props.variables[name] ?? ''}
							onChange={(e) => props.onVariable(name, e.target.value)}
						/>
					</div>
				))}
			</div>
			<div className="settings-section">
				<label className="settings-label" htmlFor="custom-css">
					Hoja de estilos personalizada
				</label>
				<textarea
					id="custom-css"
					className="textarea"
					placeholder={'.app-shell {\n  /* tu CSS aquí */\n}'}
					value={props.customCss}
					onChange={(e) => props.onCustomCss(e.target.value)}
				/>
			</div>
			<div className="settings-section">
				<button type="button" className="button danger" onClick={props.onReset}>
					Restablecer todo el estilo personalizado
				</button>
			</div>
		</>
	);
}
