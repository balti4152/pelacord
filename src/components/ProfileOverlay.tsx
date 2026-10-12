import {type CSSProperties, useMemo} from 'react';

/** Cantidad por defecto de cada overlay (se puede cambiar desde la galería). */
const DEFAULT_COUNT: Record<string, number> = {hearts: 5, arcane: 6, poison: 5, celestial: 6, custom: 8};

/**
 * Overlay animado del perfil: se reproduce al abrir el perfil y acompaña la decoración
 * elegida. Es decorativo: no bloquea clicks ni tapa la información.
 *
 * Las partículas salen en posiciones, tiempos y tamaños ALEATORIOS (con useMemo, para que
 * no cambien en cada render) y se pueden ajustar tamaño y cantidad.
 */
export function ProfileOverlay({
	effect,
	color,
	particle,
	size,
	count,
}: {
	effect?: string;
	color?: string;
	particle?: string;
	size?: number;
	count?: number;
}): JSX.Element | null {
	const active = Boolean(effect && effect !== 'none' && !(effect === 'custom' && !particle));
	const total = Math.max(1, Math.min(24, Math.round(count ?? DEFAULT_COUNT[effect ?? ''] ?? 5)));

	// Los hooks van SIEMPRE arriba, antes de cualquier return.
	const seeds = useMemo(
		() =>
			Array.from({length: total}, () => ({
				left: Math.random() * 94,
				delay: Math.random() * 4,
				duration: 3.6 + Math.random() * 2.8,
				scale: 0.7 + Math.random() * 0.6,
			})),
		[total, effect],
	);

	if (!active) return null;

	const style = {
		'--overlay-color': color || undefined,
		'--overlay-image': particle ? `url(${particle})` : undefined,
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

	return (
		<div className={`profile-overlay is-${effect}`} style={style} aria-hidden="true">
			{particleClass
				? seeds.map((seed, index) => (
						<span
							key={index}
							className={particleClass}
							style={
								{
									left: `${seed.left}%`,
									animationDelay: `${seed.delay.toFixed(2)}s`,
									animationDuration: `${seed.duration.toFixed(2)}s`,
									'--p-scale': seed.scale.toFixed(2),
								} as CSSProperties
							}
						/>
					))
				: null}
		</div>
	);
}
