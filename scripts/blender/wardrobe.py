"""
Avatar MODULAR de PelaCord: cuerpo de hombre / mujer + peinados, caras y ropa intercambiables.

Todo vive en un solo GLB (public/models/avatar_modular.glb) sobre UN esqueleto con las mismas
animaciones que avatar.py. Cada pieza es su propia malla y la app muestra sólo las elegidas.

Extras en cada malla (para la app):
  pelacord_slot   body | hair | eyes | brows | mouth | cheeks | top | bottom | shoes
  pelacord_body   M | F | any        (las prendas que siguen la forma del torso vienen en las dos)
  pelacord_item   id del catálogo (public/catalog.json)
  pelacord_hides  ej. "bottom" (el vestido tapa el pantalón)

Materiales que la app recolorea: Skin, Hair, Top, Bottom, Shoes, Sole, Ink (fijo: Accent, White, Blush).
"""
import json
import math
import os
import sys

import bmesh
import bpy
from mathutils import Vector

sys.path.insert(0, os.path.dirname(__file__))
import avatar  # noqa: E402
import toy  # noqa: E402

DEG = math.radians

# Forma del torso por cuerpo: ancho de hombros / cadera y profundidad. Sutil, estilo juguete.
BODY_SHAPES = {
	'M': {'shoulders': 1.10, 'hips': 0.98, 'depth': 0.84, 'chest': 1.0},
	'F': {'shoulders': 0.94, 'hips': 1.08, 'depth': 0.80, 'chest': 1.04},
}

MATS = {}


def mats(suffix=''):
	key = suffix
	if key in MATS and all(m.name in bpy.data.materials for m in MATS[key].values()):
		return MATS[key]
	MATS[key] = {
		'Skin': toy.material('Skin' + suffix, (0.98, 0.78, 0.62)),
		'Hair': toy.material('Hair' + suffix, (0.30, 0.17, 0.10)),
		'Top': toy.material('Top' + suffix, 'sofa_purple'),
		'Bottom': toy.material('Bottom' + suffix, (0.22, 0.28, 0.52)),
		'Shoes': toy.material('Shoes' + suffix, 'white'),
		'Sole': toy.material('Sole' + suffix, 'coral'),
		'Ink': toy.material('Ink', 'ink', roughness=0.6),
		'Accent': toy.material('Accent', 'cream'),
		'White': toy.material('EyeWhite', 'white', roughness=0.5),
		'Blush': toy.material('Blush', (1.0, 0.55, 0.6)),
	}
	return MATS[key]


# ------------------------------------------------------------ geometría -----

def tapered(name, radius, height, loc, shape, mat, bottom=None, top=None, segments=24, rings=16, grow=1.0):
	"""Cápsula cuyo ancho va de `bottom` (abajo) a `top` (arriba): torso con hombros/cadera."""
	obj = toy.capsule(name, radius=radius * grow, height=height * grow, loc=(0, 0, 0), mat=mat, segments=segments, rings=rings)
	bottom = shape['hips'] if bottom is None else bottom
	top = shape['shoulders'] if top is None else top
	zs = [v.co.z for v in obj.data.vertices]
	low, high = min(zs), max(zs)
	for v in obj.data.vertices:
		t = (v.co.z - low) / max(1e-6, high - low)
		k = bottom + (top - bottom) * (t * t * (3 - 2 * t))
		v.co.x *= k
		v.co.y *= shape['depth'] * (1 + (shape['chest'] - 1) * max(0.0, 1 - abs(t - 0.62) * 4))
	obj.location = loc
	return obj


def part(pieces, name, rig, slot, body='any', item=None, hides=None):
	"""Une piezas (cada una ya asignada a su hueso) en una malla esquelética de la pieza."""
	for obj, bone in pieces:
		group = obj.vertex_groups.new(name=bone)
		group.add([v.index for v in obj.data.vertices], 1.0, 'REPLACE')
		toy.apply_transforms(obj)
	mesh = toy.join([obj for obj, _ in pieces], name)
	mesh.parent = rig
	mod = mesh.modifiers.new('Rig', 'ARMATURE')
	mod.object = rig
	mesh['pelacord_slot'] = slot
	mesh['pelacord_body'] = body
	mesh['pelacord_item'] = item or name
	if hides:
		mesh['pelacord_hides'] = hides
	return mesh


# ---------------------------------------------------------------- cuerpo ----

def body_parts(rig, kind, m, prefix=''):
	shape = BODY_SHAPES[kind]
	p = []
	p.append((tapered('torso', 0.17, 0.43, (0, 0, 0.615), shape, m['Skin']), 'spine'))
	p.append((tapered('pelvis', 0.163, 0.2, (0, 0, 0.43), shape, m['Skin'], bottom=shape['hips'], top=shape['hips']), 'hips'))
	p.append((toy.sphere('head', radius=0.2, scale=(1.0, 0.95, 1.15), loc=(0, 0, 0.98), mat=m['Skin']), 'head'))
	p.append((toy.sphere('nose', radius=0.029, scale=(1.0, 0.9, 0.95), loc=(0, -0.2, 0.948), mat=m['Skin'], segments=14, rings=10), 'head'))
	for side, arm, leg in ((1, 'arm_L', 'leg_L'), (-1, 'arm_R', 'leg_R')):
		x = side * 0.215 * (1.04 if kind == 'M' else 0.97)
		p.append((toy.sphere(f'ear_{side}', radius=0.046, scale=(0.5, 0.75, 1.0), loc=(side * 0.196, 0, 0.97), mat=m['Skin'], segments=14, rings=10), 'head'))
		p.append((toy.capsule(f'upper_{side}', radius=0.05, height=0.18, loc=(x, 0, 0.665), mat=m['Skin']), arm))
		p.append((toy.capsule(f'forearm_{side}', radius=0.047, height=0.2, loc=(x, 0, 0.55), mat=m['Skin']), arm))
		p.append((toy.sphere(f'mitten_{side}', radius=0.06, scale=(0.85, 0.78, 1.05), loc=(x, -0.004, 0.44), mat=m['Skin'], segments=16, rings=12), arm))
		p.append((toy.sphere(f'thumb_{side}', radius=0.024, scale=(1, 1, 1.3), loc=(x - side * 0.012, -0.045, 0.462), mat=m['Skin'], segments=10, rings=8), arm))
		p.append((toy.capsule(f'leg_{side}', radius=0.06, height=0.32, loc=(side * 0.088, 0, 0.245), mat=m['Skin']), leg))
	return part(p, f'{prefix}Body_{kind}', rig, 'body', kind, f'body_{kind.lower()}')


def arm_x(kind):
	return 0.215 * (1.04 if kind == 'M' else 0.97)


# ----------------------------------------------------------------- caras ----

def eyes_parts(rig, m, prefix=''):
	out = []
	def both(make):
		return [(make(side), 'eye_L' if side > 0 else 'eye_R') for side in (1, -1)]
	dot = lambda s: toy.sphere(f'eye_{s}', radius=0.024, scale=(1.0, 0.55, 1.18), loc=(s * 0.052, -0.18, 1.0), mat=m['Ink'], segments=14, rings=10)
	out.append(part(both(dot), f'{prefix}Eyes_Dot', rig, 'eyes', item='eyes_dot'))

	pieces = both(dot)
	for side in (1, -1):
		bone = 'eye_L' if side > 0 else 'eye_R'
		for k, ang in enumerate((-35, 0, 35)):
			lash = toy.capsule(f'lash_{side}_{k}', radius=0.0055, height=0.032, loc=(side * (0.052 + 0.02 * math.sin(DEG(ang)) + 0.012), -0.178, 1.03), mat=m['Ink'], segments=8, rings=6)
			lash.rotation_euler = (0, DEG(side * (30 + ang * 0.6)), 0)
			pieces.append((lash, bone))
	out.append(part(pieces, f'{prefix}Eyes_Lash', rig, 'eyes', item='eyes_lash'))

	def happy(s):
		arc = toy.torus(f'happy_{s}', major=0.022, minor=0.0065, loc=(s * 0.052, -0.181, 0.992), rot=(DEG(90), 0, 0), mat=m['Ink'], major_seg=16, minor_seg=6)
		bm = bmesh.new()
		bm.from_mesh(arc.data)
		bmesh.ops.delete(bm, geom=[v for v in bm.verts if v.co.y < -0.004], context='VERTS')  # media luna (^ ^)
		bm.to_mesh(arc.data)
		bm.free()
		return arc
	out.append(part(both(happy), f'{prefix}Eyes_Happy', rig, 'eyes', item='eyes_happy'))

	pieces = []
	for side in (1, -1):
		bone = 'eye_L' if side > 0 else 'eye_R'
		pieces.append((toy.sphere(f'big_{side}', radius=0.034, scale=(1.0, 0.5, 1.15), loc=(side * 0.056, -0.177, 1.0), mat=m['Ink'], segments=16, rings=10), bone))
		pieces.append((toy.sphere(f'shine_{side}', radius=0.009, loc=(side * 0.056 + 0.01, -0.195, 1.013), mat=m['White'], segments=8, rings=6), bone))
	out.append(part(pieces, f'{prefix}Eyes_Big', rig, 'eyes', item='eyes_big'))
	return out


def brows_parts(rig, m, prefix=''):
	out = []
	for item, radius, length, tilt, lift in (('brows_line', 0.0095, 0.052, 8, 0.0), ('brows_thick', 0.015, 0.058, 4, 0.0), ('brows_arch', 0.009, 0.05, 22, 0.006)):
		pieces = []
		for side in (1, -1):
			brow = toy.capsule(f'{item}_{side}', radius=radius, height=length, loc=(side * 0.056, -0.175, 1.058 + lift), mat=m['Ink'], segments=10, rings=8)
			brow.rotation_euler = (0, DEG(90), DEG(side * tilt))
			pieces.append((brow, 'head'))
		out.append(part(pieces, prefix + item.title().replace('_', '_').replace('Brows_', 'Brows_'), rig, 'brows', item=item))
	return out


def mouth_parts(rig, m, prefix=''):
	out = []
	neutral = toy.sphere('mouth_neutral', radius=0.034, scale=(1.25, 0.42, 0.42), loc=(0, -0.183, 0.885), mat=m['Ink'], segments=16, rings=10)
	out.append(part([(neutral, 'mouth')], f'{prefix}Mouth_Neutral', rig, 'mouth', item='mouth_neutral'))
	smile = toy.torus('mouth_smile', major=0.032, minor=0.008, loc=(0, -0.186, 0.9), rot=(DEG(90), 0, 0), mat=m['Ink'], major_seg=20, minor_seg=6)
	bm = bmesh.new()
	bm.from_mesh(smile.data)
	bmesh.ops.delete(bm, geom=[v for v in bm.verts if v.co.y > 0.004], context='VERTS')  # sólo la mitad de abajo
	bm.to_mesh(smile.data)
	bm.free()
	out.append(part([(smile, 'mouth')], f'{prefix}Mouth_Smile', rig, 'mouth', item='mouth_smile'))
	grin = toy.sphere('mouth_grin', radius=0.042, scale=(1.2, 0.4, 0.6), loc=(0, -0.182, 0.884), mat=m['Ink'], segments=18, rings=10)
	bm = bmesh.new()
	bm.from_mesh(grin.data)
	bmesh.ops.delete(bm, geom=[v for v in bm.verts if v.co.z > 0.004], context='VERTS')
	bm.to_mesh(grin.data)
	bm.free()
	tongue = toy.sphere('tongue', radius=0.02, scale=(1.2, 0.5, 0.5), loc=(0, -0.186, 0.872), mat=m['Blush'], segments=10, rings=6)
	out.append(part([(grin, 'mouth'), (tongue, 'mouth')], f'{prefix}Mouth_Grin', rig, 'mouth', item='mouth_grin'))
	return out


def cheeks_part(rig, m, prefix=''):
	pieces = [(toy.sphere(f'blush_{s}', radius=0.03, scale=(1.2, 0.35, 0.75), loc=(s * 0.11, -0.168, 0.925), mat=m['Blush'], segments=12, rings=8), 'head') for s in (1, -1)]
	return part(pieces, f'{prefix}Cheeks_Blush', rig, 'cheeks', item='cheeks_blush')


# ---------------------------------------------------------------- pelos -----

def hair_cap(name, mat, front=0.17, back=-0.09, scale=(1.02, 0.99, 1.14), radius=0.214, thickness=0.03):
	bm = bmesh.new()
	bmesh.ops.create_uvsphere(bm, u_segments=28, v_segments=16, radius=radius)
	remove = []
	for v in bm.verts:
		v.co = Vector((v.co.x * scale[0], v.co.y * scale[1], v.co.z * scale[2]))
		f = max(0.0, -v.co.y) / 0.21
		if v.co.z < back + f * front:
			remove.append(v)
	bmesh.ops.delete(bm, geom=remove, context='VERTS')
	obj = toy._new_mesh_object(name, bm, mat)
	obj.location = (0, 0.004, 0.985)
	mod = obj.modifiers.new('Solid', 'SOLIDIFY')
	mod.thickness = thickness
	mod.offset = 1
	sub = obj.modifiers.new('Soft', 'SUBSURF')
	sub.levels = 1
	toy.apply_modifiers(obj)
	return toy.smooth(obj, 80)


def fuse_hair(pieces, name, mat, cut_below=0.9, face=(0.16, 0.95), voxel=0.0105):
	"""Funde las formas en UNA masa de pelo esculpida (como plastilina): remesh por vóxeles,
	se despeja la cara, se recorta abajo y se suaviza. Así no quedan bordes serruchados."""
	obj = toy.join(pieces, name)
	for slot in obj.material_slots:
		slot.material = mat
	mod = obj.modifiers.new('Fuse', 'REMESH')
	mod.mode = 'VOXEL'
	mod.voxel_size = voxel
	mod.adaptivity = 0.0
	toy.apply_modifiers(obj)
	cutters = []
	# Cara: un óvalo adelante (más angosto que la cabeza para no comerse los mechones laterales).
	face_y, face_w = face
	cutters.append(toy.sphere('face_cut', radius=0.2, scale=(face_w * 0.95, 1.0, 0.8), loc=(0, -0.2 - face_y * 0.15, 0.905), segments=32, rings=20))
	# Todo lo que queda por debajo de `cut_below` (nuca / hombros).
	cutters.append(toy.rounded_box('low_cut', size=(1.2, 1.2, 1.0), loc=(0, 0, cut_below - 0.5), radius=0.01))
	for cutter in cutters:
		b = obj.modifiers.new(cutter.name, 'BOOLEAN')
		b.operation = 'DIFFERENCE'
		b.object = cutter
		b.solver = 'EXACT'
	toy.apply_modifiers(obj)
	for cutter in cutters:
		bpy.data.objects.remove(cutter, do_unlink=True)
	smooth = obj.modifiers.new('Soft', 'SMOOTH')
	smooth.factor = 0.7
	smooth.iterations = 6
	dec = obj.modifiers.new('Light', 'DECIMATE')
	dec.ratio = max(0.08, min(1.0, 3200 / max(1, len(obj.data.polygons))))
	toy.apply_modifiers(obj)
	for poly in obj.data.polygons:
		poly.material_index = 0
	return toy.smooth(obj, 180)


def cap(name, mat, radius=0.218, z=0.995, scale=(1.04, 1.03, 1.1)):
	return toy.sphere(name, radius=radius, scale=scale, loc=(0, 0.012, z), mat=mat, segments=32, rings=20)


def hair_parts(rig, m, prefix=''):
	H = m['Hair']
	out = []

	# Flequillo clásico: casco con cuatro mechones redondos sobre la frente.
	pieces = [cap('bowl_cap', H)]
	for k, x in enumerate((-0.12, -0.04, 0.04, 0.12)):
		pieces.append(toy.sphere(f'bang_{k}', radius=0.062, scale=(1.15, 0.75, 0.95), loc=(x, -0.165 + abs(x) * 0.25, 1.075 - abs(x) * 0.12), mat=H, segments=16, rings=10))
	out.append(part([(fuse_hair(pieces, 'bowl', H, cut_below=0.9), 'head')], f'{prefix}Hair_Bowl', rig, 'hair', item='hair_bowl'))

	# Pinchos: casco corto + mechones gorditos hacia arriba y atrás.
	pieces = [cap('spiky_cap', H, radius=0.212, z=0.99)]
	for k, (x, y, tilt_x, tilt_y) in enumerate(((0, -0.1, -25, 0), (-0.09, -0.06, -15, -25), (0.09, -0.06, -15, 25), (-0.05, 0.04, 15, -20), (0.06, 0.05, 15, 20), (0, 0.1, 30, 0), (0, -0.02, 0, 0))):
		tuft = toy.cone(f'tuft_{k}', r1=0.07, r2=0.012, depth=0.15, loc=(x, y, 1.2), mat=H, segments=12)
		tuft.rotation_euler = (DEG(tilt_x), DEG(tilt_y), 0)
		pieces.append(tuft)
	out.append(part([(fuse_hair(pieces, 'spiky', H, cut_below=0.98), 'head')], f'{prefix}Hair_Spiky', rig, 'hair', item='hair_spiky'))

	# Largo: casco + melena atrás + mechones a los costados de la cara.
	pieces = [cap('long_cap', H)]
	pieces.append(toy.capsule('long_back', radius=0.2, height=0.62, scale=(1.05, 0.62, 1.0), loc=(0, 0.075, 0.83), mat=H))
	for side in (1, -1):
		pieces.append(toy.capsule(f'long_lock_{side}', radius=0.058, height=0.38, loc=(side * 0.168, -0.045, 0.86), mat=H))
	for k, x in enumerate((-0.1, 0.0, 0.1)):
		pieces.append(toy.sphere(f'long_bang_{k}', radius=0.06, scale=(1.2, 0.75, 0.9), loc=(x, -0.168, 1.08 - abs(x) * 0.1), mat=H, segments=14, rings=10))
	out.append(part([(fuse_hair(pieces, 'long', H, cut_below=0.6, face=(0.16, 0.74)), 'head')], f'{prefix}Hair_Long', rig, 'hair', item='hair_long'))

	# Colita: casco + cola en cadena de esferas + gomita.
	pieces = [cap('pony_cap', H)]
	for k, (y, z, r) in enumerate(((0.215, 1.06, 0.062), (0.265, 0.97, 0.072), (0.275, 0.86, 0.066), (0.26, 0.77, 0.048))):
		pieces.append(toy.sphere(f'pony_{k}', radius=r, loc=(0, y, z), mat=H, segments=16, rings=10))
	for k, x in enumerate((-0.07, 0.07)):
		pieces.append(toy.sphere(f'pony_bang_{k}', radius=0.06, scale=(1.3, 0.75, 0.9), loc=(x, -0.165, 1.08), mat=H, segments=14, rings=10))
	hair = fuse_hair(pieces, 'pony', H, cut_below=0.7)
	band = toy.torus('pony_band', major=0.05, minor=0.017, loc=(0, 0.24, 1.02), rot=(DEG(70), 0, 0), mat=m['Accent'])
	out.append(part([(hair, 'head'), (band, 'head')], f'{prefix}Hair_Ponytail', rig, 'hair', item='hair_ponytail'))

	# Dos rodetes.
	pieces = [cap('buns_cap', H)]
	for side in (1, -1):
		pieces.append(toy.sphere(f'bun_{side}', radius=0.088, loc=(side * 0.135, 0.02, 1.2), mat=H, segments=18, rings=12))
	for k, x in enumerate((-0.07, 0.07)):
		pieces.append(toy.sphere(f'buns_bang_{k}', radius=0.06, scale=(1.3, 0.75, 0.9), loc=(x, -0.165, 1.08), mat=H, segments=14, rings=10))
	hair = fuse_hair(pieces, 'buns', H, cut_below=0.9)
	bands = [toy.torus(f'bun_band_{side}', major=0.07, minor=0.014, loc=(side * 0.125, 0.02, 1.13), rot=(DEG(side * -20), 0, 0), mat=m['Accent']) for side in (1, -1)]
	out.append(part([(hair, 'head')] + [(b, 'head') for b in bands], f'{prefix}Hair_Buns', rig, 'hair', item='hair_buns'))

	# Rulos: muchas bolitas sobre un casco, fundidas en una masa con textura de rulo.
	pieces = [cap('curly_cap', H, radius=0.225, scale=(1.08, 1.06, 1.08))]
	golden = math.pi * (3 - math.sqrt(5))
	for k in range(70):
		yk = 1 - (k / 69) * 2
		rk = math.sqrt(max(0.0, 1 - yk * yk))
		theta = golden * k
		px, py, pz = math.cos(theta) * rk, math.sin(theta) * rk, yk
		x, y, z = px * 0.235, py * 0.235 + 0.012, pz * 0.25 + 1.0
		if z < 0.9 or (y < -0.12 and z < 1.08):
			continue
		pieces.append(toy.sphere(f'curl_{k}', radius=0.055, loc=(x, y, z), mat=H, segments=10, rings=8))
	out.append(part([(fuse_hair(pieces, 'curly', H, cut_below=0.88, voxel=0.0095), 'head')], f'{prefix}Hair_Curly', rig, 'hair', item='hair_curly'))
	return out


# ----------------------------------------------------------------- ropa -----

GROW = 1.06  # la ropa queda apenas más grande que el cuerpo (no se "pelea" con la piel)


def tops(rig, kind, m, prefix=''):
	shape = BODY_SHAPES[kind]
	ax = arm_x(kind)
	T = m['Top']
	out = []

	def shell(name):
		return (tapered(name, 0.17, 0.43, (0, 0, 0.615), shape, T, grow=GROW), 'spine')

	def sleeves(length):
		res = []
		for side, bone in ((1, 'arm_L'), (-1, 'arm_R')):
			top_z = 0.75
			res.append((toy.capsule(f'sleeve_{side}', radius=0.06, height=length, loc=(ax * side, 0, top_z - length / 2 + 0.03), mat=T), bone))
		return res

	out.append(part([shell('tee')] + sleeves(0.17), f'{prefix}Top_Tee_{kind}', rig, 'top', kind, 'top_tee'))
	out.append(part([shell('tank')], f'{prefix}Top_Tank_{kind}', rig, 'top', kind, 'top_tank'))

	hood = [shell('hoodie')] + sleeves(0.33)
	hood.append((toy.sphere('hood', radius=0.17, scale=(1.15, 0.7, 0.55), loc=(0, 0.12, 0.84), mat=T), 'spine'))
	hood.append((toy.rounded_box('pocket', size=(0.2, 0.05, 0.09), loc=(0, -0.145, 0.53), radius=0.03, mat=T), 'spine'))
	for s in (1, -1):
		hood.append((toy.capsule(f'string_{s}', radius=0.008, height=0.1, loc=(s * 0.035, -0.15, 0.73), mat=m['Accent'], segments=8, rings=6), 'spine'))
	out.append(part(hood, f'{prefix}Top_Hoodie_{kind}', rig, 'top', kind, 'top_hoodie'))

	dress = [shell('dress')] + sleeves(0.12)
	skirt = toy.cone('dress_skirt', r1=0.27 * shape['hips'], r2=0.17 * shape['hips'], depth=0.26, loc=(0, 0, 0.33), mat=T, segments=28, bevel=0.04)
	skirt.scale = (1, 0.86, 1)
	dress.append((skirt, 'hips'))
	dress.append((toy.torus('dress_belt', major=0.17 * shape['hips'], minor=0.014, loc=(0, 0, 0.47), mat=m['Accent']), 'hips'))
	out.append(part(dress, f'{prefix}Top_Dress_{kind}', rig, 'top', kind, 'top_dress', hides='bottom'))
	return out


def bottoms(rig, kind, m, prefix=''):
	shape = BODY_SHAPES[kind]
	B = m['Bottom']
	out = []

	def pelvis(name):
		return (tapered(name, 0.163, 0.2, (0, 0, 0.43), shape, B, bottom=shape['hips'], top=shape['hips'], grow=GROW), 'hips')

	def legs(length, radius=0.066):
		res = []
		for side, bone in ((1, 'leg_L'), (-1, 'leg_R')):
			res.append((toy.capsule(f'pant_{side}', radius=radius, height=length, loc=(side * 0.088, 0, 0.4 - length / 2 + 0.02), mat=B), bone))
		return res

	out.append(part([pelvis('pants')] + legs(0.33), f'{prefix}Bottom_Pants_{kind}', rig, 'bottom', kind, 'bottom_pants'))
	out.append(part([pelvis('shorts')] + legs(0.15, 0.07), f'{prefix}Bottom_Shorts_{kind}', rig, 'bottom', kind, 'bottom_shorts'))
	skirt = toy.cone('skirt', r1=0.25 * shape['hips'], r2=0.17 * shape['hips'], depth=0.2, loc=(0, 0, 0.33), mat=B, segments=28, bevel=0.035)
	skirt.scale = (1, 0.86, 1)
	out.append(part([pelvis('skirt_top'), (skirt, 'hips')], f'{prefix}Bottom_Skirt_{kind}', rig, 'bottom', kind, 'bottom_skirt'))
	return out


def shoes(rig, m, prefix=''):
	out = []
	pieces = []
	for side, bone in ((1, 'leg_L'), (-1, 'leg_R')):
		x = side * 0.088
		pieces.append((toy.rounded_box(f'sneaker_{side}', size=(0.13, 0.215, 0.1), loc=(x, -0.03, 0.07), radius=0.046, mat=m['Shoes']), bone))
		pieces.append((toy.rounded_box(f'sneaker_sole_{side}', size=(0.126, 0.205, 0.03), loc=(x, -0.03, 0.016), radius=0.013, mat=m['Sole']), bone))
	out.append(part(pieces, f'{prefix}Shoes_Sneakers', rig, 'shoes', item='shoes_sneakers'))
	pieces = []
	for side, bone in ((1, 'leg_L'), (-1, 'leg_R')):
		x = side * 0.088
		pieces.append((toy.rounded_box(f'boot_{side}', size=(0.14, 0.22, 0.2), loc=(x, -0.025, 0.115), radius=0.055, mat=m['Shoes']), bone))
		pieces.append((toy.torus(f'boot_cuff_{side}', major=0.072, minor=0.018, loc=(x, 0, 0.215), mat=m['Sole']), bone))
		pieces.append((toy.rounded_box(f'boot_sole_{side}', size=(0.134, 0.215, 0.035), loc=(x, -0.025, 0.018), radius=0.014, mat=m['Sole']), bone))
	out.append(part(pieces, f'{prefix}Shoes_Boots', rig, 'shoes', item='shoes_boots'))
	return out


# ---------------------------------------------------------------- armado ----

def build_modular():
	m = mats()
	rig = avatar.build_armature()
	rig.name = 'AvatarModular'
	parts = []
	for kind in ('M', 'F'):
		parts.append(body_parts(rig, kind, m))
		parts += tops(rig, kind, m)
		parts += bottoms(rig, kind, m)
	parts += eyes_parts(rig, m)
	parts += brows_parts(rig, m)
	parts += mouth_parts(rig, m)
	parts.append(cheeks_part(rig, m))
	parts += hair_parts(rig, m)
	parts += shoes(rig, m)
	rig.animation_data_create()
	for make in avatar.ANIMATIONS:
		make(rig)
	rig.animation_data.action = None
	avatar.reset_pose(rig)
	return rig, parts


# Un "look" = qué pieza va en cada lugar + colores. Sirve para la vista previa y como presets.
LOOKS = {
	'nico': {'body': 'M', 'hair': 'hair_spiky', 'eyes': 'eyes_dot', 'brows': 'brows_thick', 'mouth': 'mouth_smile', 'top': 'top_hoodie', 'bottom': 'bottom_pants', 'shoes': 'shoes_sneakers',
		'colors': {'skin': (0.98, 0.78, 0.62), 'hair': (0.16, 0.10, 0.08), 'top': 'coral', 'bottom': (0.20, 0.24, 0.45)}},
	'sofi': {'body': 'F', 'hair': 'hair_ponytail', 'eyes': 'eyes_lash', 'brows': 'brows_arch', 'mouth': 'mouth_smile', 'cheeks': 'cheeks_blush', 'top': 'top_tee', 'bottom': 'bottom_skirt', 'shoes': 'shoes_sneakers',
		'colors': {'skin': (0.96, 0.74, 0.58), 'hair': (0.55, 0.30, 0.14), 'top': 'mint', 'bottom': 'sofa_purple', 'sole': 'mustard'}},
	'lu': {'body': 'F', 'hair': 'hair_buns', 'eyes': 'eyes_big', 'brows': 'brows_line', 'mouth': 'mouth_grin', 'cheeks': 'cheeks_blush', 'top': 'top_dress', 'shoes': 'shoes_boots',
		'colors': {'skin': (0.62, 0.42, 0.29), 'hair': (0.08, 0.06, 0.06), 'top': 'mustard', 'shoes': (0.35, 0.20, 0.14), 'sole': 'cream'}},
	'tomi': {'body': 'M', 'hair': 'hair_curly', 'eyes': 'eyes_happy', 'brows': 'brows_line', 'mouth': 'mouth_grin', 'top': 'top_tee', 'bottom': 'bottom_shorts', 'shoes': 'shoes_sneakers',
		'colors': {'skin': (0.45, 0.30, 0.20), 'hair': (0.07, 0.05, 0.05), 'top': 'sky', 'bottom': (0.25, 0.32, 0.55), 'sole': 'seat_red'}},
	'mar': {'body': 'F', 'hair': 'hair_long', 'eyes': 'eyes_lash', 'brows': 'brows_line', 'mouth': 'mouth_neutral', 'top': 'top_hoodie', 'bottom': 'bottom_pants', 'shoes': 'shoes_boots',
		'colors': {'skin': (0.99, 0.84, 0.72), 'hair': (0.90, 0.72, 0.35), 'top': 'sofa_purple', 'bottom': (0.15, 0.15, 0.2), 'shoes': (0.2, 0.15, 0.15), 'sole': 'cream'}},
	'juan': {'body': 'M', 'hair': 'hair_bowl', 'eyes': 'eyes_dot', 'brows': 'brows_line', 'mouth': 'mouth_neutral', 'top': 'top_tank', 'bottom': 'bottom_shorts', 'shoes': 'shoes_sneakers',
		'colors': {'skin': (0.85, 0.62, 0.45), 'hair': (0.30, 0.17, 0.10), 'top': 'seat_red', 'bottom': (0.25, 0.35, 0.25)}},
}


def build_look(name, x=0.0):
	"""Arma UN avatar con un look (para vista previa): sólo las piezas elegidas, colores propios."""
	look = LOOKS[name]
	m = mats(f'_{name}')
	colors = look.get('colors', {})
	for key, mat_key in (('skin', 'Skin'), ('hair', 'Hair'), ('top', 'Top'), ('bottom', 'Bottom'), ('shoes', 'Shoes'), ('sole', 'Sole')):
		if key in colors:
			c = colors[key]
			c = toy.PALETTE[c] if isinstance(c, str) else c
			bsdf = next(n for n in m[mat_key].node_tree.nodes if n.type == 'BSDF_PRINCIPLED')
			bsdf.inputs['Base Color'].default_value = tuple(toy.srgb_to_linear(v) for v in c) + (1.0,)
	rig = avatar.build_armature()
	rig.name = f'Look_{name}'
	kind = look['body']
	prefix = f'{name}_'
	keep = []
	keep.append(body_parts(rig, kind, m, prefix))
	slots = {
		'top': lambda: tops(rig, kind, m, prefix), 'bottom': lambda: bottoms(rig, kind, m, prefix),
		'eyes': lambda: eyes_parts(rig, m, prefix), 'brows': lambda: brows_parts(rig, m, prefix),
		'mouth': lambda: mouth_parts(rig, m, prefix), 'hair': lambda: hair_parts(rig, m, prefix),
		'shoes': lambda: shoes(rig, m, prefix), 'cheeks': lambda: [cheeks_part(rig, m, prefix)],
	}
	for slot, make in slots.items():
		wanted = look.get(slot)
		for mesh in make():
			if mesh.get('pelacord_item') == wanted:
				keep.append(mesh)
			else:
				bpy.data.objects.remove(mesh, do_unlink=True)
	rig.location.x = x
	return rig


# --------------------------------------------------------------- catálogo ---

ITEM_NAMES = {
	'hair_bowl': 'Flequillo clásico', 'hair_spiky': 'Pinchos', 'hair_long': 'Pelo largo', 'hair_ponytail': 'Colita',
	'hair_buns': 'Dos rodetes', 'hair_curly': 'Rulos', 'eyes_dot': 'Ojitos', 'eyes_lash': 'Pestañas', 'eyes_happy': 'Ojos felices',
	'eyes_big': 'Ojos grandes', 'brows_line': 'Cejas finas', 'brows_thick': 'Cejas gruesas', 'brows_arch': 'Cejas arqueadas',
	'mouth_neutral': 'Boca tranqui', 'mouth_smile': 'Sonrisa', 'mouth_grin': 'Sonrisota', 'cheeks_blush': 'Cachetes rosados',
	'top_tee': 'Remera', 'top_tank': 'Musculosa', 'top_hoodie': 'Buzo con capucha', 'top_dress': 'Vestido',
	'bottom_pants': 'Pantalón', 'bottom_shorts': 'Bermuda', 'bottom_skirt': 'Pollera', 'shoes_sneakers': 'Zapatillas', 'shoes_boots': 'Botas',
}
# Paletas para el editor de personaje (hex sRGB). El pelo tiene naturales y de fantasía.
PALETTES = {
	'hair': ['#1a1210', '#3b2418', '#5c3a21', '#8a5a2b', '#c48a45', '#e6c27a', '#f2e2b0', '#b8b8bc', '#f4f4f4',
		'#a8322a', '#e2572d', '#ff8fb8', '#b06cff', '#4f7dff', '#3fc2c9', '#5ccf6b'],
	'skin': ['#fde3d0', '#fbd2b4', '#f3bd96', '#e0a476', '#c9875a', '#a86a43', '#86512f', '#5e3720', '#3f2415'],
	'clothes': ['#f4f4f4', '#222026', '#8a5cff', '#f5b326', '#ff7350', '#6bc7ff', '#d91f2e', '#66e6b3', '#ff8fb8',
		'#2f3b78', '#4a7a46', '#8a5a2b', '#f2e2b0', '#3fc2c9'],
}

# Lo básico es gratis (para que nadie arranque "pelado"); lo demás se compra con monedas.
FREE = {'hair_bowl', 'hair_long', 'eyes_dot', 'brows_line', 'mouth_neutral', 'top_tee', 'bottom_pants', 'shoes_sneakers'}
PRICES = {'hair': 120, 'eyes': 60, 'brows': 40, 'mouth': 60, 'cheeks': 50, 'top': 150, 'bottom': 120, 'shoes': 100}


def wardrobe_catalog(parts):
	seen = {}
	for mesh in parts:
		item = mesh.get('pelacord_item')
		slot = mesh.get('pelacord_slot')
		if slot == 'body' or item in seen:
			if item in seen:
				seen[item]['meshes'].append(mesh.name)
			continue
		seen[item] = {
			'id': item, 'name': ITEM_NAMES.get(item, item), 'slot': slot,
			'price': 0 if item in FREE else PRICES.get(slot, 100),
			'recolor': {'hair': 'Hair', 'top': 'Top', 'bottom': 'Bottom', 'shoes': 'Shoes'}.get(slot),
			'meshes': [mesh.name],
		}
		if mesh.get('pelacord_hides'):
			seen[item]['hides'] = mesh['pelacord_hides']
	return list(seen.values())


if __name__ == '__main__':
	toy.reset_scene()
	rig, parts = build_modular()
	toy.export_glb('avatar_modular.glb', objects=[rig] + parts, animations=True)
	path = os.path.join(toy.ROOT, 'public', 'catalog_wardrobe.json')
	with open(path, 'w', encoding='utf-8') as fh:
		json.dump({'items': wardrobe_catalog(parts), 'palettes': PALETTES, 'looks': {k: {s: v for s, v in look.items() if s != 'colors'} for k, look in LOOKS.items()}}, fh, ensure_ascii=False, indent=1)
	print('[pelacord-3d] catálogo', path)
