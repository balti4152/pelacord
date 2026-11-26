/**
 * Mesa de juegos: dibujos de cada juego (para elegir) y las pantallas de STOP y Carrera Wiki.
 */
import {useEffect, useMemo, useRef, useState} from 'react';
import {ArrowLeft, Check, Flag, Hand, Loader2, MousePointerClick, Trophy, X} from 'lucide-react';
import {normalizeAnswer, STOP_CATEGORIES, stopPoints, table, type TableGameKind, type TableSession, wikiKey} from '@/world/tableGames';
import {worldSounds} from '@/world/worldSounds';

// ------------------------------------------------------------- dibujos ---

function UnoCard({x, y, r, color, label, small = false}: {x: number; y: number; r: number; color: string; label: string; small?: boolean}): JSX.Element {
	return (
		<g transform={`translate(${x} ${y}) rotate(${r})`}>
			<rect x={-17} y={-25} width={34} height={50} rx={5} fill="#fff" />
			<rect x={-14} y={-22} width={28} height={44} rx={3.5} fill={color} />
			<ellipse cx={0} cy={0} rx={11} ry={17} transform="rotate(28)" fill="#fff" />
			<text x={0} y={small ? 4 : 6} textAnchor="middle" fontSize={small ? 11 : 16} fontWeight={900} fill={color} fontFamily="Nunito, sans-serif">{label}</text>
			<text x={-9} y={-12} textAnchor="middle" fontSize={7} fontWeight={900} fill="#fff" fontFamily="Nunito, sans-serif">{label}</text>
		</g>
	);
}

export function GameArt({game}: {game: TableGameKind}): JSX.Element {
	switch (game) {
		case 'cards':
			return (
				<svg viewBox="0 0 140 90" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
					<rect width="140" height="90" fill="#1f7a4d" />
					<ellipse cx="70" cy="96" rx="80" ry="36" fill="#18663f" />
					<UnoCard x={44} y={50} r={-22} color="#ff4d5e" label="7" />
					<UnoCard x={70} y={44} r={0} color="#ffc93c" label="+2" small />
					<UnoCard x={96} y={50} r={22} color="#4f8dff" label="⇄" small />
				</svg>
			);
		case 'stop':
			return (
				<svg viewBox="0 0 140 90" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
					<rect width="140" height="90" fill="#ffefc2" />
					{[['Animal', 8, 14, -4], ['País', 70, 8, 5], ['Color', 92, 66, -6], ['Comida', 6, 68, 4]].map(([t, x, y, r]) => (
						<g key={t as string} transform={`translate(${x} ${y}) rotate(${r})`}>
							<rect width={(t as string).length * 6 + 12} height={17} rx={4} fill="#fff" stroke="#d8c9a4" strokeWidth={1.5} />
							<rect y={14} width={(t as string).length * 6 + 12} height={3} rx={1.5} fill="#e7d8b2" />
							<text x={6} y={11.5} fontSize={9} fontWeight={800} fill="#4a3a2a" fontFamily="Nunito, sans-serif">{t}</text>
						</g>
					))}
					<g transform="translate(70 46)">
						<rect x={-19} y={-19} width={38} height={38} rx={8} fill="#fff" stroke="#d8c9a4" strokeWidth={2} />
						<rect x={-19} y={14} width={38} height={5} rx={2} fill="#e7d8b2" />
						<text x={0} y={9} textAnchor="middle" fontSize={26} fontWeight={900} fill="#e2394b" fontFamily="Nunito, sans-serif">M</text>
					</g>
					<g transform="translate(116 30) rotate(12)">
						<polygon points="-11,-4.6 -4.6,-11 4.6,-11 11,-4.6 11,4.6 4.6,11 -4.6,11 -11,4.6" fill="#e2394b" stroke="#fff" strokeWidth={1.5} />
						<text x={0} y={3} textAnchor="middle" fontSize={6.5} fontWeight={900} fill="#fff" fontFamily="Nunito, sans-serif">STOP</text>
					</g>
				</svg>
			);
		case 'wiki':
			return (
				<svg viewBox="0 0 140 90" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
					<rect width="140" height="90" fill="#dfe9ff" />
					<rect x={14} y={12} width={112} height={68} rx={7} fill="#fff" stroke="#b9c8ea" strokeWidth={1.5} />
					<rect x={14} y={12} width={112} height={12} rx={7} fill="#eef3ff" />
					{[22, 29, 36].map((x) => <circle key={x} cx={x} cy={18} r={2.2} fill={['#ff6b6b', '#ffc93c', '#38d39f'][(x - 22) / 7]} />)}
					<text x={24} y={38} fontSize={9} fontWeight={900} fill="#22314d" fontFamily="Georgia, serif">Tostadora</text>
					{[46, 53, 60, 67].map((y, i) => <rect key={y} x={24} y={y} width={[80, 70, 86, 52][i]} height={3} rx={1.5} fill="#d5dceb" />)}
					<rect x={46} y={52} width={26} height={3.5} rx={1.5} fill="#3366cc" />
					<rect x={60} y={66} width={20} height={3.5} rx={1.5} fill="#3366cc" />
					<path d="M72 54 C 96 50, 104 40, 110 34" fill="none" stroke="#3366cc" strokeWidth={2} strokeDasharray="3 3" />
					<g transform="translate(112 28)">
						<rect x={-1} y={-10} width={2} height={18} fill="#22314d" />
						<path d="M1 -10 L14 -6 L1 -2 Z" fill="#e2394b" />
					</g>
				</svg>
			);
		case 'memo':
			return (
				<svg viewBox="0 0 140 90" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
					<rect width="140" height="90" fill="#efe4ff" />
					{[0, 1, 2, 3].map((i) => {
						const up = i === 1 || i === 2;
						const x = 22 + i * 26;
						return (
							<g key={i} transform={`translate(${x} ${i % 2 ? 22 : 28}) rotate(${(i - 1.5) * 5})`}>
								<rect width={22} height={30} rx={4} fill={up ? '#fff' : '#7b55d9'} stroke={up ? '#cdbcf3' : '#5c3cb8'} strokeWidth={1.5} />
								{up ? <text x={11} y={21} textAnchor="middle" fontSize={15} fill={i === 1 ? '#ff4d8a' : '#ffb21f'}>{i === 1 ? '♥' : '★'}</text>
									: <path d="M5 8 L17 8 M5 15 L17 15 M5 22 L17 22" stroke="#9c80ea" strokeWidth={2} strokeLinecap="round" />}
							</g>
						);
					})}
					<text x={70} y={78} textAnchor="middle" fontSize={9} fontWeight={800} fill="#5c3cb8" fontFamily="Nunito, sans-serif">¿cuál era el par?</text>
				</svg>
			);
		case 'cuatro':
			return (
				<svg viewBox="0 0 140 90" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
					<rect width="140" height="90" fill="#d9ecff" />
					<rect x={28} y={22} width={84} height={60} rx={7} fill="#2f6fd8" />
					{Array.from({length: 4}, (_, r) => Array.from({length: 6}, (_, c) => {
						const filled: Record<string, string> = {'3-1': '#ff4d5e', '3-2': '#ffc93c', '2-2': '#ff4d5e', '3-3': '#ff4d5e', '2-3': '#ffc93c', '1-3': '#ff4d5e', '3-4': '#ffc93c'};
						return <circle key={`${r}-${c}`} cx={38 + c * 13} cy={32 + r * 13.5} r={5.2} fill={filled[`${r}-${c}`] ?? '#d9ecff'} />;
					}))}
					<circle cx={90} cy={12} r={5.2} fill="#ffc93c" />
					<path d="M90 19 L90 24" stroke="#2f6fd8" strokeWidth={2} strokeLinecap="round" />
				</svg>
			);
		default:
			return (
				<svg viewBox="0 0 140 90" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
					<rect width="140" height="90" fill="#ffe1e1" />
					<g stroke="#4a3a5c" strokeWidth={3} strokeLinecap="round">
						<path d="M60 18 L60 78 M82 18 L82 78 M40 38 L102 38 M40 58 L102 58" />
					</g>
					<g stroke="#ff4d5e" strokeWidth={4} strokeLinecap="round">
						<path d="M44 22 L56 34 M56 22 L44 34" />
						<path d="M66 42 L78 54 M78 42 L66 54" />
					</g>
					<circle cx={92} cy={28} r={6} fill="none" stroke="#4f8dff" strokeWidth={4} />
					<circle cx={50} cy={68} r={6} fill="none" stroke="#4f8dff" strokeWidth={4} />
					<path d="M44 20 L98 76" stroke="#ffc93c" strokeWidth={3} strokeLinecap="round" opacity={0.9} />
				</svg>
			);
	}
}

// ------------------------------------------------------------------- STOP ---

const sumPoints = (points: number[] | undefined) => (points ?? []).reduce((a, b) => a + b, 0);

/** La animación de categorías: filas de teclas blancas que corren en sentidos opuestos. */
function CategoryCarousel({chosen, letter}: {chosen: string[]; letter: string}): JSX.Element {
	const [elapsed, setElapsed] = useState(0);
	const [flick, setFlick] = useState('A');
	const rows = useMemo(() => Array.from({length: 5}, (_, r) => {
		const list = [...STOP_CATEGORIES].sort(() => Math.random() - 0.5).slice(0, 14);
		return {list: [...list, ...list], speed: 16 + r * 3 + Math.random() * 6, reverse: r % 2 === 1};
	}), []);
	useEffect(() => {
		const start = performance.now();
		const timer = setInterval(() => {
			const t = (performance.now() - start) / 1000;
			setElapsed(t);
			setFlick('ABCDEFGHIJLMNOPRSTUV'[Math.floor(Math.random() * 20)]);
		}, 70);
		return () => clearInterval(timer);
	}, []);
	const settled = elapsed > 3.2;
	return (
		<div className="stop-roll">
			<div className={`stop-letter-drum${settled ? ' is-settled' : ''}`}>
				<span>{settled ? letter : flick}</span>
				<small>Letra</small>
			</div>
			<div className="stop-rows" aria-hidden="true">
				{rows.map((row, i) => (
					<div className="stop-row" key={i}>
						<div className={`stop-track${row.reverse ? ' is-reverse' : ''}`} style={{animationDuration: `${row.speed}s`}}>
							{row.list.map((cat, k) => <span key={k} className={`stop-key${chosen.includes(cat) && elapsed > 1.4 ? ' is-chosen' : ''}`}>{cat}</span>)}
						</div>
					</div>
				))}
			</div>
			<div className="stop-slots">
				{chosen.map((cat, i) => (
					<span key={cat} className={`stop-key is-slot${elapsed > 1.6 + i * 0.32 ? ' is-in' : ''}`}>{elapsed > 1.6 + i * 0.32 ? cat : '?'}</span>
				))}
			</div>
		</div>
	);
}

export function StopGame({session, me, names, onLeave}: {session: TableSession; me: string; names: (id: string) => string; onLeave: () => void}): JSX.Element {
	const cats = session.categories ?? [];
	const letter = session.letter ?? '';
	const phase = session.phase ?? 'roll';
	const [draft, setDraft] = useState<string[]>(() => session.answers?.[me] ?? cats.map(() => ''));
	const draftRef = useRef(draft);
	draftRef.current = draft;
	const isHost = session.host === me;

	// Ronda nueva: respuestas en blanco.
	useEffect(() => {
		setDraft(cats.map(() => ''));
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [session.round]);
	// Mientras escribo, mando el borrador cada tanto (si alguien dice BASTA, cuenta lo que tenga).
	useEffect(() => {
		if (phase !== 'write') return;
		const timer = setTimeout(() => table.move({kind: 'answers', answers: draftRef.current}), 700);
		return () => clearTimeout(timer);
	}, [draft, phase]);
	// Alguien dijo BASTA: mando lo último que escribí ya mismo.
	useEffect(() => {
		if (phase === 'stopping') {
			table.move({kind: 'answers', answers: draftRef.current});
			worldSounds.play('notice');
		}
		if (phase === 'write') worldSounds.play('confirm', 0.7);
	}, [phase]);

	const startsOk = (text: string) => !text.trim() || normalizeAnswer(text).startsWith(normalizeAnswer(letter));
	const complete = draft.every((a) => a.trim()) && draft.every(startsOk);
	const points = phase === 'results' ? session.roundPoints ?? stopPoints(session) : stopPoints(session);

	return (
		<div className="stop-screen" onKeyDown={(e) => e.stopPropagation()}>
			<header className="stop-head">
				<span className="stop-logo">STOP!</span>
				<span className="stop-round">Ronda {session.round} de {session.rounds ?? 3}</span>
				{phase !== 'roll' ? <span className="stop-letter-badge">{letter}</span> : null}
				<span className="stop-note">{session.note}</span>
				<button type="button" className="t-btn is-soft is-small" onClick={onLeave}>Salir</button>
			</header>

			{phase === 'roll' ? <CategoryCarousel key={session.round} chosen={cats} letter={letter} /> : null}

			{phase === 'write' || phase === 'stopping' ? (
				<div className="stop-write">
					{phase === 'stopping' ? <div className="stop-basta"><Hand size={30} /> ¡{names(session.stopBy ?? '')} dijo BASTA!</div> : null}
					<div className="stop-fields">
						{cats.map((cat, i) => (
							<label key={cat} className={`stop-field${draft[i] && !startsOk(draft[i]) ? ' is-bad' : ''}`}>
								<span className="stop-key">{cat}</span>
								<input
									value={draft[i] ?? ''}
									maxLength={40}
									disabled={phase !== 'write'}
									placeholder={`${letter}…`}
									autoFocus={i === 0}
									onChange={(e) => setDraft((d) => d.map((v, k) => (k === i ? e.target.value : v)))}
									onKeyDown={(e) => {
										if (e.key === 'Enter' && complete) table.move({kind: 'basta', answers: draftRef.current});
									}}
								/>
								{draft[i] && !startsOk(draft[i]) ? <small>Tiene que empezar con {letter}</small> : null}
							</label>
						))}
					</div>
					<button type="button" className="stop-basta-btn" disabled={!complete || phase !== 'write'} onClick={() => { worldSounds.play('confirm'); table.move({kind: 'basta', answers: draft}); }}>
						¡BASTA!
					</button>
					{!complete && phase === 'write' ? <p className="t-hint">Completá las cinco para poder decir ¡Basta!</p> : null}
				</div>
			) : null}

			{phase === 'final' ? (
				<div className="stop-final">
					<Trophy size={46} />
					<strong>{session.winner ? (session.winner === me ? '¡Ganaste la partida!' : `¡Ganó ${names(session.winner)}!`) : '¡Empate!'}</strong>
					<ol className="stop-podium">
						{[...session.players].sort((a, b) => (session.totals?.[b] ?? 0) - (session.totals?.[a] ?? 0)).map((p, i) => (
							<li key={p} className={`is-${i + 1}`}>
								<span>{i + 1}°</span>
								<b>{p === me ? 'Vos' : names(p)}</b>
								<em>{session.totals?.[p] ?? 0} pts</em>
							</li>
						))}
					</ol>
					{isHost ? <button type="button" className="t-btn is-primary" onClick={() => table.end()}>Volver a la mesa</button> : null}
				</div>
			) : null}

			{phase === 'review' || phase === 'results' ? (
				<div className="stop-review">
					<p className="t-hint">{phase === 'review' ? 'Tocá ✓ o ✗ en las respuestas de los demás. Las repetidas valen 5, las únicas 10.' : 'Resultado de la ronda'}</p>
					<div className="stop-table" style={{gridTemplateColumns: `minmax(110px, 1fr) repeat(${session.players.length}, minmax(120px, 1.2fr))`}}>
						<span className="stop-cell is-head" />
						{session.players.map((p) => <span key={p} className="stop-cell is-head">{p === me ? 'Vos' : names(p)}</span>)}
						{cats.map((cat, c) => (
							<RowCells key={cat} cat={cat} c={c} session={session} me={me} points={points} phase={phase} />
						))}
						<span className="stop-cell is-total">Ronda</span>
						{session.players.map((p) => <span key={p} className="stop-cell is-total">{sumPoints(points[p])}</span>)}
						<span className="stop-cell is-total">Total</span>
						{session.players.map((p) => <span key={p} className="stop-cell is-total is-grand">{(session.totals?.[p] ?? 0) + (phase === 'review' ? 0 : 0)}</span>)}
					</div>
					<div className="t-row stop-actions">
						{phase === 'review' ? (
							<>
								<button type="button" className="t-btn is-primary" disabled={session.ready?.includes(me)} onClick={() => table.move({kind: 'ready'})}>
									<Check size={14} /> {session.ready?.includes(me) ? `Esperando (${session.ready?.length}/${session.players.length})` : 'Ya voté'}
								</button>
								{isHost ? <button type="button" className="t-btn is-soft" onClick={() => table.move({kind: 'finish'})}>Ver resultados</button> : null}
							</>
						) : isHost ? (
							<button type="button" className="t-btn is-primary" onClick={() => table.move({kind: 'next'})}>{(session.round ?? 1) >= (session.rounds ?? 3) ? 'Ver el ganador' : 'Siguiente ronda'}</button>
						) : <span className="t-hint">Esperando a {names(session.host)}…</span>}
					</div>
				</div>
			) : null}
		</div>
	);
}

function RowCells({cat, c, session, me, points, phase}: {cat: string; c: number; session: TableSession; me: string; points: Record<string, number[]>; phase: string}): JSX.Element {
	return (
		<>
			<span className="stop-cell is-cat"><span className="stop-key">{cat}</span></span>
			{session.players.map((p) => {
				const answer = session.answers?.[p]?.[c] ?? '';
				const myVote = session.votes?.[`${p}|${c}`]?.[me];
				const pts = points[p]?.[c] ?? 0;
				return (
					<span key={p} className={`stop-cell is-answer pts-${pts}`}>
						<b>{answer || '—'}</b>
						<em>{answer ? `${pts} pts` : ''}</em>
						{phase === 'review' && p !== me && answer ? (
							<span className="stop-vote">
								<button type="button" className={myVote === true ? 'is-on' : ''} aria-label="Vale" onClick={() => table.move({kind: 'vote', target: p, cat: c, ok: true})}><Check size={13} /></button>
								<button type="button" className={myVote === false ? 'is-on is-no' : ''} aria-label="No vale" onClick={() => table.move({kind: 'vote', target: p, cat: c, ok: false})}><X size={13} /></button>
							</span>
						) : null}
					</span>
				);
			})}
		</>
	);
}

// ------------------------------------------------------------ Carrera Wiki ---

interface WikiPage {
	title: string;
	html: string;
	/** Texto plano (para ver si la palabra buscada aparece). */
	text: string;
	/** Artículos a los que lleva esta página. */
	links: string[];
}

/**
 * Qué tan "caliente" está la página: 0 = la palabra no aparece, 1-2 = aparece en el texto (más veces,
 * más caliente), 3 = hay un enlace directo a la página buscada.
 */
function heat(page: WikiPage, target: string): number {
	const key = wikiKey(target);
	if (page.links.some((l) => wikiKey(l) === key)) return 3;
	const word = normalizeAnswer(target.replace(/\s*\(.*\)$/, ''));
	if (!word) return 0;
	const text = normalizeAnswer(page.text);
	let count = 0;
	for (let i = text.indexOf(word); i >= 0 && count < 6; i = text.indexOf(word, i + word.length)) count++;
	return count === 0 ? 0 : count < 3 ? 1 : 2;
}
const HEAT_BG = ['#ffffff', '#ffe3ec', '#ffb8c9', '#ff6b7f'];

const pageCache = new Map<string, Promise<WikiPage>>();

/** Baja una página de es.wikipedia y la limpia: sólo quedan los enlaces a otros artículos. */
function loadWiki(title: string): Promise<WikiPage> {
	let p = pageCache.get(title);
	if (!p) {
		p = fetch(`https://es.wikipedia.org/w/api.php?action=parse&format=json&origin=*&redirects=1&prop=text&disableeditsection=1&disabletoc=1&page=${encodeURIComponent(title)}`)
			.then((r) => r.json())
			.then((data) => {
				if (!data?.parse) throw new Error(data?.error?.info ?? 'Sin página');
				const doc = new DOMParser().parseFromString(data.parse.text['*'], 'text/html');
				doc.querySelectorAll('script, style, link, meta, .mw-editsection, sup.reference, .reflist, .references, .navbox, .metadata, .noprint, .mw-empty-elt, .hatnote, .sistersitebox, .ambox').forEach((el) => el.remove());
				doc.querySelectorAll('*').forEach((el) => {
					for (const attr of [...el.attributes]) if (attr.name.startsWith('on')) el.removeAttribute(attr.name);
				});
				doc.querySelectorAll('img').forEach((img) => {
					const src = img.getAttribute('src');
					if (src?.startsWith('//')) img.setAttribute('src', 'https:' + src);
					img.removeAttribute('srcset');
					img.setAttribute('loading', 'lazy');
				});
				doc.querySelectorAll('a').forEach((a) => {
					const href = a.getAttribute('href') ?? '';
					const match = /^\/wiki\/([^#?]+)/.exec(href);
					const target = match ? decodeURIComponent(match[1]).replace(/_/g, ' ') : null;
					if (target && !target.includes(':')) {
						a.setAttribute('data-wiki', target);
						a.removeAttribute('href');
					} else {
						const span = doc.createElement('span');
						span.innerHTML = a.innerHTML;
						a.replaceWith(span);
					}
				});
				const links = [...doc.querySelectorAll('[data-wiki]')].map((a) => (a as HTMLElement).dataset.wiki!);
				return {title: data.parse.title as string, html: doc.body.innerHTML, text: doc.body.textContent ?? '', links};
			});
		pageCache.set(title, p);
		p.catch(() => pageCache.delete(title));
	}
	return p;
}

export function WikiRace({session, me, names, onLeave}: {session: TableSession; me: string; names: (id: string) => string; onLeave: () => void}): JSX.Element {
	const start = session.wikiStart ?? '';
	const target = session.wikiTarget ?? '';
	const [history, setHistory] = useState<string[]>([start]);
	const [page, setPage] = useState<WikiPage | null>(null);
	const [error, setError] = useState('');
	const bodyRef = useRef<HTMLDivElement>(null);
	const current = history[history.length - 1];
	const done = Boolean(session.winner);
	const pageHeat = useMemo(() => (page ? heat(page, target) : 0), [page, target]);

	useEffect(() => {
		setHistory([start]);
	}, [session.id, start]);
	useEffect(() => {
		let alive = true;
		setPage(null);
		setError('');
		loadWiki(current).then((p) => {
			if (!alive) return;
			setPage(p);
			bodyRef.current?.scrollTo({top: 0});
		}).catch((e) => alive && setError(String(e?.message ?? e)));
		return () => {
			alive = false;
		};
	}, [current]);

	const go = (title: string): void => {
		if (done) return;
		worldSounds.play('select', 0.7);
		setHistory((h) => [...h, title]);
		// El título que cuenta es el de la página real (con las redirecciones resueltas).
		void loadWiki(title).then((p) => table.move({kind: 'wiki', title: p.title})).catch(() => table.move({kind: 'wiki', title}));
	};

	// Volver atrás también cuenta como un paso (y los demás ven dónde estás).
	const back = (): void => {
		if (history.length < 2 || done) return;
		const previous = history[history.length - 2];
		setHistory((h) => h.slice(0, -1));
		table.move({kind: 'wiki', title: previous});
	};

	const ranking = [...session.players].sort((a, b) => (session.wikiAt?.[a]?.clicks ?? 0) - (session.wikiAt?.[b]?.clicks ?? 0));
	return (
		<div className="wiki-screen" onKeyDown={(e) => e.stopPropagation()}>
			<header className="wiki-head">
				<span className="wiki-goal"><Flag size={16} /> Llegá a <b>{target}</b></span>
				<span className="wiki-clicks"><MousePointerClick size={15} /> {session.wikiAt?.[me]?.clicks ?? 0} clics</span>
				<button type="button" className="t-btn is-soft is-small" disabled={history.length < 2 || done} onClick={back}><ArrowLeft size={14} /> Atrás</button>
				{page && !done ? <span className={`wiki-heat is-${pageHeat}`}>{['Frío', 'Tibio', 'Caliente', '¡Hirviendo!'][pageHeat]}</span> : null}
				{session.host === me ? <button type="button" className="t-btn is-soft is-small" onClick={() => table.end()}>Terminar partida</button> : null}
				<button type="button" className="t-btn is-soft is-small" onClick={onLeave}>Salir</button>
			</header>
			<div className="wiki-main">
				<article className="wiki-article" ref={bodyRef} style={{background: page && !done ? HEAT_BG[pageHeat] : undefined}} onClick={(e) => {
					const link = (e.target as HTMLElement).closest('[data-wiki]') as HTMLElement | null;
					if (link) go(link.dataset.wiki!);
				}}>
					{error ? <p className="t-empty">No se pudo cargar «{current}». <button type="button" className="t-btn is-soft is-small" onClick={() => setHistory((h) => h.length > 1 ? h.slice(0, -1) : h)}>Volver</button></p> : null}
					{!page && !error ? <p className="wiki-loading"><Loader2 size={26} className="music-spin" /> Cargando «{current}»…</p> : null}
					{page ? (
						<>
							<h1>{page.title}</h1>
							<div className="wiki-body" dangerouslySetInnerHTML={{__html: page.html}} />
						</>
					) : null}
				</article>
				<aside className="wiki-side">
					<h3>Corredores</h3>
					<ul>
						{ranking.map((p) => {
							const at = session.wikiAt?.[p];
							return (
								<li key={p} className={session.winner === p ? 'is-winner' : ''}>
									<strong>{p === me ? 'Vos' : names(p)}</strong>
									<small>{at?.title ?? start}</small>
									<em>{at?.clicks ?? 0} clics</em>
								</li>
							);
						})}
					</ul>
					<h3>Tu camino</h3>
					<ol className="wiki-path">
						{history.map((t, i) => <li key={i} className={wikiKey(t) === wikiKey(target) ? 'is-goal' : ''}>{t}</li>)}
					</ol>
				</aside>
			</div>
			{done ? (
				<div className="wiki-win">
					<Trophy size={40} />
					<strong>{session.winner === me ? '¡Ganaste!' : `Ganó ${names(session.winner!)}`}</strong>
					<span>{session.note}</span>
					{session.host === me ? <button type="button" className="t-btn is-primary" onClick={() => table.end()}>Volver a la mesa</button> : null}
				</div>
			) : null}
		</div>
	);
}
