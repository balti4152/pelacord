import {useState} from 'react';
import {ArrowLeft, Coins, PawPrint, ShoppingBag, Sparkles} from 'lucide-react';
import {Panel} from '@/components/world/WorldPanels';
import {useProfile} from '@/world/core';
import {PETS, type PetId} from '@/world/petCatalog';
import {buyCaptureSphere, equipPet, SPHERE_PRICE} from '@/world/pets';
import {worldSounds} from '@/world/worldSounds';

export function PetPanel({shop, onClose, onBack}: {shop: boolean; onClose: () => void; onBack?: () => void}): JSX.Element {
	const profile = useProfile();
	const [message, setMessage] = useState('');
	const species = Object.keys(PETS) as PetId[];
	const collected = species.filter((id) => profile.pets[id]).length;
	return (
		<Panel title={shop ? 'Equipo de captura' : 'Mis mascotas'} icon={shop ? ShoppingBag : PawPrint} onClose={onClose} className="t-pet-panel" coins={shop ? profile.coins : undefined}>
			<div className="t-pet-summary">
				{shop && onBack ? <button type="button" className="t-btn is-soft is-small" onClick={onBack}><ArrowLeft size={15} /> Ropa y estilo</button> : <strong>{collected} de {species.length} especies</strong>}
				<span><Sparkles size={16} /> {profile.captureSpheres} {profile.captureSpheres === 1 ? 'esfera' : 'esferas'}</span>
			</div>
			{shop ? (
				<article className="t-pet-product">
					<div className="t-pet-product-art"><img src="models/pets/sphere.webp" alt="" /></div>
					<div className="t-pet-product-copy">
						<h3>Esfera de captura</h3>
						<p>Acercate a una mascota en la ciudad y presioná <kbd>E</kbd> para atraparla.</p>
						<button type="button" className="t-btn is-primary" disabled={profile.coins < SPHERE_PRICE} onClick={() => {
							if (buyCaptureSphere()) {
								worldSounds.play('purchase');
								setMessage('Guardaste una esfera en tu inventario.');
							} else worldSounds.play('locked');
						}}><Coins size={16} /> Comprar por {SPHERE_PRICE}</button>
						{profile.coins < SPHERE_PRICE ? <small>Te faltan {SPHERE_PRICE - profile.coins} pelamonedas.</small> : null}
					</div>
				</article>
			) : (
				<div className="t-pet-list">
					{species.map((id) => {
						const pet = PETS[id];
						const count = profile.pets[id] ?? 0;
						const equipped = profile.equippedPet === id;
						return <article key={id} className={`t-pet-entry${equipped ? ' is-equipped' : ''}`}>
							<div className="t-pet-portrait" style={{background: pet.tone}}><img src={'models/pets/' + id + '.webp'} alt="" /></div>
							<div>
								<h3>{pet.name}</h3>
								<p>{pet.description}</p>
							</div>
							<div className="t-pet-entry-actions">
								<span className="t-pet-count">{equipped ? 'Te acompaña' : count ? '×' + count : 'Por descubrir'}</span>
								{count > 0 ? <button type="button" className={`t-btn is-small ${equipped ? 'is-soft' : 'is-primary'}`}
									aria-label={`${equipped ? 'Guardar' : 'Equipar'} a ${pet.name}`}
									onClick={() => { equipPet(equipped ? null : id); worldSounds.play(equipped ? 'cancel' : 'notice'); }}>{equipped ? 'Guardar' : 'Equipar'}</button> : null}
							</div>
						</article>;
					})}
				</div>
			)}
			{message ? <p className="t-toast" role="status">{message}</p> : null}
		</Panel>
	);
}
