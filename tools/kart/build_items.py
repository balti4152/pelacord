"""Modelos de los poderes del karting y sus imágenes para el HUD.

    blender -b -P tools/kart/build_items.py -- <salida.glb> <carpeta de imágenes>

Cada poder es un objeto raíz con su nombre (Banana, Misil, Bola, Estrella, Turbo, Cometa, Caja, CajaQ,
Moneda). Las formas se modelan con poca geometría y se suavizan (Subdivision Surface) al exportar.
Las imágenes del HUD son el mismo modelo renderizado con fondo transparente.
"""
import math
import os
import sys

import bmesh
import bpy
import numpy as np
from mathutils import Matrix, Vector, noise

ARGS = sys.argv[sys.argv.index('--') + 1:]
OUT = ARGS[0]
IMG_DIR = ARGS[1]
os.makedirs(IMG_DIR, exist_ok=True)

bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene


# ------------------------------------------------------------------ materiales -----------------

def mat(name, color, rough=0.35, metal=0.0, emit=None, strength=0.0, alpha=None, coat=0.0, image=None):
    m = bpy.data.materials.get(name)
    if m:
        return m
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    nt = m.node_tree
    b = next(n for n in nt.nodes if n.type == 'BSDF_PRINCIPLED')
    b.inputs['Base Color'].default_value = (*color, 1)
    b.inputs['Roughness'].default_value = rough
    b.inputs['Metallic'].default_value = metal
    if 'Coat Weight' in b.inputs:
        b.inputs['Coat Weight'].default_value = coat
    if image is not None:
        tex = nt.nodes.new('ShaderNodeTexImage')
        tex.image = image
        nt.links.new(tex.outputs['Color'], b.inputs['Base Color'])
    if emit:
        b.inputs['Emission Color'].default_value = (*emit, 1)
        b.inputs['Emission Strength'].default_value = strength
    if alpha is not None:
        b.inputs['Alpha'].default_value = alpha
        try:
            m.surface_render_method = 'BLENDED'
        except Exception:
            pass
    return m


YELLOW = mat('BananaSkin', (1.0, 0.8, 0.08), 0.32, coat=0.3)
CREAM = mat('BananaInside', (1.0, 0.95, 0.72), 0.6)
BROWN = mat('BananaTip', (0.3, 0.18, 0.08), 0.6)
WHITE = mat('White', (1, 1, 1), 0.3)
BLACK = mat('Black', (0.02, 0.02, 0.03), 0.25)
RED = mat('MissileRed', (0.92, 0.06, 0.08), 0.25, coat=0.6)
GOLDFIN = mat('MissileFin', (1.0, 0.72, 0.05), 0.3, coat=0.4)
STEEL = mat('Steel', (0.72, 0.74, 0.8), 0.25, metal=0.4)
FLAME_O = mat('FlameOuter', (1.0, 0.16, 0.0), 0.4, emit=(1.0, 0.35, 0.02), strength=0.8)
FLAME_Y = mat('FlameInner', (1.0, 0.6, 0.05), 0.4, emit=(1.0, 0.75, 0.2), strength=1.1)
BOMB = mat('BombBody', (0.05, 0.05, 0.08), 0.15, coat=1.0)
ROPE = mat('Fuse', (0.72, 0.55, 0.32), 0.8)
SPARK = mat('Spark', (1.0, 0.85, 0.2), 0.3, emit=(1.0, 0.8, 0.2), strength=8)
STAR = mat('Star', (1.0, 0.82, 0.05), 0.2, emit=(1.0, 0.65, 0.0), strength=0.35, coat=0.6)
PEPPER = mat('Pepper', (0.9, 0.04, 0.04), 0.15, coat=1.0)
PEPPER_STEM = mat('PepperStem', (0.18, 0.6, 0.15), 0.4)
ROCK = mat('MeteorRock', (0.16, 0.11, 0.09), 0.85)
LAVA = mat('MeteorLava', (1.0, 0.12, 0.0), 0.5, emit=(1.0, 0.25, 0.02), strength=0.9)
GOLD = mat('Gold', (1.0, 0.78, 0.12), 0.22, metal=0.0, coat=1.0, emit=(1.0, 0.62, 0.05), strength=0.35)
GOLD2 = mat('GoldDeep', (1.0, 0.6, 0.05), 0.3, metal=0.0, emit=(1.0, 0.5, 0.02), strength=0.25)


def rainbow_image():
    h, w = 64, 256
    arr = np.ones((h, w, 4), dtype=np.float32)
    for x in range(w):
        hue = x / w
        r = 0.5 + 0.5 * math.cos(math.tau * (hue + 0.0))
        g = 0.5 + 0.5 * math.cos(math.tau * (hue + 0.33))
        b = 0.5 + 0.5 * math.cos(math.tau * (hue + 0.67))
        arr[:, x, :3] = (0.55 + 0.45 * r, 0.55 + 0.45 * g, 0.55 + 0.45 * b)
    img = bpy.data.images.new('rainbow', w, h, alpha=True)
    img.pixels.foreach_set(arr.ravel())
    img.pack()
    return img


BOX = mat('ItemBox', (1, 1, 1), 0.05, emit=(0.55, 0.3, 0.8), strength=0.4, alpha=0.6, image=rainbow_image())
BOXQ = mat('BoxQ', (1, 1, 1), 0.3, emit=(1, 1, 1), strength=0.8)


# ------------------------------------------------------------------ ayudas ---------------------

def make(name, bm, material, subsurf=2, smooth=True, solidify=0.0, materials=None):
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    for p in me.polygons:
        p.use_smooth = smooth
    ob = bpy.data.objects.new(name, me)
    scene.collection.objects.link(ob)
    for m in (materials or [material]):
        me.materials.append(m)
    if solidify:
        s = ob.modifiers.new('solid', 'SOLIDIFY')
        s.thickness = solidify
        s.offset = -1
        s.material_offset = 1
        s.material_offset_rim = 1
    if subsurf:
        sd = ob.modifiers.new('sub', 'SUBSURF')
        sd.levels = subsurf
        sd.render_levels = subsurf
    return ob


def tube(path, radius, sides=8, cap=True):
    """Tubo a lo largo de una lista de puntos; radius: función de t (0..1)."""
    bm = bmesh.new()
    rings = []
    n = len(path)
    for k, p in enumerate(path):
        t = k / (n - 1)
        a = path[max(0, k - 1)]
        b = path[min(n - 1, k + 1)]
        tan = (b - a).normalized()
        side = tan.cross(Vector((0, 0, 1)))
        if side.length < 1e-4:
            side = tan.cross(Vector((0, 1, 0)))
        side.normalize()
        up = side.cross(tan).normalized()
        r = radius(t)
        rings.append([bm.verts.new(p + (side * math.cos(j / sides * math.tau) + up * math.sin(j / sides * math.tau)) * r) for j in range(sides)])
    for k in range(n - 1):
        for j in range(sides):
            bm.faces.new((rings[k][j], rings[k][(j + 1) % sides], rings[k + 1][(j + 1) % sides], rings[k + 1][j]))
    if cap:
        bm.faces.new(list(reversed(rings[0])))
        bm.faces.new(rings[-1])
    return bm


def ico(radius, sub=2, loc=(0, 0, 0), scale=(1, 1, 1)):
    bm = bmesh.new()
    bmesh.ops.create_icosphere(bm, subdivisions=sub, radius=radius)
    bmesh.ops.transform(bm, verts=bm.verts, matrix=Matrix.Translation(loc) @ Matrix.Diagonal((*scale, 1)))
    return bm


def cone(r1, r2, depth, seg=16, m=Matrix.Identity(4)):
    bm = bmesh.new()
    bmesh.ops.create_cone(bm, cap_ends=True, cap_tris=False, segments=seg, radius1=r1, radius2=r2, depth=depth, matrix=m)
    return bm


def root(name, parts):
    r = bpy.data.objects.new(name, None)
    scene.collection.objects.link(r)
    for p in parts:
        p.parent = r
    return r


def text_mesh(name, body, size, material, extrude=0.04):
    bpy.ops.object.text_add()
    t = bpy.context.object
    t.data.body = body
    t.data.size = size
    t.data.extrude = extrude
    t.data.bevel_depth = 0.012
    t.data.bevel_resolution = 2
    t.data.align_x = 'CENTER'
    t.data.align_y = 'CENTER'
    try:
        t.data.font = bpy.data.fonts.load('C:/Windows/Fonts/arialbd.ttf')
    except Exception:
        pass
    t.data.materials.append(material)
    bpy.ops.object.convert(target='MESH')
    t.name = name
    return t


items = {}

# --- Banana: cáscara abierta en el piso (base parada y cuatro tiras que caen hasta el suelo) -----
parts = []
base = tube([Vector((0, 0, z)) for z in np.linspace(0.0, 0.5, 6)], lambda t: 0.13 + 0.07 * math.sin(t * math.pi * 0.85), sides=6)
parts.append(make('peel_base', base, YELLOW, subsurf=2))
top = ico(0.15, 2, loc=(0, 0, 0.5), scale=(1, 1, 0.45))
parts.append(make('peel_top', top, CREAM, subsurf=1))
for k in range(4):
    ang = k / 4 * math.tau + 0.4
    d = Vector((math.cos(ang), math.sin(ang), 0))
    side = Vector((-d.y, d.x, 0))
    bm = bmesh.new()
    rows = []
    SEG = 12
    for s_ in range(SEG + 1):
        t = s_ / SEG
        # Sale del borde de arriba, sube un poquito, se abre y cae hasta tocar el piso.
        radial = 0.14 + 0.62 * math.sin(t * math.pi / 2)
        z = 0.5 + 0.12 * math.sin(t * math.pi * 0.7) - 0.6 * t ** 1.6
        z = max(0.025, z)
        w = 0.13 * (1 - 0.65 * t) + 0.02
        c = d * radial + Vector((0, 0, z))
        rows.append([bm.verts.new(c - side * w), bm.verts.new(c), bm.verts.new(c + side * w)])
    for s_ in range(SEG):
        for j in range(2):
            f = bm.faces.new((rows[s_][j], rows[s_][j + 1], rows[s_ + 1][j + 1], rows[s_ + 1][j]))
    for f in bm.faces:
        f.normal_update()
        if f.normal.z < 0:
            f.normal_flip()
    parts.append(make('peel_flap%d' % k, bm, CREAM, subsurf=1, solidify=0.045, materials=[CREAM, YELLOW]))
    tip = ico(0.045, 1, loc=tuple(d * 0.76 + Vector((0, 0, 0.035))), scale=(1.5, 1.5, 0.6))
    parts.append(make('peel_tip%d' % k, tip, BROWN, subsurf=1))
stem = tube([Vector((0, 0, -0.02)), Vector((0.0, 0.0, -0.02))], lambda t: 0.05, sides=6)
items['Banana'] = root('Banana', parts)

# --- Misil: cuerpo rojo redondeado, punta blanca, aletas, tobera, fuego y cara de enojado -------
parts = []
body = tube([Vector((x, 0, 0)) for x in np.linspace(-0.55, 0.55, 9)], lambda t: 0.27 + 0.03 * math.sin(t * math.pi), sides=10)
parts.append(make('mis_body', body, RED, subsurf=2))
nose = tube([Vector((x, 0, 0)) for x in np.linspace(0.5, 0.98, 7)], lambda t: max(0.02, 0.29 * math.cos(t * math.pi / 2) ** 0.8), sides=10)
parts.append(make('mis_nose', nose, WHITE, subsurf=2))
for x in (-0.25, 0.25):
    band = tube([Vector((x - 0.05, 0, 0)), Vector((x + 0.05, 0, 0))], lambda t: 0.305, sides=12)
    parts.append(make('mis_band', band, WHITE, subsurf=1))
for k in range(4):
    a = k * math.pi / 2 + math.pi / 4
    bm = bmesh.new()
    pts = [(-0.62, 0.22), (-0.2, 0.22), (-0.45, 0.62), (-0.72, 0.62)]
    vs_front = [bm.verts.new((x, -0.035, y)) for x, y in pts]
    vs_back = [bm.verts.new((x, 0.035, y)) for x, y in pts]
    bm.faces.new(vs_front)
    bm.faces.new(list(reversed(vs_back)))
    for j in range(4):
        bm.faces.new((vs_front[j], vs_front[(j + 1) % 4], vs_back[(j + 1) % 4], vs_back[j]))
    bmesh.ops.bevel(bm, geom=list(bm.edges), offset=0.025, segments=2, affect='EDGES')
    bmesh.ops.rotate(bm, verts=bm.verts, cent=(0, 0, 0), matrix=Matrix.Rotation(a, 3, 'X'))
    parts.append(make('mis_fin%d' % k, bm, GOLDFIN, subsurf=0))
nozzle = tube([Vector((-0.6, 0, 0)), Vector((-0.78, 0, 0))], lambda t: 0.2 + t * 0.04, sides=12, cap=False)
parts.append(make('mis_nozzle', nozzle, STEEL, subsurf=1, solidify=0.03, materials=[STEEL, STEEL]))
fl = cone(0.21, 0.0, 0.7, seg=12, m=Matrix.Translation((-1.1, 0, 0)) @ Matrix.Rotation(-math.pi / 2, 4, 'Y'))
parts.append(make('mis_flame', fl, FLAME_O, subsurf=1))
fl2 = cone(0.12, 0.0, 0.45, seg=10, m=Matrix.Translation((-0.98, 0, 0)) @ Matrix.Rotation(-math.pi / 2, 4, 'Y'))
parts.append(make('mis_flame2', fl2, FLAME_Y, subsurf=1))
items['Misil'] = root('Misil', parts)

# --- Bomba (rueda y rebota): negra brillante, tapa de metal, mecha y chispa ---------------------
parts = []
parts.append(make('bomb_body', ico(0.45, 3), BOMB, subsurf=1))
capm = cone(0.15, 0.15, 0.14, seg=14, m=Matrix.Translation((0.0, 0, 0.47)))
parts.append(make('bomb_cap', capm, STEEL, subsurf=1))
fuse = tube([Vector((0, 0, 0.52)), Vector((0.03, 0, 0.62)), Vector((0.1, 0, 0.7)), Vector((0.2, 0, 0.73))], lambda t: 0.035, sides=6)
parts.append(make('bomb_fuse', fuse, ROPE, subsurf=1))
spark = bmesh.new()
center = Vector((0.22, 0, 0.75))
c0 = spark.verts.new(center + Vector((0, 0.03, 0)))
c1 = spark.verts.new(center - Vector((0, 0.03, 0)))
ring = []
for k in range(16):
    a = k / 16 * math.tau
    r = 0.16 if k % 2 == 0 else 0.06
    ring.append(spark.verts.new(center + Vector((math.cos(a) * r, 0, math.sin(a) * r))))
for k in range(16):
    spark.faces.new((c0, ring[k], ring[(k + 1) % 16]))
    spark.faces.new((c1, ring[(k + 1) % 16], ring[k]))
parts.append(make('bomb_spark', spark, SPARK, subsurf=0, smooth=False))
shine = ico(0.1, 2, loc=(-0.18, -0.25, 0.25), scale=(1, 0.5, 0.7))
parts.append(make('bomb_shine', shine, mat('BombShine', (1, 1, 1), 0.2, emit=(1, 1, 1), strength=0.4), subsurf=1))
items['Bola'] = root('Bola', parts)

# --- Estrella: inflada (pirámides de 5 puntas suavizadas), con ojitos ---------------------------
bm = bmesh.new()
outer, inner, depth = 0.62, 0.3, 0.26
f_c = bm.verts.new((0, -depth, 0))
b_c = bm.verts.new((0, depth, 0))
ring = []
for k in range(10):
    a = math.pi / 2 + k * math.pi / 5
    r = outer if k % 2 == 0 else inner
    ring.append(bm.verts.new((math.cos(a) * r, 0, math.sin(a) * r)))
for k in range(10):
    bm.faces.new((f_c, ring[(k + 1) % 10], ring[k]))
    bm.faces.new((b_c, ring[k], ring[(k + 1) % 10]))
star = make('star_body', bm, STAR, subsurf=2)
# Las puntas quedan marcadas (crease) y el centro bien inflado.
parts = [star]
for s in (-1, 1):
    eye = ico(0.05, 2, loc=(s * 0.1, -0.2, 0.06), scale=(0.8, 0.5, 1.8))
    parts.append(make('star_eye', eye, BLACK, subsurf=1))
items['Estrella'] = root('Estrella', parts)

# --- Turbo: ají picante (rojo brillante, curvo, con tallo verde) --------------------------------
path = []
for k in range(10):
    t = k / 9
    path.append(Vector((0.55 - t * 1.05, 0, math.sin(t * math.pi * 0.9) * 0.18 - t * 0.12)))
body = tube(path, lambda t: max(0.025, 0.2 * (1 - t) ** 0.7 + 0.02 * math.sin(t * 9) * (1 - t)), sides=8)
parts = [make('pepper_body', body, PEPPER, subsurf=2)]
capb = ico(0.16, 2, loc=(0.58, 0, 0.0), scale=(0.6, 1.3, 1.3))
parts.append(make('pepper_cap', capb, PEPPER_STEM, subsurf=1))
stem = tube([Vector((0.62, 0, 0)), Vector((0.75, 0, 0.05)), Vector((0.82, 0, 0.17))], lambda t: 0.04, sides=6)
parts.append(make('pepper_stem', stem, PEPPER_STEM, subsurf=1))
shine = ico(0.05, 2, loc=(0.32, -0.14, 0.12), scale=(2.4, 0.5, 0.6))
parts.append(make('pepper_shine', shine, mat('PepperShine', (1, 1, 1), 0.2, emit=(1, 1, 1), strength=0.3), subsurf=1))
items['Turbo'] = root('Turbo', parts)

# --- Cometa (busca al primero): meteorito de roca con lava y cola de fuego ----------------------
bm = ico(0.5, 3)
for v in bm.verts:
    n = noise.noise(v.co * 3.2) * 0.12 + noise.noise(v.co * 7) * 0.04
    v.co *= 1 + n
lava_faces = []
for f in bm.faces:
    c = f.calc_center_median()
    if noise.noise(c * 4.5 + Vector((3, 1, 2))) > 0.22:
        f.material_index = 1
parts = [make('meteor_rock', bm, ROCK, subsurf=1, materials=[ROCK, LAVA])]
FLAME_R = mat('FlameRed', (0.85, 0.03, 0.0), 0.5, emit=(1.0, 0.12, 0.0), strength=0.8)
for k in range(7):
    a_ = k / 7 * math.tau
    off = Vector((0, math.cos(a_) * 0.22, math.sin(a_) * 0.22))
    ln = 0.9 + (k % 3) * 0.35
    m_ = [FLAME_R, FLAME_O, FLAME_O][k % 3]
    tail = tube([Vector((-0.3, 0, 0)) + off * 0.6, Vector((-0.3 - ln * 0.5, 0, 0)) + off * 1.1, Vector((-0.3 - ln, 0, 0)) + off * 0.5], lambda t: 0.2 * (1 - t) + 0.01, sides=7)
    parts.append(make('meteor_flame%d' % k, tail, m_, subsurf=1))
core = tube([Vector((-0.3, 0, 0)), Vector((-0.75, 0, 0)), Vector((-1.15, 0, 0))], lambda t: 0.26 * (1 - t) + 0.01, sides=8)
parts.append(make('meteor_core', core, FLAME_Y, subsurf=1))
items['Cometa'] = root('Cometa', parts)

# --- Caja de poderes: cubo redondeado de vidrio arcoíris; el "?" va aparte (mira a la cámara) ---
bm = bmesh.new()
bmesh.ops.create_cube(bm, size=1.0)
bmesh.ops.bevel(bm, geom=list(bm.edges), offset=0.16, segments=4, affect='EDGES')
uv = bm.loops.layers.uv.new()
for f in bm.faces:
    for loop in f.loops:
        co = loop.vert.co
        loop[uv].uv = ((co.x + co.y + co.z) / 3 + 0.5, 0.5)
items['Caja'] = root('Caja', [make('box_shell', bm, BOX, subsurf=0)])
q = text_mesh('box_q', '?', 0.75, BOXQ, extrude=0.07)
q.rotation_euler = (math.pi / 2, 0, 0)
items['CajaQ'] = root('CajaQ', [q])

# --- Moneda: dorada, con borde y una "P" en relieve de los dos lados --------------------------
bm = cone(0.42, 0.42, 0.1, seg=40, m=Matrix.Rotation(math.pi / 2, 4, 'X'))
bmesh.ops.bevel(bm, geom=[e for e in bm.edges if not e.is_boundary], offset=0.02, segments=2, affect='EDGES')
parts = [make('coin_body', bm, GOLD, subsurf=0)]
rim = bmesh.new()
bmesh.ops.create_cone(rim, cap_ends=False, segments=40, radius1=0.36, radius2=0.36, depth=0.13, matrix=Matrix.Rotation(math.pi / 2, 4, 'X'))
parts.append(make('coin_rim', rim, GOLD2, subsurf=0, solidify=0.03, materials=[GOLD2, GOLD2]))
for s in (-1, 1):
    p = text_mesh('coin_p', 'P', 0.5, GOLD2, extrude=0.025)
    p.rotation_euler = (math.pi / 2, 0, 0 if s < 0 else math.pi)
    p.location = (0, s * 0.06, -0.01)
    parts.append(p)
items['Moneda'] = root('Moneda', parts)

# Separados en fila para exportar y sacar las fotos.
names = list(items)
for k, name in enumerate(names):
    items[name].location = (k * 3.0, 0, 0)
items['CajaQ'].location = items['Caja'].location

bpy.ops.object.select_all(action='SELECT')
bpy.ops.export_scene.gltf(filepath=OUT, export_format='GLB', export_apply=True, export_yup=True, export_cameras=False, export_lights=False)
print('EXPORTED', OUT, os.path.getsize(OUT))

# ------------------------------------------------------------------ fotos del HUD --------------
scene.render.film_transparent = True
scene.view_settings.view_transform = 'Standard'
for engine in ('BLENDER_EEVEE', 'BLENDER_EEVEE_NEXT'):
    try:
        scene.render.engine = engine
        break
    except TypeError:
        continue
scene.render.resolution_x = 320
scene.render.resolution_y = 320
world = bpy.data.worlds.new('w')
world.use_nodes = True
world.node_tree.nodes['Background'].inputs['Color'].default_value = (0.75, 0.82, 1, 1)
world.node_tree.nodes['Background'].inputs['Strength'].default_value = 0.7
scene.world = world
key = bpy.data.objects.new('key', bpy.data.lights.new('key', 'SUN'))
key.data.energy = 3.2
key.rotation_euler = (math.radians(45), 0, math.radians(-35))
scene.collection.objects.link(key)
rim_l = bpy.data.objects.new('rim', bpy.data.lights.new('rim', 'SUN'))
rim_l.data.energy = 2.0
rim_l.rotation_euler = (math.radians(-60), 0, math.radians(160))
scene.collection.objects.link(rim_l)
cam = bpy.data.objects.new('cam', bpy.data.cameras.new('cam'))
cam.data.type = 'ORTHO'
scene.collection.objects.link(cam)
scene.camera = cam
VIEW = {
    'Banana': ((0.0, -2.2, 1.6), 0.25, 1.9),
    'Misil': ((0.6, -2.4, 1.0), 0.0, 2.3),
    'Bola': ((0.6, -2.4, 0.9), 0.15, 1.8),
    'Estrella': ((0.3, -2.6, 0.4), 0.0, 1.55),
    'Turbo': ((0.5, -2.4, 0.9), 0.0, 1.7),
    'Cometa': ((0.9, -2.4, 0.8), 0.0, 2.4),
    'Caja': ((1.3, -2.2, 1.2), 0.0, 1.7),
    'Moneda': ((0.6, -2.4, 0.4), 0.0, 1.1),
}
for name, (offset, lift, scale) in VIEW.items():
    ob = items[name]
    for other_name, other in items.items():
        hide = other is not ob and not (name == 'Caja' and other_name == 'CajaQ')
        for c in [other, *other.children]:
            c.hide_render = hide
    cx = ob.location.x
    cam.location = (cx + offset[0], offset[1], offset[2] + lift)
    cam.rotation_euler = (Vector((cx, 0, lift)) - Vector(cam.location)).to_track_quat('-Z', 'Y').to_euler()
    cam.data.ortho_scale = scale
    scene.render.filepath = os.path.join(IMG_DIR, name.lower() + '.png')
    bpy.ops.render.render(write_still=True)
print('IMAGES OK')
