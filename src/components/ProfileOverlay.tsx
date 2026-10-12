import type {CSSProperties} from 'react';

/**
 * Overlay animado del perfil: se reproduce al abrir el perfil y acompaña la decoración
 * elegida. Es decorativo: no bloquea clicks ni tapa la información.
 *
 * `color` y `particle` permiten personalizarlo (y que el usuario use su propia imagen).
 */
export function ProfileOverlay({
	effect,
	color,
	particle,
}: {
	effect?: string;
	color?: string;
	particle?: string;
}): JSX.Element | null {
	if (!effect || effect === 'none') return null;
	if (effect === 'custom' && !particle) return null;

	const style = {
		'--overlay-color': color || undefined,
		'--overlay-image': particle ? `url(${particle})` : undefined,
	} as CSSProperties;

	const particleClass =
		effect === 'hearts'
			? 'po-heart'
			: effect === 'poison'
				? 'po-bubble'
				: effect === 'celestial'
					? 'po-star'
					: effect === 'custom'
						? 'po-image'
						: null;
	const count = effect === 'custom' ? 8 : 4;

	return (
		<div className={`profile-overlay is-${effect}`} style={style} aria-hidden="true">
			{particleClass
				? Array.from({length: count}, (_, index) => (
						<span
							key={index}
							className={particleClass}
							style={{
								left: `${6 + (index * 88) / count}%`,
								animationDelay: `${(index * 0.85).toFixed(2)}s`,
							}}
						/>
					))
				: null}
		</div>
	);
}
