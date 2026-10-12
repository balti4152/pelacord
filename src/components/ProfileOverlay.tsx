/**
 * Overlay animado del perfil: se reproduce al abrir el perfil y acompaña la decoración
 * elegida (corazones, energía arcana o líneas de neón). Es decorativo: no bloquea clicks
 * ni tapa la información.
 */
export function ProfileOverlay({effect}: {effect?: string}): JSX.Element | null {
	if (!effect || effect === 'none') return null;

	return (
		<div className={`profile-overlay is-${effect}`} aria-hidden="true">
			{effect === 'hearts' ? (
				<>
					<span className="po-heart" style={{left: '10%', animationDelay: '0s'}} />
					<span className="po-heart" style={{left: '34%', animationDelay: '1.1s'}} />
					<span className="po-heart" style={{left: '62%', animationDelay: '2.1s'}} />
					<span className="po-heart" style={{left: '84%', animationDelay: '0.6s'}} />
				</>
			) : null}
			{effect === 'arcane' ? (
				<>
					<span className="po-spark" style={{left: '16%', animationDelay: '0.2s'}} />
					<span className="po-spark" style={{left: '44%', animationDelay: '1.2s'}} />
					<span className="po-spark" style={{left: '72%', animationDelay: '2s'}} />
					<span className="po-spark" style={{left: '90%', animationDelay: '0.8s'}} />
				</>
			) : null}
			{effect === 'cyber' ? <span className="po-glitch" /> : null}
		</div>
	);
}
