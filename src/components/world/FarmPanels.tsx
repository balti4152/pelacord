import {useState, type ReactNode} from 'react';
import {ArrowLeft, Carrot, Coins, Droplets, Hammer, MousePointer2, Plus, Shovel, Sprout} from 'lucide-react';
import {Panel} from '@/components/world/WorldPanels';
import {getProfile, updateProfile, useProfile, type WorldProfile} from '@/world/core';
import {CROPS, LOTS, SPRINKLER_PRICE, UPGRADES, cropIds, type Crop, type FarmAction, type FarmTool} from '@/world/farmData';
import {worldSounds} from '@/world/worldSounds';

const ICONS: Record<Crop, string> = {potato: '🥔', carrot: '🥕', berry: '🍓'};
const TOOLS = [
	{id: 'walk', label: 'Caminar', Icon: MousePointer2},
	{id: 'hoe', label: 'Azada', Icon: Shovel},
	{id: 'plant', label: 'Sembrar', Icon: Sprout},
	{id: 'can', label: 'Regar', Icon: Droplets},
	{id: 'harvest', label: 'Cosechar', Icon: Carrot},
	{id: 'sprinkler', label: 'Aspersor', Icon: Plus},
] as const;

export function FarmToolbar({action, seed, onAction, onSeed}: {
	action: FarmAction; seed: Crop; onAction: (action: FarmAction) => void; onSeed: (crop: Crop) => void;
}): JSX.Element {
	const {farm} = useProfile();
	return (
		<div className="w-farm-toolbar" aria-label="Herramientas de la huerta">
			{action === 'plant' ? (
				<label className="w-farm-seed">
					<span>Semilla</span>
					<select value={seed} onChange={(event) => onSeed(event.target.value as Crop)}>
						{cropIds.map((crop) => <option value={crop} key={crop}>{ICONS[crop]} {CROPS[crop].name} ({farm.seeds[crop]})</option>)}
					</select>
				</label>
			) : null}
			<div className="w-farm-tools">
				{TOOLS.map(({id, label, Icon}) => (
					<button type="button" key={id} aria-pressed={action === id} className={action === id ? 'is-active' : ''} onClick={() => onAction(id)}>
						<Icon size={17} strokeWidth={2.5} /><span>{label}{id === 'sprinkler' ? ' · ' + farm.sprinklers : ''}</span>
					</button>
				))}
			</div>
			<span className="w-farm-hint">{action === 'walk' ? 'Movete con WASD o las flechas' : 'Hacé clic en una parcela cercana'}</span>
		</div>
	);
}

function Item({art, title, description, children}: {art: string; title: string; description: string; children: ReactNode}): JSX.Element {
	return (
		<article className="w-venue-item">
			<div className="w-venue-item-art" aria-hidden="true">{art}</div>
			<div className="w-venue-copy"><strong>{title}</strong><span>{description}</span></div>
			<div className="w-venue-item-actions">{children}</div>
		</article>
	);
}

function PriceButton({amount, disabled, onClick, label = 'Comprar'}: {amount: number; disabled: boolean; onClick: () => void; label?: string}): JSX.Element {
	return <button type="button" className="t-btn is-primary" disabled={disabled} onClick={onClick} aria-label={label + ' por ' + amount + ' pelamonedas'}><Coins size={14} /> {amount}</button>;
}

function purchase(amount: number, change: (p: WorldProfile) => Partial<WorldProfile> | undefined): boolean {
	const p = getProfile();
	if (p.coins < amount) return false;
	const next = change(p);
	if (!next) return false;
	updateProfile({...next, coins: p.coins - amount});
	worldSounds.play('purchase');
	return true;
}

export function FarmShop({onClose, onBack}: {onClose: () => void; onBack: () => void}): JSX.Element {
	const {farm, coins} = useProfile();
	const [tab, setTab] = useState<'buy' | 'sell'>('buy');
	const [message, setMessage] = useState('');
	return (
		<Panel title="Tienda de huerta" icon={Sprout} onClose={onClose} className="w-venue-panel" coins={coins}>
			<div className="w-venue-tabs">
				<button type="button" aria-pressed={tab === 'buy'} onClick={() => setTab('buy')}>Comprar</button>
				<button type="button" aria-pressed={tab === 'sell'} onClick={() => setTab('sell')}>Vender cosecha</button>
			</div>
			<div className="w-venue-list">
				{cropIds.map((crop) => {
					const data = CROPS[crop];
					const qty = farm.harvest[crop];
					return tab === 'buy' ? (
						<Item key={crop} art={ICONS[crop]} title={'Semillas de ' + data.name.toLowerCase()} description={data.pack + ' por paquete · ' + farm.seeds[crop] + ' en tu bolso'}>
							<PriceButton amount={data.price} disabled={coins < data.price} onClick={() => {
								if (purchase(data.price, (p) => ({farm: {...p.farm, seeds: {...p.farm.seeds, [crop]: p.farm.seeds[crop] + data.pack}}}))) setMessage('Semillas guardadas en tu bolso.');
							}} />
						</Item>
					) : (
						<Item key={crop} art={ICONS[crop]} title={data.name} description={qty + ' en tu bolso · ' + data.sell + ' por unidad'}>
							<button type="button" className="t-btn is-primary" disabled={!qty} onClick={() => {
								const p = getProfile();
								const count = p.farm.harvest[crop];
								if (!count) return;
								const paid = count * data.sell;
								updateProfile({coins: p.coins + paid, farm: {...p.farm, harvest: {...p.farm.harvest, [crop]: 0}}});
								worldSounds.play('sell');
								setMessage('Vendiste toda esa cosecha por ' + paid + ' pelamonedas.');
							}}>Vender todo</button>
						</Item>
					);
				})}
				{tab === 'buy' ? (
					<Item art="💦" title="Aspersor" description={'Riega automáticamente las ocho parcelas vecinas · ' + farm.sprinklers + ' guardados'}>
						<PriceButton amount={SPRINKLER_PRICE} disabled={coins < SPRINKLER_PRICE} onClick={() => {
							if (purchase(SPRINKLER_PRICE, (p) => ({farm: {...p.farm, sprinklers: p.farm.sprinklers + 1}}))) setMessage('Aspersor guardado en tu bolso.');
						}} />
					</Item>
				) : null}
			</div>
			<footer className="w-venue-foot">
				<button type="button" className="t-btn is-soft" onClick={onBack}><ArrowLeft size={16} /> Volver</button>
				<span role="status">{message}</span>
			</footer>
		</Panel>
	);
}

export function SmithPanel({onClose}: {onClose: () => void}): JSX.Element {
	const {farm, coins} = useProfile();
	const [message, setMessage] = useState('');
	return (
		<Panel title="Herrería" icon={Hammer} onClose={onClose} className="w-venue-panel" coins={coins}>
			<div className="w-venue-list">
				{(['hoe', 'can'] as FarmTool[]).map((tool) => {
					const level = farm.tools[tool];
					const price = UPGRADES[level];
					const label = tool === 'hoe' ? 'Azada' : 'Regadera';
					return (
						<Item key={tool} art={tool === 'hoe' ? '⛏️' : '💧'} title={label} description={price ? 'Nivel ' + level + ' · la mejora alcanza ' + (level === 1 ? '5' : '13') + ' parcelas de una vez' : 'Nivel máximo · 13 parcelas por uso'}>
							{price ? <PriceButton amount={price} disabled={coins < price} label={'Mejorar ' + label} onClick={() => {
								if (purchase(price, (p) => p.farm.tools[tool] === level ? {farm: {...p.farm, tools: {...p.farm.tools, [tool]: level + 1}}} : undefined)) setMessage(label + ' mejorada al nivel ' + (level + 1) + '.');
							}} /> : null}
						</Item>
					);
				})}
			</div>
			<p className="w-venue-status" role="status">{message}</p>
		</Panel>
	);
}

const lotSize = (level: number): number => {
	const lot = LOTS[level];
	return (lot.right - lot.left + 1) * (lot.back - lot.front + 1);
};

export function FarmLandPanel({onClose}: {onClose: () => void}): JSX.Element {
	const {farm, coins} = useProfile();
	const level = farm.land.level;
	const next = LOTS[level + 1];
	const [message, setMessage] = useState('');
	return (
		<Panel title="Ampliar la huerta" icon={Sprout} onClose={onClose} className="w-venue-panel" coins={coins}>
			<div className="w-lot-map" aria-hidden="true">
				{LOTS.map((lot, i) => <div key={lot.price} className={i <= level ? 'is-owned' : i === level + 1 ? 'is-next' : ''} style={{width: (lot.right - lot.left + 1) * 17, height: (lot.back - lot.front + 1) * 13}} />)}
			</div>
			<div className="w-venue-list">
				<Item art="🌱" title={lotSize(level) + ' parcelas disponibles'} description={next ? 'Usá la azada para preparar la tierra dentro del borde.' : 'Ya tenés todo el terreno del patio.'}>
					{next ? <PriceButton amount={next.price} disabled={coins < next.price} label={'Ampliar a ' + lotSize(level + 1) + ' parcelas'} onClick={() => {
						if (purchase(next.price, (p) => p.farm.land.level === level ? {farm: {...p.farm, land: {...p.farm.land, level: level + 1}}} : undefined)) setMessage('El borde de tu huerta se amplió.');
					}} /> : null}
				</Item>
			</div>
			<p className="w-venue-status" role="status">{message}</p>
		</Panel>
	);
}

