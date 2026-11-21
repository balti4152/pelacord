import {useState} from 'react';
import {Coins, Utensils} from 'lucide-react';
import {Panel} from '@/components/world/WorldPanels';
import {getProfile, updateProfile, useProfile} from '@/world/core';
import {worldSounds} from '@/world/worldSounds';

const MENU = [
	{id: 'soup', icon: '🍲', label: 'Sopa de la casa', detail: 'Papas, zanahorias y hierbas', price: 15},
	{id: 'toast', icon: '🥪', label: 'Tostado de la plaza', detail: 'Pan dorado y queso fundido', price: 22},
	{id: 'pudding', icon: '🍮', label: 'Flan con dulce de leche', detail: 'Porción con caramelo', price: 18},
	{id: 'shake', icon: '🥤', label: 'Licuado de frutilla', detail: 'Frutillas de estación', price: 12},
];

export function RestaurantPanel({onClose}: {onClose: () => void}): JSX.Element {
	const {coins} = useProfile();
	const [order, setOrder] = useState('');
	return (
		<Panel title="Restaurante" icon={Utensils} coins={coins} className="w-venue-panel" onClose={onClose}>
			<div className="w-venue-list">
				{MENU.map(({id, icon, label, detail, price}) => (
					<article key={id} className="w-venue-item">
						<span className="w-venue-item-art" aria-hidden="true">{icon}</span>
						<div className="w-venue-copy"><strong>{label}</strong><span>{detail}</span></div>
						<button type="button" className="t-btn is-primary" disabled={coins < price} aria-label={'Pedir ' + label} onClick={() => {
							const balance = getProfile().coins;
							if (balance < price) return;
							updateProfile({coins: balance - price});
							worldSounds.play('purchase');
							setOrder(icon + ' Te sirvieron ' + label.toLowerCase() + '.');
						}}><Coins size={14} /> {price}</button>
					</article>
				))}
			</div>
			<p className="w-venue-status" role="status">{order}</p>
		</Panel>
	);
}

