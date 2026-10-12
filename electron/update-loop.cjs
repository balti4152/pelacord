/**
 * Repite una tarea cada `interval` ms mientras la app está abierta.
 *
 * Si la tarea falla (sin internet, rate limit), la espera se duplica hasta `maxInterval`
 * para no golpear el servidor de más; cuando vuelve a andar, el intervalo se restaura.
 * Si `shouldSkip()` da true, se saltea la ejecución pero se sigue programando.
 */
function startUpdateLoop({task, interval, maxInterval, delay = 5000, shouldSkip = () => false, log = null}) {
	let timer = null;
	let stopped = false;
	let busy = false;
	let current = interval;

	function schedule(ms) {
		if (stopped) return;
		timer = setTimeout(run, ms);
	}

	async function run() {
		if (stopped) return;
		if (busy || shouldSkip()) {
			schedule(current);
			return;
		}
		busy = true;
		try {
			if (log) log();
			await task();
			current = interval;
		} catch {
			current = Math.min(current * 2, maxInterval);
		} finally {
			busy = false;
			schedule(current);
		}
	}

	timer = setTimeout(run, delay);

	return {
		stop() {
			stopped = true;
			if (timer) clearTimeout(timer);
		},
		getInterval() {
			return current;
		},
	};
}

module.exports = {startUpdateLoop};
