import {useEffect, useState} from 'react';
import {Icon} from '@/components/primitives';
import {type DesktopSource, getDesktopTransport} from '@/lib/desktop';

export interface ShareOptions {
	width: number;
	height: number;
	frameRate: number;
	audio: boolean;
	maxBitrate: number;
}

const RESOLUTIONS: Array<{label: string; width: number; height: number}> = [
	{label: '720p', width: 1280, height: 720},
	{label: '1080p', width: 1920, height: 1080},
	{label: '1440p', width: 2560, height: 1440},
	{label: 'Fuente', width: 3840, height: 2160},
];

const FRAME_RATES = [30, 60, 90, 120, 144, 165, 240];

const QUALITY_PRESETS: Array<{label: string; width: number; height: number; frameRate: number; bitrate: number}> = [
	{label: 'Estándar', width: 1280, height: 720, frameRate: 30, bitrate: 6_000_000},
	{label: 'Alta', width: 1920, height: 1080, frameRate: 60, bitrate: 14_000_000},
	{label: 'Muy alta', width: 2560, height: 1440, frameRate: 60, bitrate: 28_000_000},
];

function formatSourceLabel(source: DesktopSource): string {
	return source.name.length > 60 ? `${source.name.slice(0, 57)}…` : source.name;
}

/**
 * Nombre de la aplicación, sacado del título de la ventana.
 * Windows titula las ventanas como "archivo.txt - Notepad" o "pestaña — Google Chrome",
 * así que se toma el último tramo. Es una heurística, pero es lo único que da Chromium.
 */
function appName(source: DesktopSource): string | null {
	if (source.kind !== 'window') return null;
	const parts = source.name.split(/\s[-–—·|]\s/);
	if (parts.length < 2) return null;
	const last = parts[parts.length - 1].trim();
	return last.length >= 2 && last.length <= 40 ? last : null;
}

export function ScreenSharePicker({
	onPick,
	onCancel,
}: {
	onPick: (sourceId: string, options: ShareOptions) => void;
	onCancel: () => void;
}): JSX.Element {
	const [sources, setSources] = useState<DesktopSource[]>([]);
	const [tab, setTab] = useState<'screen' | 'window'>('screen');
	const [selected, setSelected] = useState<string | null>(null);
	const [resolution, setResolution] = useState(RESOLUTIONS[1]);
	const [frameRate, setFrameRate] = useState(60);
	const [bitrate, setBitrate] = useState(14_000_000);
	const [audio, setAudio] = useState(false);
	const [advanced, setAdvanced] = useState(false);

	useEffect(() => {
		const transport = getDesktopTransport();
		if (!transport) return;
		let active = true;
		const refresh = async () => {
			try {
				const list = await transport.getDesktopSources();
				if (active) setSources(list);
			} catch {
				// ignore
			}
		};
		void refresh();
		const timer = setInterval(refresh, 2000);
		return () => {
			active = false;
			clearInterval(timer);
		};
	}, []);

	const filtered = sources.filter((source) => source.kind === tab);
	const selectedSource = sources.find((source) => source.id === selected) ?? null;
	const activePreset = QUALITY_PRESETS.find(
		(preset) => preset.width === resolution.width && preset.frameRate === frameRate,
	)?.label;

	function applyPreset(preset: (typeof QUALITY_PRESETS)[number]): void {
		setResolution(RESOLUTIONS.find((item) => item.width === preset.width) ?? RESOLUTIONS[1]);
		setFrameRate(preset.frameRate);
		setBitrate(preset.bitrate);
	}

	const summary = selectedSource
		? `${formatSourceLabel(selectedSource)} · ${resolution.label} · ${frameRate} FPS · ${Math.round(bitrate / 1_000_000)} Mbps`
		: 'Elegí una fuente';

	return (
		<div className="modal-backdrop" onClick={onCancel}>
			<div className="modal share-picker" onClick={(event) => event.stopPropagation()}>
				<header className="share-picker-header">
					<h2>Compartir tu pantalla</h2>
					<button type="button" className="modal-close" onClick={onCancel} title="Cerrar">
						<Icon name="x" size={18} />
					</button>
				</header>

				<div className="share-picker-tabs">
					<button type="button" className={tab === 'screen' ? 'is-active' : ''} onClick={() => setTab('screen')}>
						<Icon name="screenShare" size={16} /> Pantallas
					</button>
					<button type="button" className={tab === 'window' ? 'is-active' : ''} onClick={() => setTab('window')}>
						<Icon name="video" size={16} /> Ventanas
					</button>
				</div>

				<div className="share-picker-grid">
					{filtered.length === 0 ? <p className="settings-hint">No se encontraron fuentes.</p> : null}
					{filtered.map((source) => (
						<button
							type="button"
							key={source.id}
							className={`share-source${selected === source.id ? ' is-selected' : ''}`}
							title={source.name}
							onClick={() => setSelected(source.id)}>
							{source.thumbnail ? (
								<img src={source.thumbnail} alt="" />
							) : (
								<div className="share-source-empty">
									<Icon name="screenShare" size={28} />
								</div>
							)}
							<span className="share-source-name">
								{source.appIcon ? <img src={source.appIcon} alt="" className="share-source-icon" /> : null}
								<span className="share-source-text">
									<span className="share-source-title">{formatSourceLabel(source)}</span>
									{appName(source) ? <span className="share-source-app">{appName(source)}</span> : null}
								</span>
							</span>
							{selected === source.id ? (
								<span className="share-source-check">
									<Icon name="check" size={16} />
								</span>
							) : null}
						</button>
					))}
				</div>

				<div className="share-settings">
					<div className="share-settings-group">
						<span className="settings-label">Resolución</span>
						<div className="share-segments">
							{RESOLUTIONS.map((option) => (
								<button
									type="button"
									key={option.label}
									className={resolution.label === option.label ? 'is-active' : ''}
									onClick={() => setResolution(option)}>
									{option.label}
								</button>
							))}
						</div>
					</div>
					<div className="share-settings-group">
						<span className="settings-label">FPS</span>
						<div className="share-segments">
							{FRAME_RATES.map((rate) => (
								<button type="button" key={rate} className={frameRate === rate ? 'is-active' : ''} onClick={() => setFrameRate(rate)}>
									{rate}
								</button>
							))}
						</div>
					</div>
					<div className="share-settings-group">
						<span className="settings-label">Calidad</span>
						<div className="share-segments">
							{QUALITY_PRESETS.map((preset) => (
								<button
									type="button"
									key={preset.label}
									className={activePreset === preset.label ? 'is-active' : ''}
									onClick={() => applyPreset(preset)}>
									{preset.label}
								</button>
							))}
						</div>
					</div>
					<div className="share-settings-group share-settings-bitrate">
						<span className="settings-label">Bitrate: {Math.round(bitrate / 1_000_000)} Mbps</span>
						<input
							type="range"
							min={1_000_000}
							max={50_000_000}
							step={1_000_000}
							value={bitrate}
							onChange={(event) => setBitrate(Number(event.target.value))}
						/>
					</div>

					<button type="button" className="share-advanced-toggle" onClick={() => setAdvanced((value) => !value)}>
						<Icon name={advanced ? 'chevronDown' : 'chevronRight'} size={14} /> Ajustes avanzados
					</button>
					{advanced ? (
						<label className="share-picker-audio">
							<input type="checkbox" checked={audio} onChange={(event) => setAudio(event.target.checked)} />
							Compartir audio del sistema (excluye las voces de Pelacord)
						</label>
					) : null}
				</div>

				<footer className="share-picker-footer">
					<span className="share-picker-summary">{summary}</span>
					<div className="share-picker-actions">
						<button type="button" className="button secondary" onClick={onCancel}>
							Cancelar
						</button>
						<button
							type="button"
							className="button primary"
							disabled={!selected}
							onClick={() =>
								selected &&
								onPick(selected, {
									width: resolution.width,
									height: resolution.height,
									frameRate,
									audio,
									maxBitrate: bitrate,
								})
							}>
							Compartir pantalla
						</button>
					</div>
				</footer>
			</div>
		</div>
	);
}
