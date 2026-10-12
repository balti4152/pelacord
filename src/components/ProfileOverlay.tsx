import {type CSSProperties, useMemo} from 'react';
import {particleUrl} from '@/lib/particleImages';
import type {ParticleDirection} from '@/types';

/** Cantidad por defecto de cada overlay (se puede cambiar desde la galería). */
const DEFAULT_COUNT: Record<string, number> = {hearts: 5, arcane: 6, poison: 5, celestial: 6, custom: 8};
/** Duración fija: así las partículas salen cada cierto tiempo y no amontonadas. */
const TRAVEL_SECONDS = 4.6;

/**
 * Overlay animado del perfil.
 *
 * - Las POSICIONES son al azar (no salen en escalera).
 * - Los TIEMPOS son regulares: una partícula cada TRAVEL_SECONDS / cantidad.
 * - Se puede elegir la dirección (arriba/abajo/izquierda/derecha), el tamaño y la cantidad.
 */
export function ProfileOverlay({
	effect,
	color,
	particle,
	imageId,
	direction = 'up',
	size,
	count,
}: {
	effect?: string;
	color?: string;
	particle?: string;
	imageId?: string;
	direction?: ParticleDirection;
	size?: number;
	count?: number;
}): JSX.Element | null {
	// La imagen propia tiene prioridad; si no, se usa la partícula incluida elegida.
	const image = particle ?? particleUrl(imageId);
	const active = Boolean(effect && effect !== 'none' && !(effect === 'custom' && !image));
	const total = Math.max(1, Math.min(24, Math.round(count ?? DEFAULT_COUNT[effect ?? ''] ?? 5)));
	const dir: ParticleDirection = direction ?? 'up';

	// Los hooks van SIEMPRE arriba, antes de cualquier return.
	const seeds = useMemo(
		() =>
			Array.from({length: total}, (_, index) => ({
				position: Math.random() * 96,
				scale: 0.85 + Math.random() * 0.35,
				delay: (index / total) * TRAVEL_SECONDS,
			})),
		[total, effect],
	);

	if (!active) return null;

	const style = {
		'--overlay-color': color || undefined,
		'--overlay-image': image ? `url(${image})` : undefined,
		'--particle-size': size ? String(size) : undefined,
	} as CSSProperties;

	const particleClass =
		effect === 'hearts'
			? 'po-heart'
			: effect === 'arcane'
				? 'po-spark'
				: effect === 'poison'
					? 'po-bubble'
					: effect === 'celestial'
						? 'po-star'
						: effect === 'custom'
							? 'po-image'
							: null;

	const vertical = dir === 'down' || dir === 'up';

	/** Posición inicial (sólo el eje perpendicular es aleatorio) + tiempos regulares. */
	function seedStyle(seed: {position: number; scale: number; delay: number}): CSSProperties {
		const style: Record<string, string> = {
			animationDelay: `${seed.delay.toFixed(2)}s`,
			animationDuration: `${TRAVEL_SECONDS}s`,
			'--p-scale': seed.scale.toFixed(2),
		};
		if (vertical) {
			style.left = `${seed.position}%`;
			if (dir === 'down') style.top = '-10%';
			else style.bottom = '-10%';
		} else {
			style.top = `${seed.position}%`;
			style.bottom = 'auto';
			if (dir === 'right') style.left = '-10%';
			else style.right = '-10%';
		}
		return style as unknown as CSSProperties;
	}

	return (
		<div className={`profile-overlay is-${effect}`} data-dir={dir} style={style} aria-hidden="true">
			{particleClass
				? seeds.map((seed, index) => <span key={index} className={particleClass} style={seedStyle(seed)} />)
				: null}
		</div>
	);
}
