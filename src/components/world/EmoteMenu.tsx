import {Bot, Disc3, Flame, Hand, Heart, Music2, PartyPopper, Sparkles, Waves, X, Zap} from 'lucide-react';
import type {LucideIcon} from 'lucide-react';
import type {Emote, LoopAnim} from '@/world/core';

export type LoopEmote = LoopAnim;

export interface EmoteDef {
	id: Emote | LoopEmote;
	label: string;
	icon: LucideIcon;
	color: string;
	loop?: boolean;
	key: string;
	flip?: boolean;
}

/** Todos los gestos, en el orden de las teclas 1…0. */
export const EMOTES: EmoteDef[] = [
	{id: 'wave', label: 'Saludar', icon: Hand, color: '#4fb3ff', key: '1'},
	{id: 'cheer', label: 'Festejar', icon: PartyPopper, color: '#38d39f', key: '2'},
	{id: 'heart', label: 'Corazón', icon: Heart, color: '#ff6fae', key: '3'},
	{id: 'dance', label: 'Bailar', icon: Music2, color: '#8a5cff', key: '4', loop: true},
	{id: 'hips', label: 'Caderazo', icon: Flame, color: '#ff7a45', key: '5', loop: true},
	{id: 'disco', label: 'Disco', icon: Disc3, color: '#ff4fa8', key: '6', loop: true},
	{id: 'pogo', label: 'Pogo', icon: Zap, color: '#ffc93c', key: '7', loop: true},
	{id: 'sway', label: 'Recital', icon: Waves, color: '#4fd1c5', key: '8', loop: true},
	{id: 'robot', label: 'Robot', icon: Bot, color: '#3fc2c9', key: '9', loop: true},
	{id: 'clap', label: 'Aplaudir', icon: Sparkles, color: '#ff9e3c', key: '0', loop: true},
];

/** El menú de gestos (se abre con el botón "Emotes" o con Q). */
export function EmoteMenu({active, onPick, onClose}: {active: string; onPick: (emote: EmoteDef) => void; onClose: () => void}): JSX.Element {
	return (
		<div className="t-emote-menu" onKeyDown={(e) => e.stopPropagation()}>
			<header>
				<strong>Emotes</strong>
				<small>Teclas <kbd>1</kbd>…<kbd>0</kbd> · los bailes duran hasta que te movés</small>
				<button type="button" className="t-close is-small" onClick={onClose} aria-label="Cerrar"><X size={14} strokeWidth={3} /></button>
			</header>
			<div className="t-emote-grid">
				{EMOTES.map((e) => (
					<button
						key={e.id}
						type="button"
						className={`t-emote${active === e.id ? ' is-active' : ''}${e.loop ? ' is-loop' : ''}`}
						style={{'--e': e.color} as React.CSSProperties}
						onClick={() => onPick(e)}>
						<span className="t-emote-icon"><e.icon size={24} strokeWidth={2.6} className={e.flip ? 'is-flip' : ''} /></span>
						<span>{e.label}</span>
						<kbd>{e.key}</kbd>
					</button>
				))}
			</div>
		</div>
	);
}
