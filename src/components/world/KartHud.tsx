import {useSyncExternalStore} from 'react';
import {getKartHud, KART_ITEM_IMAGE, subscribeKartHud} from '@/world/kart/kartHud';

const ORDINAL = (n: number) => `${n}`;

/** HUD del karting: poder arriba a la izquierda, monedas y vuelta abajo, puesto grande abajo a la derecha y el mapa. */
export function KartHud(): JSX.Element | null {
	const hud = useSyncExternalStore(subscribeKartHud, getKartHud);
	if (!hud.active) return null;
	const shown = hud.rolling ?? hud.item;
	return (
		<div className="kh">
			<div className={`kh-item${hud.rolling ? ' is-rolling' : ''}`}>
				<div className="kh-item-frame">
					{shown ? <img src={KART_ITEM_IMAGE[shown]} alt="" draggable={false} /> : null}
					{hud.count > 1 && !hud.rolling ? <span className="kh-item-count">x{hud.count}</span> : null}
				</div>
			</div>

			{hud.mapPath ? (
				<svg className="kh-map" viewBox="-6 -6 112 112" aria-hidden>
					<path d={hud.mapPath} className="kh-map-road-out" />
					<path d={hud.mapPath} className="kh-map-road" />
					{hud.dots.filter((d) => !d.me).map((d) => <circle key={d.id} cx={d.x} cy={d.y} r={3.2} fill={d.color} className="kh-map-dot" />)}
					{hud.dots.filter((d) => d.me).map((d) => <circle key={d.id} cx={d.x} cy={d.y} r={4.6} fill={d.color} className="kh-map-dot is-me" />)}
				</svg>
			) : null}

			<div className="kh-bottom-left">
				<div className="kh-stat kh-coins">
					<img src={KART_ITEM_IMAGE.moneda} alt="" draggable={false} />
					<b>{String(hud.coins).padStart(2, '0')}</b>
				</div>
				<div className="kh-stat kh-lap">
					<svg viewBox="0 0 24 24" aria-hidden className="kh-flag">
						<path d="M5 3v18" stroke="#fff" strokeWidth="2.4" strokeLinecap="round" />
						<path d="M6 4h14v9H6z" fill="#fff" />
						<path d="M6 4h3.5v3H6zM13 4h3.5v3H13zM9.5 7H13v3H9.5zM16.5 7H20v3h-3.5zM6 10h3.5v3H6zM13 10h3.5v3H13z" fill="#1d1d28" />
					</svg>
					<b>{Math.min(hud.lap, hud.laps)}/{hud.laps}</b>
				</div>
			</div>

			<div className={`kh-place is-p${Math.min(hud.place, 4)}`} key={hud.place}>
				<b>{ORDINAL(hud.place)}</b>
				<span>º</span>
			</div>

			{hud.countdown !== null ? (
				<div className="kh-count" key={hud.countdown}>
					<div className="kh-lights">
						{[3, 2, 1].map((k) => <i key={k} className={hud.countdown! <= k ? (hud.countdown === 0 ? 'is-go' : 'is-on') : ''} />)}
					</div>
					<b className={hud.countdown === 0 ? 'is-go' : ''}>{hud.countdown === 0 ? '¡YA!' : hud.countdown}</b>
				</div>
			) : null}

			{hud.banner ? <div className="kh-banner" key={hud.banner}>{hud.banner}</div> : null}
			{hud.wrongWay ? <div className="kh-wrong">SENTIDO CONTRARIO</div> : null}
			{hud.flash > 0 ? <div className="kh-flash" key={hud.flash} /> : null}
		</div>
	);
}
