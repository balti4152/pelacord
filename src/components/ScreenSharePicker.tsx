import {useEffect, useRef, useState} from 'react';
import {AppWindow, ArrowLeft, ArrowRight, Check, Monitor, ScreenShare, Volume2, X} from 'lucide-react';
import {Icon} from '@/components/primitives';
import {type DesktopSource, getDesktopTransport} from '@/lib/desktop';
import {DEFAULT_SHARE_OPTIONS, type ShareOptions} from '@/lib/screenShare';

const RESOLUTIONS = [
	{label: '720p', width: 1280, height: 720},
	{label: '1080p', width: 1920, height: 1080},
	{label: '1440p', width: 2560, height: 1440},
	{label: '2160p', width: 3840, height: 2160},
];
const FRAME_RATES = [15, 30, 60, 90, 120, 144, 165, 240];
const PRESETS = [
	{label: 'Ligera', width: 1280, height: 720, frameRate: 30, maxBitrate: 6_000_000},
	{label: 'Equilibrada', ...DEFAULT_SHARE_OPTIONS},
	{label: 'Alta definición', width: 2560, height: 1440, frameRate: 60, maxBitrate: 28_000_000},
];

function SourcePreview({source}: {source: DesktopSource}): JSX.Element {
	return (
		<span className="share-preview">
			{source.thumbnail ? <img src={source.thumbnail} alt="" draggable={false} /> :
				source.kind === 'window' ? <AppWindow size={25} /> : <Monitor size={25} />}
		</span>
	);
}

export function ScreenSharePicker({channelName, onPick, onCancel}: {
	channelName: string;
	onPick: (sourceId: string, options: ShareOptions) => Promise<boolean>;
	onCancel: () => void;
}): JSX.Element {
	const dialogRef = useRef<HTMLDialogElement>(null);
	const headingRef = useRef<HTMLHeadingElement>(null);
	const [sources, setSources] = useState<DesktopSource[]>([]);
	const [loading, setLoading] = useState(true);
	const [tab, setTab] = useState<DesktopSource['kind']>('window');
	const [selected, setSelected] = useState<string | null>(null);
	const [configuring, setConfiguring] = useState(false);
	const [options, setOptions] = useState(DEFAULT_SHARE_OPTIONS);
	const [advanced, setAdvanced] = useState(false);
	const [pending, setPending] = useState(false);
	const [error, setError] = useState('');
	const selectedSource = sources.find((source) => source.id === selected);
	const filtered = sources.filter((source) => source.kind === tab);
	const showSettings = configuring && Boolean(selectedSource);
	const preset = PRESETS.find(({width, frameRate, maxBitrate}) =>
		width === options.width && frameRate === options.frameRate && maxBitrate === options.maxBitrate);

	useEffect(() => {
		const dialog = dialogRef.current;
		const opener = document.activeElement;
		dialog?.showModal();
		return () => {
			dialog?.close();
			if (opener instanceof HTMLElement && opener.isConnected) opener.focus();
		};
	}, []);

	useEffect(() => { headingRef.current?.focus(); }, [showSettings]);

	useEffect(() => {
		const transport = getDesktopTransport();
		let active = true;
		let busy = false;
		const refresh = async () => {
			if (busy) return;
			busy = true;
			try {
				const list = await transport?.getDesktopSources();
				if (active && list) setSources(list);
			} catch {
				if (active) setSources([]);
			} finally {
				if (active) setLoading(false);
				busy = false;
			}
		};
		void refresh();
		const timer = setInterval(refresh, 3000);
		return () => { active = false; clearInterval(timer); };
	}, []);

	useEffect(() => {
		if (!configuring || selectedSource || pending) return;
		setConfiguring(false);
		setSelected(null);
		setError('Esa fuente dejó de estar disponible. Elegí otra para seguir.');
	}, [configuring, pending, selectedSource]);

	function pick(source: DesktopSource): void {
		setSelected(source.id);
		setError('');
	}

	function back(): void {
		setConfiguring(false);
		setError('');
	}

	async function confirm(): Promise<void> {
		if (!selectedSource || pending) return;
		setPending(true);
		setError('');
		const started = await onPick(selectedSource.id, options).catch(() => false);
		if (!started) setError('No se pudo iniciar la captura. Podés reintentar o cambiar la fuente.');
		setPending(false);
	}

	return (
		<dialog className="share-picker" ref={dialogRef} aria-labelledby="share-title" onCancel={(event) => { event.preventDefault(); onCancel(); }}>
			<header className="share-picker-header">
				<span className="share-heading-icon"><ScreenShare size={22} /></span>
				<div className="share-heading-copy">
					<h2 id="share-title" ref={headingRef} tabIndex={-1}>{showSettings ? 'Configurar transmisión' : 'Compartir pantalla'}</h2>
					<p>{showSettings ? 'Revisá la fuente, el audio y la calidad.' : 'Elegí una ventana o una pantalla para compartir.'}</p>
				</div>
				<button type="button" className="share-close" onClick={onCancel} aria-label="Cerrar selector"><X size={19} /></button>
			</header>

			{showSettings && selectedSource ? (
				<div className="share-content share-config">
					<section className="share-section" aria-labelledby="share-source-label">
						<h3 id="share-source-label">Fuente</h3>
						<div className="share-selected">
							<SourcePreview source={selectedSource} />
							<span className="share-selected-text"><strong title={selectedSource.name}>{selectedSource.name}</strong><small>{selectedSource.kind === 'window' ? 'Ventana' : 'Pantalla completa'}</small></span>
							<button type="button" className="share-secondary" onClick={back} disabled={pending}>Cambiar</button>
						</div>
					</section>
					<label className="share-audio">
						<span className="share-row-icon"><Volume2 size={19} /></span>
						<span className="share-selected-text"><strong>Compartir audio del sistema</strong><small>Incluye el sonido de las aplicaciones del equipo.</small></span>
						<input type="checkbox" role="switch" aria-label="Compartir audio del sistema" checked={options.audio} disabled={pending} onChange={(event) => {
							const audio = event.target.checked;
							setOptions((previous) => ({...previous, audio}));
						}} />
						<span className="share-switch" aria-hidden="true" />
					</label>
					<section className="share-section" aria-labelledby="share-channel-label">
						<h3 id="share-channel-label">Canal de voz</h3>
						<div className="share-destination"><Icon name="speaker" size={18} /> <span>{channelName}</span></div>
					</section>
					<fieldset className="share-quality" disabled={pending}>
						<legend>Calidad de transmisión</legend>
						<select className="select" aria-label="Perfil de calidad" value={preset?.label ?? ''} onChange={(event) => {
							const next = PRESETS.find(({label}) => label === event.target.value);
							if (next) setOptions(({audio}) => ({...next, audio}));
						}}>
							{!preset && <option value="">Personalizada</option>}
							{PRESETS.map(({label, height, frameRate}) => <option key={label} value={label}>{label} · {height}p a {frameRate} fps</option>)}
						</select>
						<div className="share-quality-fields">
							<div className="share-field">
								<span id="share-resolution-label">Resolución</span>
								<div className="share-segments" role="group" aria-labelledby="share-resolution-label">
									{RESOLUTIONS.map(({label, width, height}) => (
											<button key={label} type="button" aria-pressed={options.height === height} onClick={() => setOptions((previous) => ({...previous, width, height}))}>{label}</button>
									))}
								</div>
							</div>
							<label className="share-field">Cuadros por segundo
								<select className="select" value={options.frameRate} onChange={(event) => {
									const frameRate = Number(event.target.value);
									setOptions((previous) => ({...previous, frameRate}));
								}}>
									{FRAME_RATES.map((rate) => <option key={rate} value={rate}>{rate} fps</option>)}
								</select>
							</label>
						</div>
						<button className="share-advanced" type="button" aria-expanded={advanced} onClick={() => setAdvanced((value) => !value)}>
							<Icon name={advanced ? 'chevronDown' : 'chevronRight'} size={14} /> Ajustes avanzados
						</button>
						{advanced && <label className="share-field">Bitrate máximo · {Math.round(options.maxBitrate / 1_000_000)} Mbps
							<input type="range" min={1} max={50} value={options.maxBitrate / 1_000_000} onChange={(event) => {
								const maxBitrate = Number(event.target.value) * 1_000_000;
								setOptions((previous) => ({...previous, maxBitrate}));
							}} />
						</label>}
					</fieldset>
				</div>
			) : (
				<>
					<div className="share-picker-tabs" role="group" aria-label="Tipo de fuente">
						<button type="button" aria-pressed={tab === 'window'} onClick={() => { setTab('window'); setSelected(null); }}><AppWindow size={17} /> Ventanas</button>
						<button type="button" aria-pressed={tab === 'screen'} onClick={() => { setTab('screen'); setSelected(null); }}><Monitor size={17} /> Pantallas</button>
					</div>
					<div className="share-content share-sources" aria-busy={loading}>
						{!filtered.length ? <p className="share-empty" role="status">{loading ? 'Buscando fuentes…' : tab === 'window' ? 'No hay ventanas disponibles para compartir.' : 'No se encontraron pantallas.'}</p> : (
							<div className="share-picker-grid">
								{filtered.map((source) => (
										<button className="share-source" type="button" key={source.id} title={source.name} aria-pressed={selected === source.id} onClick={() => pick(source)}>
										<SourcePreview source={source} />
										<span className="share-source-name">
											{source.appIcon && <img src={source.appIcon} alt="" />}
											<span>{source.name}</span>
										</span>
										{selected === source.id && <span className="share-source-check"><Check size={15} /></span>}
									</button>
								))}
							</div>
						)}
					</div>
				</>
			)}

			{error && <p className="share-error" role="alert">{error}</p>}
			<footer className="share-picker-footer">
				<button type="button" className="share-secondary" onClick={showSettings ? back : onCancel} disabled={pending}>
					{showSettings && <ArrowLeft size={16} />}{showSettings ? 'Atrás' : 'Cancelar'}
				</button>
				<button type="button" className="share-primary" disabled={!selectedSource || pending} onClick={() => {
					if (showSettings) void confirm();
					else { setError(''); setConfiguring(true); }
				}}>
					{pending ? 'Iniciando…' : showSettings ? 'Empezar a compartir' : 'Continuar'}
					{!showSettings && <ArrowRight size={16} />}
				</button>
			</footer>
		</dialog>
	);
}
