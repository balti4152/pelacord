import {type PointerEvent, useEffect, useRef, useState} from 'react';
import {fileToDataUrl} from '@/lib/image';
import type {AvatarCrop} from '@/types';

const MIN_ZOOM = 1;
const MAX_ZOOM = 4;
/** Resolución de la imagen que se muestra mientras se recorta (no es la que se guarda). */
const PREVIEW_SIZE = 720;

/**
 * El desplazamiento se limita para que la imagen siempre cubra el cuadro: con zoom z,
 * la imagen sobresale (z - 1) / 2 * 100 % por lado, así que no se puede mover más que eso.
 */
function clampOffset(value: number, zoom: number): number {
	const limit = ((zoom - 1) / 2) * 100;
	return Math.min(limit, Math.max(-limit, value));
}

/** Vista previa de cómo queda el avatar: arrastrar para centrar + zoom. */
export function AvatarEditor({
	file,
	onCancel,
	onSave,
}: {
	file: File;
	onCancel: () => void;
	onSave: (crop: AvatarCrop) => void;
}): JSX.Element {
	const [source, setSource] = useState<string | null>(null);
	const [crop, setCrop] = useState<AvatarCrop>({zoom: 1, x: 0, y: 0});
	const drag = useRef<{pointerId: number; startX: number; startY: number; originX: number; originY: number} | null>(null);
	const frameRef = useRef<HTMLDivElement>(null);

	useEffect(() => {
		let active = true;
		void fileToDataUrl(file, PREVIEW_SIZE, 0.9)
			.then((url) => {
				if (active) setSource(url);
			})
			.catch(() => {
				if (active) setSource(null);
			});
		return () => {
			active = false;
		};
	}, [file]);

	function applyZoom(next: number): void {
		const zoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, next));
		setCrop((prev) => ({zoom, x: clampOffset(prev.x, zoom), y: clampOffset(prev.y, zoom)}));
	}

	function onPointerDown(event: PointerEvent<HTMLDivElement>): void {
		try {
			(event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
		} catch {
			// sin captura el arrastre igual funciona mientras el puntero siga encima
		}
		drag.current = {
			pointerId: event.pointerId,
			startX: event.clientX,
			startY: event.clientY,
			originX: crop.x,
			originY: crop.y,
		};
	}

	function onPointerMove(event: PointerEvent<HTMLDivElement>): void {
		const active = drag.current;
		const frame = frameRef.current;
		if (!active || !frame) return;
		const size = frame.getBoundingClientRect().width || 1;
		setCrop((prev) => ({
			zoom: prev.zoom,
			x: clampOffset(active.originX + ((event.clientX - active.startX) / size) * 100, prev.zoom),
			y: clampOffset(active.originY + ((event.clientY - active.startY) / size) * 100, prev.zoom),
		}));
	}

	function onPointerUp(): void {
		drag.current = null;
	}

	const transform = `translate(${crop.x}%, ${crop.y}%) scale(${crop.zoom})`;

	return (
		<div className="modal-backdrop" onClick={onCancel}>
			<div className="modal avatar-editor" onClick={(event) => event.stopPropagation()}>
				<h2 className="modal-title">Ajustá tu avatar</h2>
				<p className="settings-hint">Arrastrá para centrar la imagen y usá el zoom. Así se va a ver:</p>

				<div className="avatar-editor-stage">
					<div
						className="avatar-editor-frame"
						ref={frameRef}
						onPointerDown={onPointerDown}
						onPointerMove={onPointerMove}
						onPointerUp={onPointerUp}
						onPointerCancel={onPointerUp}>
						{source ? <img className="avatar-editor-image" src={source} alt="" style={{transform}} draggable={false} /> : null}
						<span className="avatar-editor-ring" />
					</div>
					<div className="avatar-editor-samples" title="Cómo se ve en tamaño chico">
						{[88, 48, 24].map((size) => (
							<div className="avatar" key={size} style={{width: size, height: size}}>
								<div className="avatar-inner" style={{backgroundColor: 'var(--background-tertiary)'}}>
									{source ? <img src={source} alt="" style={{transform}} draggable={false} /> : null}
								</div>
							</div>
						))}
					</div>
				</div>

				<label className="avatar-editor-zoom">
					<span>Zoom</span>
					<input
						type="range"
						min={MIN_ZOOM}
						max={MAX_ZOOM}
						step={0.01}
						value={crop.zoom}
						onChange={(event) => applyZoom(Number(event.target.value))}
					/>
					<span className="avatar-editor-zoom-value">{crop.zoom.toFixed(1)}×</span>
				</label>

				<div className="avatar-editor-actions">
					<button type="button" className="button secondary" onClick={onCancel}>
						Cancelar
					</button>
					<button
						type="button"
						className="button primary"
						disabled={!source}
						onClick={() => onSave(crop)}>
						Usar este avatar
					</button>
				</div>
			</div>
		</div>
	);
}
