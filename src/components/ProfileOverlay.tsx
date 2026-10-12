import {type CSSProperties, useMemo} from 'react';
import {particleUrl} from '@/lib/particleImages';
import type {ParticleDirection} from '@/types';

/** Cantidad por defecto de cada overlay (se puede cambiar desde la galería). */
const DEFAULT_COUNT: Record<string, number> = {
	hearts: 5,
	arcane: 6,
	poison: 5,
	celestial: 6,
	inferno: 6,
	void: 7,
	frost: 6,
	royal: 6,
	nature: 6,
	custom: 8,
};
/** Duración base del recorrido (con velocidad 1). */
const TRAVEL_SECONDS = 4.6;

/**
 * Overlay animado del perfil.
 *
 * - Las POSICIONES son al azar (no salen en escalera).
 * - Los TIEMPOS son regulares: una partícula cada duración / cantidad.
 * - Se controla la velocidad (duración), la vida (cuánto dura visible), el tamaño,
 *   la cantidad, la dirección y el color (o el color original de la imagen).
 */
export function ProfileOverlay({
	effect,
	color,
	particle,
	imageId,
	direction = 'up',
	size,
	count,
	speed = 1,
	life = 1,
	original = false,
}: {
	effect?: string;
	color?: string;
	particle?: string;
	imageId?: string;
	direction?: ParticleDirection;
	size?: number;
	count?: number;
	speed?: number;
	life?: number;
	original?: boolean;
}): JSX.Element | null {
	// La imagen propia tiene prioridad; si no, se usa la partícula incluida elegida.
	const image = particle ?? particleUrl(imageId);
	const active = Boolean(effect && effect !== 'none' && !(effect === 'custom' && !image));
	const total = Math.max(1, Math.min(24, Math.round(count ?? DEFAULT_COUNT[effect ?? ''] ?? 5)));
	const dir: ParticleDirection = direction ?? 'up';
	const duration = TRAVEL_SECONDS / Math.max(0.2, Math.min(4, speed));
	const alive = Math.max(0.2, Math.min(1, life));

	// Los hooks van SIEMPRE arriba, antes de cualquier return.
	const seeds = useMemo(
		() =>
			Array.from({length: total}, (_, index) => ({
				position: Math.random() * 96,
				scale: 0.85 + Math.random() * 0.35,
				delay: (index / total) * duration,
			})),
		[total, effect, duration],
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
					: effect === 'celestial' || effect === 'void' || effect === 'royal'
						? 'po-star'
						: effect === 'inferno'
							? 'po-ember'
							: effect === 'frost'
								? 'po-flake'
								: effect === 'nature'
									? 'po-spark'
									: effect === 'custom'
										? 'po-image'
										: null;

	const vertical = dir === 'down' || dir === 'up';

	/** Posición (sólo el eje perpendicular es aleatorio) + tiempos regulares + vida. */
	function seedStyle(seed: {position: number; scale: number; delay: number}): CSSProperties {
		const style: Record<string, string> = {
			animationDelay: `${seed.delay.toFixed(2)}s`,
			animationDuration: `${duration.toFixed(2)}s`,
			'--p-scale': seed.scale.toFixed(2),
		};
		// La vida se expresa apagando la opacidad a partir de cierto punto del recorrido.
		for (let step = 2; step <= 9; step += 1) {
			style[`--o${step}`] = step / 10 >= alive ? '0' : '1';
		}
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
		<div
			className={`profile-overlay is-${effect}${original ? ' is-original' : ''}`}
			data-dir={dir}
			style={style}
			aria-hidden="true">
			{particleClass
				? seeds.map((seed, index) => <span key={index} className={particleClass} style={seedStyle(seed)} />)
				: null}
		</div>
	);
}
