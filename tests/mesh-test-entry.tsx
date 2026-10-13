/**
 * Prueba TEMPORAL de la malla de voz: dos VoiceMesh reales enfrentadas con un transporte falso.
 *
 * Verifica lo que estaba roto: que negocien (con choque de ofertas incluido), que la música
 * llegue en las DOS direcciones, y que una señal repetida (la malla reenvía) no rompa nada.
 */
import {type MeshTransport, VoiceMesh} from '@/lib/media';

const esperar = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Un transporte que entrega TODO lo que se manda, con una copia serializada (como el IPC). */
function hacerTransportes() {
	const crear = (yo: string): MeshTransport & {cb: ((m: {from: string; payload: unknown}) => void) | null} => ({
		cb: null,
		onSignal(callback) {
			this.cb = callback;
			return () => {
				this.cb = null;
			};
		},
		sendSignal(_to: string, payload: unknown) {
			const copia = JSON.parse(JSON.stringify(payload)) as unknown;
			const destino = yo === 'aaa' ? b : a;
			// Como en la vida real: el mensaje llega un toque después, y a veces DOS veces.
			setTimeout(() => destino.cb?.({from: yo, payload: copia}), 0);
			if (repetirTodo) setTimeout(() => destino.cb?.({from: yo, payload: copia}), 1);
		},
		selectSource() {},
	});
	let repetirTodo = false;
	const a = crear('aaa');
	const b = crear('bbb');
	return {
		a,
		b,
		repetir(on: boolean) {
			repetirTodo = on;
		},
	};
}

const transportes = hacerTransportes();
const mallaA = new VoiceMesh(() => transportes.a);
const mallaB = new VoiceMesh(() => transportes.b);

const contexto = new AudioContext();
const destinoAudio = contexto.createMediaStreamDestination();
const oscilador = contexto.createOscillator();
const ganancia = contexto.createGain();
oscilador.connect(ganancia);
ganancia.connect(destinoAudio);
oscilador.start();
const musica = destinoAudio.stream;

type Resultado = {
	pasos: string[];
	errores: string[];
	ok: boolean;
	esperados: Record<string, string | undefined>;
	medido: Record<string, string | undefined>;
	diagnostico: unknown;
};

window.__resultado = null as Resultado | null;

async function correr(): Promise<void> {
	const pasos: string[] = [];
	const anotar = (texto: string) => pasos.push(texto);

	await mallaA.start('aaa');
	await mallaB.start('bbb');
	// Los dos se conectan al mismo tiempo: eso es lo que provoca el CHOQUE de ofertas.
	await Promise.all([mallaA.connect('bbb'), mallaB.connect('aaa')]);
	// Y al mismo tiempo las dos mandan música (dos transceptores nuevos = renegociación cruzada).
	await Promise.all([mallaA.setMusicStream(musica), mallaB.setMusicStream(musica)]);

	const estadosFinales = async () => ({a: mallaA.getStates()['bbb'], b: mallaB.getStates()['aaa']});
	let estados = await estadosFinales();
	for (let intento = 0; intento < 40 && (estados.a !== 'connected' || estados.b !== 'connected'); intento++) {
		await esperar(250);
		estados = await estadosFinales();
	}
	anotar(`1) conexión: a->b=${estados.a} · b->a=${estados.b}`);

	// La música tiene que llegar en las dos direcciones.
	await esperar(600);
	const musicaEnB = mallaB.getRemotes().find((remote) => remote.peerId === 'aaa')?.music;
	const musicaEnA = mallaA.getRemotes().find((remote) => remote.peerId === 'bbb')?.music;
	anotar(
		`2) música recibida: en b=${Boolean(musicaEnB)} (${musicaEnB?.getAudioTracks().length ?? 0} pista) · en a=${Boolean(musicaEnA)} (${musicaEnA?.getAudioTracks().length ?? 0} pista)`,
	);

	// Se suelta el audio del host A: el otro lado tiene que ver la pista en silencio (muteada).
	await mallaA.setMusicStream(null);
	await esperar(900);
	const musicaCortada = mallaB.getRemotes().find((remote) => remote.peerId === 'aaa')?.music;
	const silenciada = musicaCortada?.getAudioTracks()[0]?.muted;
	anotar(`3) al cortar en a: pista presente=${Boolean(musicaCortada)} · silenciada=${String(silenciada)}`);

	// Y una pista NUEVA: tiene que reemplazar la anterior (replaceTrack), sin duplicar transceptores.
	await mallaA.setMusicStream(musica);
	await esperar(800);
	const pistasEnB = mallaB.getRemotes().find((remote) => remote.peerId === 'aaa');
	anotar(
		`4) música de nuevo: en b=${Boolean(pistasEnB?.music)} · audios sueltos=${pistasEnB?.audios.length ?? 0}`,
	);

	// Ahora toda la señalización se manda REPETIDA (como cuando un tercero la reenvía).
	transportes.repetir(true);
	await mallaA.setMusicStream(null);
	await mallaA.setMusicStream(musica);
	await esperar(1500);
	const tras = await estadosFinales();
	anotar(`5) con señales repetidas: a->b=${tras.a} · b->a=${tras.b}`);

	// Reconectar de cero (lo que hace el vigilante cuando una conexión se cae).
	mallaA.disconnect('bbb');
	await esperar(200);
	await mallaA.connect('bbb');
	let reconectado = mallaA.getStates()['bbb'];
	for (let intento = 0; intento < 40 && reconectado !== 'connected'; intento++) {
		await esperar(250);
		reconectado = mallaA.getStates()['bbb'];
	}
	anotar(`6) tras reconectar: a->b=${reconectado}`);

	const errores = (window.__errores as string[]) ?? [];
	const esperados = new Map<string, string | undefined>([
		['a->b', 'connected'],
		['b->a', 'connected'],
		['musicaEnB', 'true'],
		['musicaEnA', 'true'],
		['silencio', 'true'],
		['denuevo', 'true'],
		['repetidas', 'connected'],
		['reconectado', 'connected'],
	]);
	const medido = new Map<string, string | undefined>([
		['a->b', estados.a],
		['b->a', estados.b],
		['musicaEnB', String(Boolean(musicaEnB))],
		['musicaEnA', String(Boolean(musicaEnA))],
		['silencio', String(silenciada)],
		['denuevo', String(Boolean(pistasEnB?.music))],
		['repetidas', tras.b],
		['reconectado', reconectado],
	]);
	const ok = [...esperados].every(([clave, valor]) => medido.get(clave) === valor) && errores.length === 0;
	// Se deja todo a la vista para poder mirar la ICE y los candidatos si algo no conecta.
	(window as unknown as {__mallas: unknown}).__mallas = {a: mallaA, b: mallaB};
	const diagnostico = {a: mallaA.getDiagnostics()['bbb'], b: mallaB.getDiagnostics()['aaa']};
	window.__resultado = {
		pasos,
		errores,
		ok,
		esperados: Object.fromEntries(esperados),
		medido: Object.fromEntries(medido),
		diagnostico,
	};
	document.getElementById('root')!.textContent = ok ? 'OK' : 'FALLO';
}

void correr();
