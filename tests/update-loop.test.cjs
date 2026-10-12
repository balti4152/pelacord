// Pruebas del bucle de chequeo de actualizaciones (se corren con Node, sin Electron):
//   node tests/update-loop.test.cjs
const assert = require('node:assert');
const {startUpdateLoop} = require('../electron/update-loop.cjs');

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function testRunsRepeatedly() {
	let calls = 0;
	const loop = startUpdateLoop({task: async () => void (calls += 1), interval: 40, maxInterval: 1000, delay: 0});
	await sleep(215);
	loop.stop();
	assert.ok(calls >= 4 && calls <= 7, `esperaba ~5 llamadas, hubo ${calls}`);
	console.log(`OK  chequea seguido: ${calls} veces en 215ms (intervalo 40ms)`);
}

async function testBacksOffOnFailure() {
	let calls = 0;
	const loop = startUpdateLoop({
		task: async () => {
			calls += 1;
			throw new Error('sin internet');
		},
		interval: 30,
		maxInterval: 120,
		delay: 0,
	});
	await sleep(205);
	const interval = loop.getInterval();
	loop.stop();
	assert.ok(calls <= 4, `con backoff no debería insistir tanto, llamó ${calls}`);
	assert.strictEqual(interval, 120, `el intervalo debería topar en 120ms, fue ${interval}`);
	console.log(`OK  backoff al fallar: ${calls} llamadas, intervalo tope ${interval}ms`);
}

async function testRecoversAfterFailure() {
	let calls = 0;
	let failing = true;
	const loop = startUpdateLoop({
		task: async () => {
			calls += 1;
			if (failing) throw new Error('x');
		},
		interval: 30,
		maxInterval: 1000,
		delay: 0,
	});
	await sleep(85);
	failing = false;
	// Con el backoff ya en 120ms, hay que esperar a que pase el próximo intento (y uno más)
	// para ver el intervalo restaurado.
	await sleep(200);
	const interval = loop.getInterval();
	loop.stop();
	assert.strictEqual(interval, 30, `al andar de nuevo el intervalo vuelve a 30ms, fue ${interval}`);
	console.log(`OK  se recupera solo: intervalo de vuelta en ${interval}ms`);
}

async function testSkipAndStop() {
	let calls = 0;
	let skip = true;
	const loop = startUpdateLoop({
		task: async () => void (calls += 1),
		interval: 20,
		maxInterval: 100,
		delay: 0,
		shouldSkip: () => skip,
	});
	await sleep(80);
	assert.strictEqual(calls, 0, 'con shouldSkip no debería ejecutar');
	skip = false;
	await sleep(60);
	assert.ok(calls >= 1, 'al dejar de saltear debería ejecutar');
	loop.stop();
	const after = calls;
	await sleep(80);
	assert.strictEqual(calls, after, 'después de stop() no debe ejecutar más');
	console.log(`OK  saltea mientras descarga y frena al cerrar (${after} llamadas)`);
}

(async () => {
	await testRunsRepeatedly();
	await testBacksOffOnFailure();
	await testRecoversAfterFailure();
	await testSkipAndStop();
	console.log('\nTodo OK');
})().catch((error) => {
	console.error('FALLÓ:', error.message);
	process.exit(1);
});
