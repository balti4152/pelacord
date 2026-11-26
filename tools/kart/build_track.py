"""Arma una pista del karting en Blender y la exporta a GLB.

    blender -b -P tools/kart/build_track.py -- <id> <salida.glb> [preview.png]

Lee el recorrido de src/world/kart/tracks.json (el mismo que usa el juego), así que el asfalto, los
cordones y las flechas de turbo quedan exactamente donde el juego los espera.
Coordenadas: el juego usa Y arriba (x, y, z); Blender usa Z arriba: (x, -z, y).
"""
import json
import math
import os
import random
import sys

import bmesh
import bpy
import numpy as np
from mathutils import Matrix, Vector, kdtree, noise

ARGS = sys.argv[sys.argv.index('--') + 1:]
TRACK_ID = ARGS[0]
OUT = ARGS[1]
PREVIEW = ARGS[2] if len(ARGS) > 2 else None
HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, '..', '..'))
TEX = os.path.join(HERE, 'textures')

DATA = next(t for t in json.load(open(os.path.join(ROOT, 'src', 'world', 'kart', 'tracks.json'), encoding='utf-8')) if t['id'] == TRACK_ID)
THEME = DATA['theme']
H = DATA['half']
OFF = DATA['offroad']
P = [Vector((x, -z, y)) for x, y, z in DATA['pts']]
N = len(P)
random.seed(sum(map(ord, TRACK_ID)))
STEP = 2

# Dirección y normal (a la izquierda, igual que el "side" del juego) de cada punto.
T = []
for i in range(N):
    t = P[(i + 1) % N] - P[(i - 1) % N]
    t.z = 0
    T.append(t.normalized())
L = [Vector((-t.y, t.x, 0)) for t in T]
# Curvatura con signo (positiva = dobla a la izquierda), suavizada.
K = []
for i in range(N):
    a, b = T[(i - 3) % N], T[(i + 3) % N]
    K.append((a.x * b.y - a.y * b.x) / 6)
K = [sum(K[(i + k) % N] for k in range(-4, 5)) / 9 for i in range(N)]

THEMES = {
    'candy': {'ground': 'grass.jpg', 'tint': (1, 1, 1), 'curb': ((0.95, 0.18, 0.45), (1, 1, 1)), 'rail': ((1.0, 0.42, 0.7), (1, 1, 1)), 'sky': (0.55, 0.78, 1.0), 'sun': (1, 0.96, 0.9)},
    'beach': {'ground': 'sand.jpg', 'tint': (1, 1, 1), 'curb': ((1.0, 0.82, 0.15), (0.15, 0.55, 1.0)), 'rail': ((0.1, 0.6, 1.0), (1, 1, 1)), 'sky': (0.5, 0.8, 1.0), 'sun': (1, 0.95, 0.85)},
    'snow': {'ground': 'snow.jpg', 'tint': (1, 1, 1), 'curb': ((0.9, 0.12, 0.15), (1, 1, 1)), 'rail': ((0.2, 0.55, 1.0), (1, 1, 1)), 'sky': (0.62, 0.78, 0.95), 'sun': (1, 0.97, 0.93)},
}[THEME]

bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene


# ------------------------------------------------------------------ materiales -----------------

def image_from_array(name, arr):
    h, w, _ = arr.shape
    img = bpy.data.images.new(name, w, h, alpha=True)
    rgba = np.ones((h, w, 4), dtype=np.float32)
    rgba[:, :, :arr.shape[2]] = arr
    img.pixels.foreach_set(rgba.ravel())
    img.file_format = 'PNG'
    img.pack()
    return img


def load_image(file):
    img = bpy.data.images.load(os.path.join(TEX, file))
    img.pack()
    return img


MATS = {}


def material(name, color=(1, 1, 1), rough=0.6, image=None, normal=None, emit=None, emit_strength=1.0, metal=0.0, alpha=None):
    if name in MATS:
        return MATS[name]
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    nt = m.node_tree
    bsdf = next(n for n in nt.nodes if n.type == 'BSDF_PRINCIPLED')
    bsdf.inputs['Base Color'].default_value = (*color, 1)
    bsdf.inputs['Roughness'].default_value = rough
    bsdf.inputs['Metallic'].default_value = metal
    if image is not None:
        tex = nt.nodes.new('ShaderNodeTexImage')
        tex.image = image
        nt.links.new(tex.outputs['Color'], bsdf.inputs['Base Color'])
    if normal is not None:
        ntex = nt.nodes.new('ShaderNodeTexImage')
        ntex.image = normal
        ntex.image.colorspace_settings.name = 'Non-Color'
        nmap = nt.nodes.new('ShaderNodeNormalMap')
        nmap.inputs['Strength'].default_value = 0.6
        nt.links.new(ntex.outputs['Color'], nmap.inputs['Color'])
        nt.links.new(nmap.outputs['Normal'], bsdf.inputs['Normal'])
    if emit is not None:
        bsdf.inputs['Emission Color'].default_value = (*emit, 1)
        bsdf.inputs['Emission Strength'].default_value = emit_strength
        if image is not None:
            nt.links.new(tex.outputs['Color'], bsdf.inputs['Emission Color'])
    if alpha is not None:
        bsdf.inputs['Alpha'].default_value = alpha
    MATS[name] = m
    return m


def stripes(a, b, w=8, h=64, vertical=True):
    arr = np.zeros((h, w, 3), dtype=np.float32)
    for y in range(h):
        arr[y, :, :] = a if (y // (h // 2)) % 2 == 0 else b
    return arr


def checker(cols, rows, a=(0.08, 0.08, 0.1), b=(1, 1, 1), px=32):
    arr = np.zeros((rows * px, cols * px, 3), dtype=np.float32)
    for r in range(rows):
        for c in range(cols):
            arr[r * px:(r + 1) * px, c * px:(c + 1) * px] = a if (r + c) % 2 == 0 else b
    return arr


def chevrons(bg, fg, size=128):
    # Dos flechas "^" apuntando hacia +v (para adelante en la pista).
    arr = np.zeros((size, size, 3), dtype=np.float32)
    arr[:, :] = bg
    for y in range(size):
        for x in range(size):
            u = x / size
            v = y / size
            for base in (0.1, 0.52):
                dv = v - base - (0.5 - abs(u - 0.5)) * 0.75
                if 0 <= dv < 0.16 and 0.08 < u < 0.92:
                    arr[y, x] = fg
    return arr


def swirl(a, b, size=128):
    arr = np.zeros((size, size, 3), dtype=np.float32)
    for y in range(size):
        for x in range(size):
            dx, dy = x / size - 0.5, y / size - 0.5
            r = math.hypot(dx, dy)
            ang = math.atan2(dy, dx)
            arr[y, x] = a if math.sin(ang * 3 + r * 28) > 0 else b
    return arr


road_img = load_image('road.jpg')
road_nor = load_image('road_nor.jpg')
ground_img = load_image(THEMES and THEMES['ground'])
rock_img = load_image('rock.jpg')
M_ROAD = material('Road', image=road_img, normal=road_nor, rough=0.85)
M_LINE = material('RoadLine', (0.97, 0.97, 0.95), rough=0.5)
M_GROUND = material('Ground', image=ground_img, rough=0.95)
M_ROCK = material('Rock', image=rock_img, rough=0.9)
M_CURB = material('Curb', image=image_from_array('curb', stripes(*THEMES['curb'])), rough=0.45)
M_RAIL = material('Rail', image=image_from_array('rail', stripes(*THEMES['rail'])), rough=0.3)
M_CHECK = material('Checker', image=image_from_array('checker', checker(12, 2)), rough=0.5)
M_PAD = material('BoostPad', image=image_from_array('pad', chevrons((1.0, 0.45, 0.02), (1.0, 0.95, 0.35))), emit=(1.0, 0.5, 0.05), emit_strength=0.9, rough=0.3)
M_CHEV = material('Chevron', image=image_from_array('chev', chevrons((0.9, 0.1, 0.15), (1, 1, 1))), rough=0.4)
M_WHITE = material('White', (0.95, 0.95, 0.95), 0.4)
M_DARK = material('Dark', (0.09, 0.09, 0.12), 0.5)
M_METAL = material('Metal', (0.75, 0.77, 0.8), 0.3, metal=0.8)
M_WATER = material('Water', (0.05, 0.55, 0.85), 0.08, alpha=None)
M_TIRE = material('Tire', (0.06, 0.06, 0.07), 0.8)


def color_mat(rgb, rough=0.45):
    return material('C_%02x%02x%02x' % tuple(int(c * 255) for c in rgb), rgb, rough)


# ------------------------------------------------------------------ geometría por lotes ---------
# Cada material junta toda su geometría en una sola malla (pocas llamadas de dibujo en el juego).

BATCH = {}


def new_bm():
    bm = bmesh.new()
    bm.loops.layers.uv.verify()
    return bm


def bm_for(mat):
    if mat.name not in BATCH:
        BATCH[mat.name] = (new_bm(), mat)
    return BATCH[mat.name][0]


def place(loc, rot_z=0.0, scale=(1, 1, 1), tilt=(0, 0)):
    return Matrix.Translation(loc) @ Matrix.Rotation(rot_z, 4, 'Z') @ Matrix.Rotation(tilt[0], 4, 'X') @ Matrix.Rotation(tilt[1], 4, 'Y') @ Matrix.Diagonal((*scale, 1))


def add_cylinder(mat, m, r1, r2, depth, seg=16):
    bm = bm_for(mat)
    bmesh.ops.create_cone(bm, cap_ends=True, cap_tris=False, segments=seg, radius1=r1, radius2=r2, depth=depth, matrix=m @ Matrix.Translation((0, 0, depth / 2)), calc_uvs=True)


def add_sphere(mat, m, r, seg=12, ring=8):
    bmesh.ops.create_uvsphere(bm_for(mat), u_segments=seg, v_segments=ring, radius=r, matrix=m, calc_uvs=True)


def add_box(mat, m, size, bevel=0.0):
    bm = new_bm()
    bmesh.ops.create_cube(bm, size=1.0, matrix=Matrix.Diagonal((*size, 1)), calc_uvs=True)
    if bevel > 0:
        bmesh.ops.bevel(bm, geom=list(bm.edges), offset=bevel, segments=3, profile=0.5, affect='EDGES')
    bmesh.ops.transform(bm, matrix=m, verts=bm.verts)
    merge_into(mat, bm)


def merge_into(mat, src):
    tmp = bpy.data.meshes.new('tmp')
    src.to_mesh(tmp)
    src.free()
    bm_for(mat).from_mesh(tmp)
    bpy.data.meshes.remove(tmp)


def add_quad_strip(mat, rings, uv_v=None, closed=True):
    """rings: lista de listas de puntos (cada anillo = un corte); une los cortes en una cinta."""
    bm = bm_for(mat)
    uv = bm.loops.layers.uv.verify()
    verts = [[bm.verts.new(p) for p in ring] for ring in rings]
    count = len(rings) if closed else len(rings) - 1
    w = len(rings[0])
    for i in range(count):
        a, b = verts[i], verts[(i + 1) % len(rings)]
        for k in range(w - 1):
            f = bm.faces.new((a[k], a[k + 1], b[k + 1], b[k]))
            for loop, (u, v) in zip(f.loops, ((k, i), (k + 1, i), (k + 1, i + 1), (k, i + 1))):
                vv = uv_v(v) if uv_v else v
                loop[uv].uv = (u / (w - 1), vv)


def finish_batches(smooth_names=()):
    objs = []
    for name, (bm, mat) in BATCH.items():
        me = bpy.data.meshes.new(name)
        bm.to_mesh(me)
        bm.free()
        ob = bpy.data.objects.new(name, me)
        scene.collection.objects.link(ob)
        me.materials.append(mat)
        if name in smooth_names or name.startswith('C_') or name in ('Rail', 'White', 'Metal', 'Tire', 'Dark'):
            for poly in me.polygons:
                poly.use_smooth = True
        objs.append(ob)
    BATCH.clear()
    return objs


def at(i, side, lift=0.0):
    i %= N
    p = P[i] + L[i] * side
    p.z = P[i].z + lift
    return p


# ------------------------------------------------------------------ pista -----------------------

def road():
    sides = [-H, -H * 0.5, 0, H * 0.5, H]
    rings = [[at(i, s, 0.02) for s in sides] for i in range(0, N, STEP)]
    add_quad_strip(M_ROAD, rings, uv_v=lambda v: v * STEP / 9)
    # Líneas blancas de los bordes.
    for s in (-1, 1):
        rings = [[at(i, s * (H - 0.75), 0.035), at(i, s * (H - 0.4), 0.035)] for i in range(0, N, STEP)]
        if s > 0:
            rings = [list(reversed(r)) for r in rings]
        add_quad_strip(M_LINE, rings)
    # Cordones (en las curvas, del lado de adentro y de afuera).
    for s in (-1, 1):
        on = [abs(K[i]) > 1 / 70 for i in range(N)]
        i = 0
        while i < N:
            if not on[i]:
                i += 1
                continue
            j = i
            while j < N and on[j]:
                j += 1
            seg = list(range(max(0, i - 4), min(N, j + 4), STEP))
            rings = []
            for k in seg:
                rings.append([at(k, s * (H - 0.05), 0.03), at(k, s * (H + 0.6), 0.1), at(k, s * (H + 1.4), 0.03)])
            if s > 0:
                rings = [list(reversed(r)) for r in rings]
            add_quad_strip(M_CURB, rings, uv_v=lambda v: v * STEP / 3, closed=False)
            i = j


def start_area():
    # Línea de largada cuadriculada.
    rings = [[at(i, s, 0.04) for s in (-H, H)] for i in (-1, 1)]
    bm = bm_for(M_CHECK)
    uv = bm.loops.layers.uv.verify()
    a = [bm.verts.new(p) for p in rings[0]]
    b = [bm.verts.new(p) for p in rings[1]]
    f = bm.faces.new((a[0], a[1], b[1], b[0]))
    for loop, coords in zip(f.loops, ((0, 0), (1, 0), (1, 1), (0, 1))):
        loop[uv].uv = coords
    # Marcas de la grilla de largada (de a 4 por fila, como el juego).
    for row in range(3):
        for col in range(4):
            i = N - 5 - row * 3
            side = (col - 1.5) * 2.3
            c = at(i, side, 0.04)
            ang = math.atan2(T[i % N].y, T[i % N].x)
            add_box(M_LINE, place(c + T[i % N] * 0.9, ang), (0.12, 1.5, 0.02))
            add_box(M_LINE, place(c + T[i % N] * 1.6, ang), (0.7, 0.12, 0.02))
    # Arco de largada: dos torres, travesaño con el nombre y semáforo.
    ang = math.atan2(T[0].y, T[0].x)
    for s in (-1, 1):
        base = at(0, s * (H + 2.2))
        add_box(color_mat((0.95, 0.25, 0.5)), place(base + Vector((0, 0, 4)), ang), (1.4, 1.4, 8), bevel=0.25)
        add_box(M_WHITE, place(base + Vector((0, 0, 0.4)), ang), (2.0, 2.0, 0.8), bevel=0.2)
    top = at(0, 0, 8.6)
    span = 2 * (H + 2.2) + 1.4
    add_box(color_mat((0.95, 0.25, 0.5)), place(top, ang + math.pi / 2), (span, 1.2, 2.2), bevel=0.3)
    add_box(M_CHECK, place(top + Vector((0, 0, 1.45)), ang + math.pi / 2), (span, 1.0, 0.7), bevel=0.1)
    # Semáforo colgando (mirando a los que llegan).
    light = at(0, 0, 6.6) - T[0] * 0.2
    add_box(M_DARK, place(light, ang + math.pi / 2), (3.2, 0.6, 1.2), bevel=0.2)
    for k, col in enumerate(((1, 0.15, 0.1), (1, 0.75, 0.1), (0.2, 1, 0.3))):
        m = material('Lamp%d' % k, col, 0.3, emit=col, emit_strength=0.6)
        add_sphere(m, place(light - T[0] * 0.32 + L[0] * ((k - 1) * 1.0)), 0.36)
    # Cartel con el nombre (texto de verdad, en relieve).
    bpy.ops.object.text_add(location=(0, 0, 0))
    txt = bpy.context.object
    txt.data.body = DATA['name'].upper()
    txt.data.align_x = 'CENTER'
    txt.data.align_y = 'CENTER'
    txt.data.extrude = 0.08
    txt.data.size = 1.15
    txt.data.bevel_depth = 0.02
    bpy.ops.object.convert(target='MESH')
    width = txt.dimensions.x
    scale = min(1.0, (span - 2) / max(width, 0.1))
    txt.scale = (scale, scale, scale)
    txt.rotation_euler = (math.pi / 2, 0, ang - math.pi / 2)
    txt.location = top - T[0] * 0.66
    txt.data.materials.append(M_WHITE)
    txt.name = 'StartBanner'
    # Tribuna con público del lado de afuera de la recta.
    stand_side = 1 if sum(K[(i) % N] for i in range(-30, 30)) < 0 else -1
    for i in range(N - 36, N + 30, 6):
        k = i % N
        a2 = math.atan2(T[k].y, T[k].x)
        for tier in range(5):
            c = at(k, stand_side * (H + OFF + 4 + tier * 1.3), 0.4 + tier * 0.75)
            add_box(color_mat((0.82, 0.84, 0.9)), place(c, a2), (6.2, 1.3, 0.8 + tier * 1.5 if False else 0.8), bevel=0.05)
            for p in range(5):
                if random.random() < 0.2:
                    continue
                person = c + T[k] * (p * 1.2 - 2.4) + Vector((0, 0, 0.75))
                col = random.choice([(0.95, 0.3, 0.4), (0.3, 0.6, 1), (1, 0.85, 0.2), (0.4, 0.85, 0.4), (0.7, 0.45, 0.95), (1, 0.6, 0.25), (1, 1, 1)])
                add_cylinder(color_mat(col), place(person), 0.28, 0.24, 0.7, seg=7)
                add_sphere(color_mat((1.0, 0.82, 0.68)), place(person + Vector((0, 0, 0.92))), 0.26, seg=7, ring=5)
        roof = at(k, stand_side * (H + OFF + 6.6), 6.2)
        add_box(color_mat((0.95, 0.25, 0.5)), place(roof, a2), (6.4, 7.5, 0.35), bevel=0.1)
        for s2 in (-1, 1):
            add_cylinder(M_METAL, place(at(k, stand_side * (H + OFF + 3.2 + (s2 + 1) * 3.6))), 0.15, 0.15, 6.2, seg=8)


def barriers():
    off = H + OFF + 0.7
    if THEME == 'snow':
        prof = [(-1.2, 0), (-0.9, 0.55), (-0.3, 0.95), (0.4, 0.9), (1.0, 0.45), (1.3, 0)]
        mat = M_GROUND
    else:
        prof = [(0.45 * math.cos(a), 0.5 + 0.45 * math.sin(a)) for a in np.linspace(-math.pi / 2, 3 * math.pi / 2, 9)]
        mat = M_RAIL
    for s in (-1, 1):
        rings = []
        for i in range(0, N, STEP):
            ring = []
            for (dx, dz) in (prof if s > 0 else list(reversed(prof))):
                p = at(i, s * (off + dx), dz)
                ring.append(p)
            rings.append(ring)
        add_quad_strip(mat, rings, uv_v=lambda v: v * STEP / 2.5)
    # Pilas de gomas y carteles de flechas en las curvas fuertes (del lado de afuera).
    i = 0
    while i < N:
        if abs(K[i]) > 1 / 30:
            s = -1 if K[i] > 0 else 1
            for k in range(-6, 7, 3):
                c = at(i + k, s * (off + 1.6))
                for h in range(3):
                    add_cylinder(M_TIRE if h != 1 else M_WHITE, place(c + Vector((0, 0, h * 0.38))), 0.55, 0.55, 0.36, seg=14)
            j = (i - 10) % N
            board = at(j, s * (off + 1.0), 1.4)
            a2 = math.atan2(T[j].y, T[j].x)
            bm = new_bm()
            bmesh.ops.create_grid(bm, x_segments=1, y_segments=1, size=1.0, calc_uvs=True)
            bmesh.ops.rotate(bm, verts=bm.verts, cent=(0, 0, 0), matrix=Matrix.Rotation(math.pi / 2, 3, 'X'))
            # Flecha apuntando para el lado de la curva.
            flip = 1 if s < 0 else -1
            bmesh.ops.transform(bm, verts=bm.verts, matrix=place(board, a2 + math.pi / 2, (2.6 * flip, 1, 0.9)) @ Matrix.Rotation(math.pi / 2, 4, 'Y'))
            merge_into(M_CHEV, bm)
            for s2 in (-1.2, 1.2):
                add_cylinder(M_METAL, place(at(j, s * (off + 1.0)) + T[j] * s2), 0.07, 0.07, 1.5, seg=6)
            i += 25
        i += 1


def boost_pads():
    for idx, side in DATA['pads']:
        c = at(idx, side, 0.045)
        a2 = math.atan2(T[idx].y, T[idx].x)
        bm = new_bm()
        bmesh.ops.create_grid(bm, x_segments=1, y_segments=1, size=1.0, calc_uvs=True)
        bmesh.ops.transform(bm, verts=bm.verts, matrix=place(c, a2 - math.pi / 2, (1.7, 2.3, 1)))
        merge_into(M_PAD, bm)


# ------------------------------------------------------------------ terreno ---------------------

TREE = kdtree.KDTree(N)
for i, p in enumerate(P):
    TREE.insert(Vector((p.x, p.y, 0)), i)
TREE.balance()


def smoothstep(a, b, x):
    t = min(1.0, max(0.0, (x - a) / (b - a)))
    return t * t * (3 - 2 * t)


def terrain_height(x, y):
    _, i, d = TREE.find(Vector((x, y, 0)))
    h = P[i].z - 0.06
    band = H + OFF + 1.6
    if d <= band:
        return h, d
    far = d - band
    n1 = noise.noise(Vector((x / 55, y / 55, 0.3)))
    n2 = noise.noise(Vector((x / 18, y / 18, 1.7)))
    if THEME == 'candy':
        base = 2.5 + n1 * 7 + n2 * 1.2 + smoothstep(60, 140, far) * 14
    elif THEME == 'beach':
        base = -5.5 + n2 * 0.6 - smoothstep(20, 80, far) * 3 + smoothstep(110, 170, far) * 22
    else:
        base = 4 + n1 * 9 + n2 * 2 + smoothstep(40, 120, far) * 26
    t = smoothstep(0, 28 if THEME != 'beach' else 22, far)
    return h * (1 - t) + base * t, d


def terrain():
    xs = [p.x for p in P]
    ys = [p.y for p in P]
    pad = 190
    x0, x1, y0, y1 = min(xs) - pad, max(xs) + pad, min(ys) - pad, max(ys) + pad
    step = 3.0
    nx = int((x1 - x0) / step) + 1
    ny = int((y1 - y0) / step) + 1
    bm = bmesh.new()
    uv = bm.loops.layers.uv.verify()
    grid = []
    steep = set()
    for j in range(ny):
        row = []
        for i in range(nx):
            x = x0 + i * step
            y = y0 + j * step
            # Lejos: menos detalle (se nota menos y pesa menos).
            z, _ = terrain_height(x, y)
            row.append(bm.verts.new((x, y, z)))
        grid.append(row)
    rock_faces = []
    for j in range(ny - 1):
        for i in range(nx - 1):
            f = bm.faces.new((grid[j][i], grid[j][i + 1], grid[j + 1][i + 1], grid[j + 1][i]))
            for loop in f.loops:
                co = loop.vert.co
                loop[uv].uv = (co.x / 9, co.y / 9)
            f.normal_update()
            if f.normal.z < 0.72:
                rock_faces.append(f)
    for f in bm.faces:
        f.smooth = True
    # Las laderas empinadas, de roca.
    rock = bmesh.new()
    me = bpy.data.meshes.new('terrain')
    bm.to_mesh(me)
    ob = bpy.data.objects.new('Ground', me)
    scene.collection.objects.link(ob)
    me.materials.append(M_GROUND)
    me.materials.append(M_ROCK)
    steep_idx = {f.index for f in rock_faces}
    for poly in me.polygons:
        if poly.index in steep_idx:
            poly.material_index = 1
    bm.free()
    rock.free()
    # Menos triángulos (las partes planas se juntan).
    dec = ob.modifiers.new('dec', 'DECIMATE')
    dec.ratio = 0.45
    bpy.context.view_layer.objects.active = ob
    ob.select_set(True)
    bpy.ops.object.modifier_apply(modifier='dec')
    ob.select_set(False)
    if THEME == 'beach':
        bm2 = new_bm()
        bmesh.ops.create_grid(bm2, x_segments=1, y_segments=1, size=1.0)
        bmesh.ops.transform(bm2, verts=bm2.verts, matrix=place(Vector(((x0 + x1) / 2, (y0 + y1) / 2, -1.6)), 0, ((x1 - x0) * 0.6, (y1 - y0) * 0.6, 1)))
        merge_into(M_WATER, bm2)
    return (x0, x1, y0, y1)


# ------------------------------------------------------------------ decoración ------------------

def scatter(bounds, count, near=55):
    x0, x1, y0, y1 = bounds
    spots = []
    tries = 0
    while len(spots) < count and tries < count * 40:
        tries += 1
        # La mitad cerca de la pista (se ven), el resto por todos lados.
        if random.random() < 0.65:
            i = random.randrange(N)
            s = random.choice((-1, 1)) * (H + OFF + 4 + random.random() * near)
            p = at(i, s)
            x, y = p.x, p.y
        else:
            x = random.uniform(x0 + 30, x1 - 30)
            y = random.uniform(y0 + 30, y1 - 30)
        z, d = terrain_height(x, y)
        if d < H + OFF + 4:
            continue
        if THEME == 'beach' and z < -1.0:
            continue
        if any((x - a) ** 2 + (y - b) ** 2 < 9 for a, b, _ in spots):
            continue
        spots.append((x, y, z))
    return spots


def candy_props(spots):
    leaf_cols = [(0.35, 0.8, 0.3), (0.45, 0.88, 0.35), (1.0, 0.55, 0.75), (0.3, 0.7, 0.35)]
    pop_mats = [material('Swirl%d' % k, image=image_from_array('swirl%d' % k, swirl(a, (1, 1, 1))), rough=0.25) for k, a in enumerate(((0.95, 0.2, 0.5), (0.2, 0.7, 0.95), (0.98, 0.75, 0.1)))]
    gum = [(0.95, 0.2, 0.4), (1.0, 0.7, 0.1), (0.3, 0.8, 0.4), (0.55, 0.35, 0.95), (0.2, 0.65, 1.0)]
    for k, (x, y, z) in enumerate(spots):
        s = random.uniform(0.8, 1.6)
        base = Vector((x, y, z - 0.1))
        kind = random.random()
        if kind < 0.45:
            # Árbol redondo (tronco y copa de bolas).
            add_cylinder(color_mat((0.55, 0.36, 0.22)), place(base), 0.35 * s, 0.28 * s, 3.2 * s, seg=10)
            col = color_mat(random.choice(leaf_cols))
            for (dx, dy, dz, r) in ((0, 0, 4.2, 1.9), (1.1, 0.3, 3.6, 1.3), (-1.0, -0.4, 3.7, 1.35), (0.2, -1.0, 4.8, 1.2)):
                add_sphere(col, place(base + Vector((dx * s, dy * s, dz * s))), r * s, seg=10, ring=7)
        elif kind < 0.65:
            # Chupetín gigante.
            add_cylinder(M_WHITE, place(base), 0.14 * s, 0.14 * s, 4.2 * s, seg=8)
            add_cylinder(random.choice(pop_mats), place(base + Vector((0, 0, 4.4 * s)), random.uniform(0, 6), tilt=(math.pi / 2, 0)), 1.5 * s, 1.5 * s, 0.4 * s, seg=28)
        elif kind < 0.85:
            # Gomitas (montoncito).
            for g in range(random.randint(1, 3)):
                c = base + Vector((random.uniform(-1.2, 1.2), random.uniform(-1.2, 1.2), 0))
                add_sphere(color_mat(random.choice(gum), 0.15), place(c, 0, (1, 1, 1.15)), random.uniform(0.7, 1.1) * s, seg=16, ring=10)
        else:
            # Bastón de caramelo.
            add_cylinder(M_CURB, place(base), 0.22 * s, 0.22 * s, 4 * s, seg=10)
            add_sphere(M_CURB, place(base + Vector((0, 0, 4 * s))), 0.24 * s, seg=10, ring=6)


def beach_props(spots):
    for (x, y, z) in spots:
        s = random.uniform(0.8, 1.4)
        base = Vector((x, y, z - 0.1))
        kind = random.random()
        if kind < 0.55:
            # Palmera: tronco curvo de anillos y hojas largas.
            lean = random.uniform(0, math.tau)
            pos = base.copy()
            for k in range(9):
                bend = Vector((math.cos(lean), math.sin(lean), 0)) * (k * k * 0.012 * s)
                add_cylinder(color_mat((0.62, 0.45, 0.28) if k % 2 else (0.55, 0.39, 0.24)), place(pos + bend), 0.32 * s - k * 0.015, 0.3 * s - k * 0.015, 0.75 * s, seg=9)
                pos = pos + Vector((0, 0, 0.72 * s))
            top = pos + Vector((math.cos(lean), math.sin(lean), 0)) * (0.9 * s)
            for k in range(8):
                a = k / 8 * math.tau + random.uniform(-0.2, 0.2)
                bm = bmesh.new()
                verts = []
                for seg in range(6):
                    t = seg / 5
                    w = math.sin(t * math.pi) * 0.55 + 0.05
                    dz = -t * t * 1.6
                    verts.append((t * 3.2, -w, dz))
                    verts.append((t * 3.2, w, dz + 0.12))
                vs = [bm.verts.new(v) for v in verts]
                for seg in range(5):
                    bm.faces.new((vs[seg * 2], vs[seg * 2 + 1], vs[seg * 2 + 3], vs[seg * 2 + 2]))
                bmesh.ops.transform(bm, verts=bm.verts, matrix=place(top, a, (s, s, s)))
                merge_into(color_mat((0.25, 0.72, 0.3)), bm)
            for k in range(3):
                add_sphere(color_mat((0.45, 0.3, 0.15)), place(top + Vector((math.cos(k * 2.1) * 0.3, math.sin(k * 2.1) * 0.3, -0.35))), 0.25 * s, seg=8, ring=6)
        elif kind < 0.75:
            # Sombrilla y toalla.
            add_cylinder(M_WHITE, place(base), 0.06, 0.06, 2.6 * s, seg=6)
            add_cylinder(color_mat(random.choice([(0.95, 0.3, 0.4), (0.2, 0.6, 1), (1, 0.8, 0.2)])), place(base + Vector((0, 0, 2.3 * s))), 1.7 * s, 0.05, 0.7 * s, seg=12)
            add_box(color_mat(random.choice([(1, 0.5, 0.6), (0.4, 0.8, 1), (1, 0.9, 0.4)])), place(base + Vector((0.9, 0.3, 0.05)), random.uniform(0, 3)), (1.0, 1.9, 0.05))
        elif kind < 0.9:
            add_sphere(M_ROCK, place(base, random.uniform(0, 6), (1.3, 1.0, 0.7)), random.uniform(0.8, 1.8) * s, seg=10, ring=7)
        else:
            # Chocita.
            add_box(color_mat((0.85, 0.7, 0.5)), place(base + Vector((0, 0, 1.2 * s))), (3 * s, 3 * s, 2.4 * s), bevel=0.1)
            add_cylinder(color_mat((0.9, 0.78, 0.4)), place(base + Vector((0, 0, 2.4 * s))), 2.6 * s, 0.1, 1.6 * s, seg=4)


def snow_props(spots):
    for (x, y, z) in spots:
        s = random.uniform(0.8, 1.7)
        base = Vector((x, y, z - 0.1))
        kind = random.random()
        if kind < 0.65:
            # Pino con nieve en las ramas.
            add_cylinder(color_mat((0.45, 0.3, 0.2)), place(base), 0.3 * s, 0.25 * s, 1.2 * s, seg=8)
            for k in range(4):
                r = (2.0 - k * 0.42) * s
                hz = (1.0 + k * 1.25) * s
                add_cylinder(color_mat((0.12, 0.45, 0.3)), place(base + Vector((0, 0, hz))), r, 0.05, 1.9 * s, seg=12)
                add_cylinder(M_WHITE, place(base + Vector((0, 0, hz + 0.95 * s))), r * 0.45, 0.04, 0.8 * s, seg=12)
        elif kind < 0.8:
            # Muñeco de nieve.
            add_sphere(M_WHITE, place(base + Vector((0, 0, 0.9 * s))), 1.0 * s)
            add_sphere(M_WHITE, place(base + Vector((0, 0, 2.2 * s))), 0.7 * s)
            add_sphere(M_WHITE, place(base + Vector((0, 0, 3.1 * s))), 0.5 * s)
            add_cylinder(color_mat((1.0, 0.5, 0.1)), place(base + Vector((0.45 * s, 0, 3.1 * s)), 0, tilt=(0, math.pi / 2)), 0.09 * s, 0.01, 0.5 * s, seg=8)
            add_cylinder(M_DARK, place(base + Vector((0, 0, 3.45 * s))), 0.42 * s, 0.42 * s, 0.6 * s, seg=12)
        elif kind < 0.9:
            # Cabañita.
            add_box(color_mat((0.6, 0.35, 0.2)), place(base + Vector((0, 0, 1.4 * s))), (4 * s, 3.2 * s, 2.8 * s), bevel=0.08)
            add_box(M_WHITE, place(base + Vector((0, 0, 3.2 * s)), 0, (1, 1, 1)), (4.6 * s, 3.8 * s, 0.6 * s), bevel=0.25)
            add_box(color_mat((1, 0.85, 0.4)), place(base + Vector((2.01 * s, 0, 1.5 * s))), (0.05, 0.9 * s, 0.9 * s))
        else:
            add_sphere(material('Ice', (0.7, 0.88, 1.0), 0.1), place(base, random.uniform(0, 6), (0.8, 0.8, 1.6)), random.uniform(0.7, 1.4) * s, seg=6, ring=4)


def hedges():
    """Arbustos y flores del lado de afuera de las barandas (la pista se ve llena)."""
    bush = {'candy': (0.3, 0.72, 0.32), 'beach': (0.3, 0.6, 0.28), 'snow': (0.15, 0.42, 0.3)}[THEME]
    flowers = [(1, 0.4, 0.6), (1, 0.85, 0.2), (0.7, 0.5, 1), (1, 1, 1)]
    for i in range(0, N, 5):
        for s in (-1, 1):
            if random.random() < 0.35:
                continue
            c = at(i, s * (H + OFF + 2.6 + random.random() * 2.5), -0.2)
            if THEME == 'beach' and c.z < -1:
                continue
            r = random.uniform(0.7, 1.3)
            add_sphere(color_mat(bush, 0.7), place(c, 0, (1.3, 1.0, 0.8)), r, seg=8, ring=6)
            if THEME != 'snow' and random.random() < 0.5:
                for f in range(4):
                    fc = c + Vector((random.uniform(-1.5, 1.5), random.uniform(-1.5, 1.5), r * 0.5))
                    add_sphere(color_mat(random.choice(flowers), 0.5), place(fc), 0.16, seg=6, ring=4)


def mountains(bounds):
    x0, x1, y0, y1 = bounds
    cx, cy = (x0 + x1) / 2, (y0 + y1) / 2
    rad = max(x1 - x0, y1 - y0) / 2 + 40
    col = {'candy': (0.62, 0.55, 0.95), 'beach': (0.45, 0.68, 0.5), 'snow': (0.55, 0.62, 0.78)}[THEME]
    for k in range(34):
        a = k / 34 * math.tau + random.uniform(-0.05, 0.05)
        d = rad + random.uniform(0, 60)
        h = random.uniform(40, 80)
        r = random.uniform(45, 80)
        base = Vector((cx + math.cos(a) * d, cy + math.sin(a) * d, -10))
        bm = new_bm()
        bmesh.ops.create_icosphere(bm, subdivisions=3, radius=1.0, calc_uvs=True)
        seed = random.uniform(0, 100)
        for v in bm.verts:
            v.co.z = max(v.co.z, -0.05)
            bump = 1 + noise.noise(Vector((v.co.x * 1.8 + seed, v.co.y * 1.8, v.co.z * 1.8))) * 0.18
            v.co *= bump
        bmesh.ops.transform(bm, verts=bm.verts, matrix=place(base, random.uniform(0, 6), (r, r * random.uniform(0.7, 1.0), h)))
        snowy = THEME == 'snow' or (THEME == 'candy' and k % 3 == 0)
        merge_into(color_mat(col, 0.9), bm)
        if snowy:
            cap = new_bm()
            bmesh.ops.create_icosphere(cap, subdivisions=2, radius=1.0, calc_uvs=True)
            bmesh.ops.transform(cap, verts=cap.verts, matrix=place(base + Vector((0, 0, h * 0.78)), 0, (r * 0.42, r * 0.42, h * 0.26)))
            merge_into(M_WHITE, cap)


# ------------------------------------------------------------------ armado ----------------------

road()
start_area()
barriers()
boost_pads()
bounds = terrain()
spots = scatter(bounds, 430, near=40)
hedges()
{'candy': candy_props, 'beach': beach_props, 'snow': snow_props}[THEME](spots)
mountains(bounds)
finish_batches()

# Luz para la vista previa (el juego pone la suya).
world = bpy.data.worlds.new('w')
world.use_nodes = True
bg = world.node_tree.nodes['Background']
bg.inputs['Color'].default_value = (*THEMES['sky'], 1)
bg.inputs['Strength'].default_value = 0.9
scene.world = world

bpy.ops.export_scene.gltf(filepath=OUT, export_format='GLB', export_apply=True, export_yup=True, export_image_format='AUTO', export_materials='EXPORT', export_cameras=False, export_lights=False, export_draco_mesh_compression_enable=True, export_draco_mesh_compression_level=6, export_draco_position_quantization=14, export_draco_texcoord_quantization=12)
print('EXPORTED', OUT, os.path.getsize(OUT))

if PREVIEW:
    sun = bpy.data.lights.new('sun', 'SUN')
    sun.energy = 3.5
    sun_ob = bpy.data.objects.new('sun', sun)
    sun_ob.rotation_euler = (math.radians(50), math.radians(10), math.radians(140))
    scene.collection.objects.link(sun_ob)
    cam = bpy.data.cameras.new('cam')
    cam.lens = 24
    cam.clip_end = 2000
    cam_ob = bpy.data.objects.new('cam', cam)
    scene.collection.objects.link(cam_ob)
    scene.camera = cam_ob
    scene.view_settings.view_transform = 'Standard'
    views = [(N - 12, 0, 3.4, 18), (int(N * 0.3), 0, 3.4, 18), (int(N * 0.62), 0, 3.4, 18), (0, 0, 120, 0)]
    for k, (i, side, up, ahead) in enumerate(views):
        if up > 50:
            cx = sum(p.x for p in P) / N
            cy = sum(p.y for p in P) / N
            cam_ob.location = (cx, cy - 260, 220)
            look = Vector((cx, cy, 0))
        else:
            cam_ob.location = at(i, side, up) - T[i % N] * 6
            look = at(i + ahead, 0, 1.0)
        d = look - Vector(cam_ob.location)
        cam_ob.rotation_euler = d.to_track_quat('-Z', 'Y').to_euler()
        for engine in ('BLENDER_EEVEE', 'BLENDER_EEVEE_NEXT'):
            try:
                scene.render.engine = engine
                break
            except TypeError:
                continue
        scene.render.resolution_x = 960
        scene.render.resolution_y = 540
        scene.render.filepath = PREVIEW.replace('.png', '_%d.png' % k)
        bpy.ops.render.render(write_still=True)
    print('PREVIEW OK')
