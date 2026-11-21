# PelaCord 3D — estilo, assets y cómo continuar

## Dirección de arte (resumen)

**Toy-like Stylized Low-Poly** (vinilo / plastilina mate; referencia: Gang Beasts, Human: Fall Flat, Overcooked).

- Colores sólidos o degradados suaves. Nada de texturas fotorrealistas.
- Materiales: `roughness 0.8–0.9`, `metallic 0.0` (piel, ropa, muebles).
- Siluetas gorditas: todo con bevel + sombreado suave, ningún borde filoso. Pocos polígonos.
- Avatar chibi: cabeza ovalada fusionada al torso (sin cuello), ojitos negros juntos, nariz botón,
  cejas de rayita, boca chica (se abre al hablar), orejas semicírculo, manos mitón con pulgar,
  zapatillas redondeadas, pelo como pieza maciza esculpida.
- Fondos oscuros saturados (violeta noche, azul medianoche, bordó) + acentos vibrantes
  (violeta pastel, mostaza, coral, celeste, rojo butaca). Luces puntuales cálidas, sombras suaves,
  estrellitas sutiles de noche.
- UI dentro del mundo: anillo blanco fino sobre asientos libres, placa-píldora con foto + nombre
  sobre la cabeza (ondas de color al hablar), viñetas de cómic 2D (`SLAP!`) al interactuar.

## Qué hay hecho

Todo se genera con código (Blender 5.2, sin abrir la interfaz):

```
"C:\Program Files\Blender Foundation\Blender 5.2\blender.exe" -b --python scripts/blender/build_all.py -- --preview
```

| Archivo | Qué es |
|---|---|
| `scripts/blender/toy.py` | Paleta, material mate, formas redondeadas, asientos, exportar GLB, vista previa |
| `scripts/blender/avatar.py` | Avatar + esqueleto rígido + animaciones |
| `scripts/blender/costumes.py` | Cono de tránsito, gorro de rana, sombrero pirata, traje de pancho |
| `scripts/blender/sets.py` | Living, cine, fogata y piezas de UI (`-- living cinema campfire ui --preview`) |
| `scripts/blender/wardrobe.py` | **Avatar modular**: cuerpo hombre/mujer + peinados, caras y ropa intercambiables |
| `scripts/blender/furniture.py` | 16 muebles comprables (`public/models/furniture/*.glb`) |
| `scripts/blender/shop.py` | La **tienda** estilo Club Penguin (`room_shop.glb`) |
| `scripts/blender/catalog.py` | Une todo en `public/catalog.json` (sin Blender: `python scripts/blender/catalog.py`) |
| `scripts/blender/preview_*.py` | Renders de control en `art/previews/` |
| `public/models/*.glb` | Lo que carga la app |
| `public/sprites/*.svg` | Viñetas (`slap`, `pow`, `bonk`, `jaja`) y pósters del cine |
| `art/previews/` | Renders de control (`sheet_avatar.png`, `costumes.png`, `sheet_rooms.png`, `room_shop.png`, `shop_showcase.png`) |
| `public/catalog.json` | Catálogo de la tienda: 46 artículos, precios en Pelamonedas, paletas y looks de ejemplo |

Los scripts corren igual **en segundo plano** (`build_all.py`) que **en el Blender abierto vía MCP**
(`execute_blender_code` → `import wardrobe; wardrobe.build_look('sofi')`, y `look` para revisar).

### Convenciones de los GLB (para Three.js)

- **Ejes**: Blender Z-arriba / -Y adelante → glTF Y-arriba / **+Z adelante**. El avatar mira a +Z.
- **`avatar.glb`**: un `SkinnedMesh` (`AvatarBody`) + esqueleto (`root, hips, spine, head, mouth,
  eye_L, eye_R, arm_L, arm_R, leg_L, leg_R`). Altura ≈ 1,2 m.
  - Materiales para recolorear por usuario: `Skin, Shirt, Pants, Shoes, Sole, Hair` (`Ink` = ojos/boca/cejas).
  - Animaciones: `Idle` (loop), `Walk` (loop), `Sit` (pose), `Talk` (loop, sólo boca/cabeza → se
    suma encima de Idle/Sit), `Blink` (sólo ojos → disparar cada 3–6 s), `Wave`, `Slap`.
- **`avatar_modular.glb`** (el que va a usar la app): mismo esqueleto y mismas 7 animaciones, pero
  cada pieza es su propia `SkinnedMesh`. La app muestra sólo las elegidas (`mesh.visible`).
  - Extras por malla: `pelacord_slot` (`body, hair, eyes, brows, mouth, cheeks, top, bottom, shoes`),
    `pelacord_body` (`M`, `F` o `any`), `pelacord_item` (id del catálogo), `pelacord_hides` (`bottom` en el vestido).
  - Cuerpos `Body_M` / `Body_F` (hombros/cadera distintos). Las prendas que siguen la forma del
    torso vienen en dos versiones: `Top_Tee_M` / `Top_Tee_F`, etc. → mostrar la del cuerpo elegido.
  - Peinados: Flequillo, Pinchos, Largo, Colita, Dos rodetes, Rulos. Ojos: Ojitos, Pestañas, Felices,
    Grandes. Cejas: finas, gruesas, arqueadas. Boca: tranqui, sonrisa, sonrisota. Cachetes rosados.
    Arriba: remera, musculosa, buzo con capucha, vestido. Abajo: pantalón, bermuda, pollera. Zapatillas, botas.
  - **Colores**: recolorear los materiales `Skin, Hair, Top, Bottom, Shoes, Sole` (clonar el material
    por avatar). El catálogo trae paletas listas: 16 colores de pelo (naturales y de fantasía),
    9 tonos de piel y 14 de ropa.
- **`furniture/*.glb`**: origen en el piso, mira a +Z. Material `Base`/`BaseLight` recoloreable
  (`defaultColor` en el catálogo). Asientos marcados (`Seat_*`) en sillones, pufs y cama.
- **`room_shop.glb`**: hotspots (extra `pelacord_hotspot`): `Shop_Clothes` (catálogo de ropa),
  `Shop_Furniture` (muebles), `Shop_Counter` (caja/monedas), `Fitting_Room` (editor con espejo),
  `Shopkeeper` (dónde va el vendedor) y `Spawn`. Entrando: ropa a la derecha, muebles a la izquierda.
- **`costume_*.glb`**: modelados en el espacio del avatar en reposo, origen en sus pies. Extra
  `pelacord_attach` = `head` o `spine`. Uso: poner el disfraz en el origen del avatar (en reposo) y
  `bone.attach(costume)` (attach conserva la posición del mundo).
- **`room_*.glb`**:
  - `Seat_*` (extra `pelacord_seat: true`): origen = superficie del asiento, mira a +Z como el
    avatar → copiar posición/rotación del mundo al avatar y reproducir `Sit`.
  - `Screen` con material `ScreenMat`: reemplazar el mapa por un `VideoTexture` (Pelaflix / pantalla compartida).
  - `Spawn`: dónde aparece la gente.
  - Luces `KHR_lights_punctual` (lámparas, apliques, fogata). Three las importa; ajustar intensidad
    (`light.intensity *= ~0.05` suele hacer falta por la conversión de vatios) y `castShadow` en una o dos.
  - `room_campfire.glb` trae la animación `Flicker` (la llama).
- **`ui_props.glb`**: `SeatReticle` (anillo blanco) y `NameplatePill` (fondo de la placa del nombre).

## MCP de Blender (instalado)

- Addon: `%APPDATA%\Blender Foundation\Blender\5.2\scripts\addons\blender_mcp_addon.py` (activado y guardado).
  Arranca solo su servidor en `localhost:9876` al abrir Blender (panel lateral **N → MCP for Blender**).
  Telemetría apagada por defecto.
- Claude Code: servidor `blender` en `~/.claude.json` → `uvx blender-mcp` (paquete `blender-mcp 2.0.0`).
  Respaldo de la config previa: `~/.claude.json.bak-before-blender-mcp`.
- Para usarlo: **abrir Blender con interfaz** y empezar una **sesión nueva** de Claude Code (las
  herramientas `mcp__blender__*` aparecen al iniciar la sesión).

## Pendiente (siguiente etapa)

0. **Editor de personaje + tienda** (ya están los modelos y `public/catalog.json`): pantalla "Mi
   personaje" (cuerpo, peinado, cara, ropa y colores con las paletas), inventario por usuario
   (lo comprado), Pelamonedas (arranca con 500) y la tienda 3D: clic en un hotspot → panel del
   catálogo con vista previa del avatar puesto. El look y el inventario viajan en la presencia P2P.
1. **Integrar en la app**: agregar `three` (versión fija) y una vista "Sala 3D" (`src/components/World3D.tsx`):
   cargar sala + avatares con `GLTFLoader`, `SkeletonUtils.clone` por persona, recolorear materiales
   con el color de perfil, `AnimationMixer` (Idle/Walk/Sit + Talk encima mientras `voiceMesh` dice
   que habla), cámara orbital suave, clic en un `Seat_*` → caminar y sentarse.
2. **Sincronizar por la malla P2P** (como la Jam): posición, asiento, disfraz y gestos de cada uno
   en la presencia o en un canal `world` propio; el `Slap` manda un evento y todos muestran la viñeta.
3. **UI diegética**: anillos sobre asientos libres, placa con avatar + nombre (CSS2DRenderer o
   sprite), ondas de color al hablar, viñeta `slap.svg` que salta y se desvanece.
4. **Pantalla**: `VideoTexture` con la sala de Pelaflix o la pantalla compartida de la llamada.
5. **Más contenido**: peinados alternativos, más disfraces, gestos (aplaudir, bailar), pósters en
   las paredes del cine (`public/sprites/poster_*.svg` como texturas).

---

## Prompt para continuar con otra IA

> Copiá esto tal cual en una sesión nueva (Claude Code, Codex, etc.) abierta en la carpeta `pelacord`.

```
Estás en el repo de PelaCord (app tipo Discord P2P sobre ZeroTier; React 18 + Vite + Electron 44;
la voz es WebRTC en src/lib/media.ts y la presencia/música viajan por la malla en electron/main.cjs
y src/state/store.tsx). Vamos a sumar una "Sala 3D" social estilo juguete de vinilo/plastilina
(Gang Beasts / Human Fall Flat / Overcooked).

LEÉ PRIMERO docs/estilo-3d.md: tiene la dirección de arte, las convenciones de los GLB y lo pendiente.
Los modelos ya están hechos por código en scripts/blender/*.py y exportados a public/models/*.glb
(avatar modular hombre/mujer con peinados, caras y ropa intercambiables y 7 animaciones, 4 disfraces,
16 muebles, living, cine, fogata, tienda estilo Club Penguin, UI) y el catálogo está en public/catalog.json.
Las viñetas y pósters 2D están en public/sprites/*.svg. Las vistas previas están en art/previews/.

Reglas:
- Para cambiar modelos, EDITÁ los scripts y regenerá con:
  "C:\Program Files\Blender Foundation\Blender 5.2\blender.exe" -b --python scripts/blender/build_all.py -- --preview
  y revisá los PNG de art/previews antes de dar algo por terminado. No edites los .glb a mano.
  Con el MCP de Blender conectado (Blender abierto), corré los mismos scripts en vivo con
  execute_blender_code (sys.path + import wardrobe/shop/furniture) y revisá con `look`; lo
  definitivo siempre queda en los scripts.
- Respetá el estilo: roughness 0.8-0.9, metallic 0, colores planos, todo redondeado, pocos polígonos.
- Convención de ejes: el avatar y los Seat_* miran a +Z en glTF.
- Hay otra persona editando el repo en paralelo: antes de editar un archivo, leelo de nuevo; no
  reviertas cambios que no son tuyos. No hagas commit sin que te lo pidan.
- Verificá siempre con: npx tsc --noEmit, npm test, npx vite build, y si tocás la malla o la voz,
  node tests/desktop-integration.test.cjs (con `npx vite --port 5175` corriendo).

Siguiente tarea: la sección "Pendiente" de docs/estilo-3d.md, empezando por el punto 0 (editor de
personaje con avatar_modular.glb + catalog.json) y el 1 (vista
World3D con three.js fijado a una versión exacta, cargando room_living.glb y avatar.glb, con los
avatares de la gente del canal de voz sentándose en los Seat_*), y después el punto 2 (sincronizar
posición/asiento/disfraz/gestos por la malla, igual que hace la Jam).
```
