// Genera los íconos de la app a partir de logo/logo.png:
//   build/icon.ico            (Windows: multi-tamaño, para el exe y el instalador)
//   build/icons/<n>x<n>.png   (Linux / macOS / uso general)
//   src/assets/logo.png       (el que usa la interfaz)
//
// Uso:  node scripts/make-icons.mjs
//       (si ffmpeg no está en el PATH: FFMPEG=C:\ruta\ffmpeg.exe node scripts/make-icons.mjs)
import {execFileSync} from 'node:child_process';
import {copyFileSync, existsSync, mkdirSync, readFileSync, rmSync} from 'node:fs';
import {dirname, join} from 'node:path';
import {fileURLToPath} from 'node:url';
import pngToIco from 'png-to-ico';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const source = join(root, 'logo', 'logo.png');
const buildDir = join(root, 'build');
const iconsDir = join(buildDir, 'icons');
const ffmpeg = process.env.FFMPEG || 'ffmpeg';

/** Tamaños que necesita Windows (para el .ico) y el resto de las plataformas. */
const ICO_SIZES = [16, 24, 32, 48, 64, 128, 256];
const PNG_SIZES = [16, 24, 32, 48, 64, 128, 256, 512];

if (!existsSync(source)) {
	console.error(`No encuentro ${source}`);
	process.exit(1);
}

mkdirSync(iconsDir, {recursive: true});

/** Escala el logo a un tamaño cuadrado. */
function resize(size) {
	const target = join(iconsDir, `${size}x${size}.png`);
	execFileSync(ffmpeg, ['-y', '-hide_banner', '-loglevel', 'error', '-i', source, '-vf', `scale=${size}:${size}`, target]);
	return target;
}

const generated = new Map();
for (const size of PNG_SIZES) {
	generated.set(size, resize(size));
	console.log(`✓ ${size}x${size}.png`);
}

// .ico multi-tamaño (Windows elige el mejor según el contexto: escritorio, barra, alt-tab).
const icoPath = join(buildDir, 'icon.ico');
const icoBuffer = await pngToIco(ICO_SIZES.map((size) => generated.get(size)));
(await import('node:fs')).writeFileSync(icoPath, icoBuffer);
console.log(`✓ icon.ico (${ICO_SIZES.join(', ')})`);

// El logo que usa la interfaz: 128px alcanza y sobra.
copyFileSync(generated.get(128), join(root, 'src', 'assets', 'logo.png'));
console.log('✓ src/assets/logo.png');

// Limpieza: los PNG intermedios de 16/24/32 no hacen falta sueltos, pero se dejan
// para Linux/macOS, que sí los usan.
const keep = readFileSync(icoPath).length;
rmSync(join(buildDir, 'icon.ico.tmp'), {force: true});
console.log(`\nListo. icon.ico = ${(keep / 1024).toFixed(1)} KB`);
