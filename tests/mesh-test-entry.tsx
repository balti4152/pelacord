/**
 * Prueba de la malla de voz: dos VoiceMesh reales enfrentadas con un transporte falso.
 *
 * Verifica lo que estaba roto: que negocien (con choque de ofertas incluido), que la VOZ llegue en
 * las DOS direcciones, que los dos puedan compartir pantalla al mismo tiempo (era el caso que
 * rompía los m-lines y dejaba la llamada muda) y que una señal repetida (la malla reenvía) no
 * rompa nada.
 *
 * OJO: la música ya NO viaja por acá (cada uno la reproduce localmente, ver musicPlayer.ts), así
 * que esta prueba es de voz y pantalla.
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

/** Un video chiquito para la pantalla (no hace falta que se vea nada). */
function pantallaFalsa(): MediaStream {
	const canvas = document.createElement('canvas');
	canvas.width = 32;
	canvas.height = 32;
	return canvas.captureStream(5);
}

const transportes = hacerTransportes();
const mallaA = new VoiceMesh(() => transportes.a);
const mallaB = new VoiceMesh(() => transportes.b);

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

	// Los dos entran a la llamada y se conectan al mismo tiempo: eso provoca el CHOQUE de ofertas.
	await Promise.all([mallaA.start('aaa'), mallaB.start('bbb')]);
	await Promise.all([mallaA.connect('bbb'), mallaB.connect('aaa')]);

	const estadosFinales = async () => ({a: mallaA.getStates()['bbb'], b: mallaB.getStates()['aaa']});
	const esperarConexion = async () => {
		let estados = await estadosFinales();
		for (let intento = 0; intento < 60 && (estados.a !== 'connected' || estados.b !== 'connected'); intento++) {
			await esperar(250);
			estados = await estadosFinales();
		}
		return estados;
	};
	let estados = await esperarConexion();
	anotar(`1) conexión: a->b=${estados.a} · b->a=${estados.b}`);

	// La VOZ tiene que llegar en las dos direcciones (el micrófono falso de la prueba).
	await esperar(800);
	const audioEnB = mallaB.getRemotes().find((remote) => remote.peerId === 'aaa')?.audios.length ?? 0;
	const audioEnA = mallaA.getRemotes().find((remote) => remote.peerId === 'bbb')?.audios.length ?? 0;
	anotar(`2) voz recibida: en b=${audioEnB} pista(s) · en a=${audioEnA} pista(s)`);

	// LOS DOS comparten pantalla al mismo tiempo: es el caso que antes rompía los m-lines
	// (cada lado terminaba con 6 canales) y dejaba la llamada MUDA sin ningún error visible.
	await Promise.all([mallaA.startScreen(), mallaB.startScreen()]);
	await esperar(2500);
	const videoEnB = Boolean(mallaB.getRemotes().find((remote) => remote.peerId === 'aaa')?.video);
	const videoEnA = Boolean(mallaA.getRemotes().find((remote) => remote.peerId === 'bbb')?.video);
	const trasPantalla = await estadosFinales();
	anotar(`3) pantalla compartida por los dos: video en b=${videoEnB} · en a=${videoEnA} · conexión a->b=${trasPantalla.a}`);

	// Se corta la pantalla de los dos: la pista remota queda muteada (que es lo que mira la interfaz
	// para dejar de mostrarla) sin renegociar nada.
	await Promise.all([mallaA.stopScreen(), mallaB.stopScreen()]);
	await esperar(1500);
	const pistaVideo = mallaB.getRemotes().find((remote) => remote.peerId === 'aaa')?.video?.getVideoTracks()[0];
	const videoTrasCortar = Boolean(pistaVideo?.muted);
	anotar(`4) al cortar la pantalla: la pista remota queda muteada=${videoTrasCortar}`);

	// Ahora toda la señalización se manda REPETIDA (como cuando un tercero la reenvía).
	transportes.repetir(true);
	await Promise.all([mallaA.startScreen(), mallaB.startScreen()]);
	await esperar(2000);
	const tras = await estadosFinales();
	anotar(`5) con señales repetidas: a->b=${tras.a} · b->a=${tras.b}`);
	transportes.repetir(false);

	// Reconectar de cero (lo que hace el vigilante cuando una conexión se cae).
	//
	// ESTE ERA EL CASO QUE ROMPÍA LA LLAMADA: al rearmar UNA sola punta, su oferta traía menos
	// canales que los que el otro ya tenía (el canal de video queda aunque se deje de compartir) y
	// WebRTC la rechazaba ("The order of m-lines...") → la conexión quedaba muerta. Ahora se detecta
	// y se rearma la conexión de los DOS.
	mallaA.disconnect('bbb');
	await esperar(200);
	await mallaA.connect('bbb');
	let reconectado = mallaA.getStates()['bbb'];
	for (let intento = 0; intento < 60 && reconectado !== 'connected'; intento++) {
		await esperar(250);
		reconectado = mallaA.getStates()['bbb'];
	}
	anotar(`6) tras rearmar una sola punta: a->b=${reconectado}`);

	// Y el botón "Reconectar" (rearma las dos puntas avisándose entre ellas).
	await Promise.all([mallaA.reconnect(), mallaB.reconnect()]);
	let trasBoton = await estadosFinales();
	for (let intento = 0; intento < 60 && (trasBoton.a !== 'connected' || trasBoton.b !== 'connected'); intento++) {
		await esperar(250);
		trasBoton = await estadosFinales();
	}
	anotar(`7) tras el botón Reconectar: a->b=${trasBoton.a} · b->a=${trasBoton.b}`);

	const errores = (window.__errores as string[]) ?? [];
	const esperados = new Map<string, string | undefined>([
		['a->b', 'connected'],
		['b->a', 'connected'],
		['vozEnB', '1'],
		['vozEnA', '1'],
		['videoEnB', 'true'],
		['videoEnA', 'true'],
		['cortado', 'true'],
		['repetidas', 'connected'],
		['reconectado', 'connected'],
		['boton', 'connected'],
	]);
	const medido = new Map<string, string | undefined>([
		['a->b', estados.a],
		['b->a', estados.b],
		['vozEnB', String(audioEnB)],
		['vozEnA', String(audioEnA)],
		['videoEnB', String(videoEnB)],
		['videoEnA', String(videoEnA)],
		['cortado', String(videoTrasCortar)],
		['repetidas', tras.b],
		['reconectado', reconectado],
		['boton', trasBoton.b],
	]);
	const ok = [...esperados].every(([clave, valor]) => medido.get(clave) === valor) && errores.length === 0;
	// Se deja todo a la vista para poder mirar la ICE y los canales si algo no conecta.
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
