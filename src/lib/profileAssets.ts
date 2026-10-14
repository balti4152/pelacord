import type {Member} from '@/types';

/** Los assets del perfil que se sirven por P2P. */
const ASSETS = [
	{kind: 'avatar', campo: 'avatarUrl', flag: 'avatarP2P'},
	{kind: 'banner', campo: 'bannerUrl', flag: 'bannerP2P'},
	{kind: 'particle', campo: 'customParticle', flag: 'customParticleP2P'},
	{kind: 'deco', campo: 'customDeco', flag: 'customDecoP2P'},
] as const;

/**
 * Deja los assets del perfil apuntando al servidor de archivos P2P.
 *
 * Por qué hace falta: si el avatar o el banner quedaron guardados como `data:` o `blob:` (pasa en
 * perfiles viejos, o si se eligieron cuando el servidor de archivos todavía no estaba listo), el
 * dueño los VE (son locales) pero los DEMÁS no los pueden bajar: el `blob:` sólo existe en su
 * máquina, y un `data:` gigante no viaja bien en la presencia (llega cortado o no llega). El
 * síntoma es justo "a un amigo no le aparece mi foto y a otro sí" (el que la ve es porque tiene una
 * copia guardada). Como el archivo ya está en disco y el servidor lo sirve (`/file/avatar`), acá se
 * pasa a la URL P2P.
 *
 * OJO: sólo se migra lo que es `data:` o `blob:`. Los ids de las partículas incluidas (por ejemplo
 * `star`) NO se tocan, y las URLs `http:` tampoco (esas ya son P2P).
 */
export function migrateProfileAssets(me: Member, base: string): Partial<Member> {
	const patch: Partial<Member> = {};
	const urlP2P = (kind: string) => `${base}/file/${kind}`;
	for (const asset of ASSETS) {
		const url = me[asset.campo] as string | undefined;
		if (!url) continue;
		if (me[asset.flag]) {
			// Ya es P2P: se reconstruye la URL con el host:puerto de ahora (cambian al reiniciar).
			const actual = urlP2P(asset.kind);
			if (url !== actual) (patch as Record<string, unknown>)[asset.campo] = actual;
			continue;
		}
		if (/^(data|blob):/i.test(url)) {
			// Un data:/blob: no lo puede bajar NADIE: se pasa a la URL P2P (el archivo ya está en disco).
			(patch as Record<string, unknown>)[asset.campo] = urlP2P(asset.kind);
			(patch as Record<string, unknown>)[asset.flag] = true;
			continue;
		}
		if (/\/file\//.test(url)) {
			// Es una URL nuestra: se reconstruye con el host:puerto de ahora (cambian al reiniciar) y,
			// si faltaba la marca de P2P, se agrega.
			const actual = urlP2P(asset.kind);
			if (url !== actual) (patch as Record<string, unknown>)[asset.campo] = actual;
			if (!me[asset.flag]) (patch as Record<string, unknown>)[asset.flag] = true;
		}
	}
	return patch;
}
