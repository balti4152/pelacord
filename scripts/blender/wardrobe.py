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

import bpy

sys.path.insert(0, os.path.dirname(__file__))
from chibi import Chibi, animate  # noqa: E402
import hair_assets  # noqa: E402
from organic import ellipsoid, line, loft, sweep  # noqa: E402
import toy  # noqa: E402

DEG = math.radians

MATS = {}


def mats(suffix=''):
	key = suffix
	if key in MATS and all(m.name in bpy.data.materials for m in MATS[key].values()):
		return MATS[key]
	MATS[key] = {
		'Skin': toy.material('Skin' + suffix, (0.98, 0.78, 0.62), roughness=.60),
		'Hair': toy.material('Hair' + suffix, (0.30, 0.17, 0.10), roughness=.65),
		'Top': toy.material('Top' + suffix, 'sofa_purple'),
		'Bottom': toy.material('Bottom' + suffix, (0.22, 0.28, 0.52)),
		'Shoes': toy.material('Shoes' + suffix, 'white'),
		'Sole': toy.material('Sole' + suffix, 'coral'),
		'Ink': toy.material('Ink', (.077, .048, .087), roughness=.26),
		'Accent': toy.material('Accent', 'cream'),
		'White': toy.material('EyeWhite', 'white', roughness=0.5),
		'Warm': toy.material('Warm detail', (.68, .32, .31)),
		'EyeGlow': toy.material('Eye bounce', (.51, .56, .66)),
		'Blush': toy.material('Blush', (1.0, 0.55, 0.6)),
	}
	return MATS[key]


def part(pieces, name, rig, slot, body='any', item=None, hides=None):
	"""Une piezas (cada una ya asignada a su hueso) en una malla esquelética de la pieza."""
	for obj, bone in pieces:
		if bone is not None:
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


# --------------------------------------------------------- fitted wardrobe ---

def face_point(base, x, z, forward=.0):
	return (x, base.front_y(x, z, -.28) - forward, z)


def body_parts(base, rig, kind, m, prefix=''):
	nose = ellipsoid('Button nose', face_point(base, 0, .995, .006), (.030, .029, .022), m['Skin'])
	return part([(base.body(kind, m['Skin']), None), (nose, 'head')], f'{prefix}Body_{kind}', rig,
		'body', kind, f'body_{kind.lower()}')


def eyes_parts(base, rig, m, prefix=''):
	result = []
	for variant, w, height in (('dot', .030, .039), ('lash', .035, .043), ('happy', .035, .024), ('big', .043, .052)):
		pieces = []
		for s, bone in ((1, 'eye_L'), (-1, 'eye_R')):
			x, z = s * .098, 1.070
			if variant == 'happy':
				pieces.append((line('Happy lid', [face_point(base, x + dx, z + dz, .009)
					for dx, dz in ((-.034, -.005), (-.016, .015), (.015, .018), (.036, -.002))],
					.009, m['Ink']), bone))
				continue
			_, y, _ = face_point(base, x, z, .003)
			pieces.extend([
				(ellipsoid('Glossy eye', (x, y, z), (w, .024, height), m['Ink']), bone),
				(ellipsoid('Eye catchlight', (x - .010, y - .023, z + .013), (.009, .003, .011), m['White']), bone),
				(ellipsoid('Bounce light', (x + .010, y - .022, z - .014), (.0045, .0028, .005), m['EyeGlow']), bone),
			])
			if variant == 'lash':
				for i in range(2):
					pieces.append((line('Lash', [face_point(base, x + s * dx, z + dz - .010 * i, .011)
						for dx, dz in ((.020, .028), (.034 + i * .006, .042), (.047 + i * .006, .046))],
						.006, m['Ink']), bone))
		result.append(part(pieces, f'{prefix}Eyes_{variant.title()}', rig, 'eyes', item='eyes_' + variant))
	return result


def brows_parts(base, rig, m, prefix=''):
	out = []
	for variant, radius, arch in (('line', .008, .008), ('thick', .013, .012), ('arch', .007, .023)):
		pieces = [(line('Brow', [face_point(base, s * x, z, .007) for x, z in
			((.048, 1.144), (.081, 1.144 + arch), (.117, 1.143 + arch * .6), (.142, 1.139))],
			radius, m['Ink']), 'head') for s in (-1, 1)]
		out.append(part(pieces, f'{prefix}Brows_{variant.title()}', rig, 'brows', item='brows_' + variant))
	return out


def mouth_parts(base, rig, m, prefix=''):
	out = []
	for variant in ('neutral', 'smile', 'grin'):
		if variant == 'grin':
			x, y, z = face_point(base, 0, .939, .004)
			pieces = [
				ellipsoid('Open smile', (x, y, z), (.056, .022, .029), m['Ink']),
				ellipsoid('Tongue', (x, y - .018, z - .014), (.026, .006, .010), m['Blush']),
			]
		else:
			w, lift = (.031, .010) if variant == 'neutral' else (.050, .023)
			pieces = [line('Smile', [face_point(base, dx * w, .927 + dz * lift, .007)
				for dx, dz in ((-1, 1), (-.5, .22), (0, 0), (.5, .22), (1, 1))], .007, m['Ink'])]
		out.append(part([(piece, 'mouth') for piece in pieces], f'{prefix}Mouth_{variant.title()}',
			rig, 'mouth', item='mouth_' + variant))
	return out


def cheeks_part(base, rig, m, prefix=''):
	pieces = []
	for s in (-1, 1):
		x, z = s * .184, 1.011
		blush = ellipsoid('Soft cheek', face_point(base, x, z, -.003), (.050, .012, .024), m['Blush'])
		blush.rotation_euler.z = s * DEG(27)
		pieces.append((blush, 'head'))
		for i in range(3):
			pieces.append((ellipsoid('Freckle', face_point(base, x + s * .014 * (i - 1),
				z + .011 + .006 * (i % 2), .004), (.0037, .003, .0037), m['Warm']), 'head'))
	return part(pieces, f'{prefix}Cheeks_Blush', rig, 'cheeks', item='cheeks_blush')


def hair_parts(base, rig, m, prefix=''):
	hair = m['Hair']
	out = []

	def lock(label, rows):
		x, y, z, _, d = rows[0]
		root = (x * .92, y * .82, 1.11 + (z - 1.11) * .86, .008, d)
		return sweep(label, [root, *rows], hair, segments=12, detail=5)

	def fringe(guides, indices, spacing):
		return [lock('Carved fringe', [(x + j * spacing * (1 + .09 * i), y + abs(j) * .013,
			z - abs(j) * .010, r, d) for i, (x, y, z, r, d) in enumerate(guides)]) for j in indices]

	def style(key, pieces, edge=.0):
		cap = base.garment('Fitted scalp', 'M', hair,
			[lambda p: p.z - (.317 + .077 * max(0, -p.y) / .135 - .080 * max(0, p.y) / .125
				+ edge + .016 * math.sin(p.x * 19) * max(0, -p.y) / .135)], .029)
		cap.vertex_groups.clear()
		volume = cap.modifiers.new('Scalp volume', 'SOLIDIFY')
		volume.thickness = .066
		sub = cap.modifiers.new('Rounded hairline', 'SUBSURF')
		sub.levels = 1
		toy.apply_modifiers(cap)
		accents = [mesh for mesh in pieces if mesh.data.materials[0] != hair]
		clumps = [cap, *(mesh for mesh in pieces if mesh.data.materials[0] == hair)]
		for mesh in clumps:
			toy.apply_transforms(mesh)
		sculpt = toy.join(clumps, key + ' sculpt')
		fuse = sculpt.modifiers.new('Fused sculpt', 'REMESH')
		fuse.mode = 'VOXEL'
		fuse.voxel_size = .012
		soften = sculpt.modifiers.new('Polished finish', 'SMOOTH')
		soften.factor = .61
		soften.iterations = 8
		toy.apply_modifiers(sculpt)
		detail = sculpt.modifiers.new('Game resolution', 'DECIMATE')
		detail.ratio = min(1.0, 3800 / max(1, len(sculpt.data.polygons)))
		toy.apply_modifiers(sculpt)
		toy.smooth(sculpt, 180)
		out.append(part([(sculpt, 'head'), *((mesh, 'head') for mesh in accents)], f'{prefix}Hair_{key.title()}',
			rig, 'hair', item='hair_' + key))

	style('bowl', fringe([
		(-.117, -.126, 1.387, .052, .85), (-.103, -.238, 1.309, .065, .9),
		(-.067, -.312, 1.234, .062, .95), (.018, -.325, 1.158, .007, .9),
	], range(-2, 3), .063))
	style('spiky', [
		lock('Swept crest', [(x, -.239, 1.307, .067, 1), (x + .027, -.196, 1.408, .076, .9),
			(x + .068, -.073, 1.474 + lift, .062, .9), (x + .108, .033, 1.472 + lift, .003, .75)])
		for x, lift in ((-.211, -.034), (-.116, .012), (-.029, .061), (.083, .031), (.171, -.022))
	], .007)

	long = [lock('Side wave', [
		(s * .206, -.026, 1.376, .072, 1), (s * .322, -.147, 1.216, .082, .95),
		(s * .350, -.151, 1.040, .073, .91), (s * .332, -.121, .887, .069, .98),
		(s * .367, -.120, .768, .005, .9),
	]) for s in (-1, 1)]
	long += [lock('Back wave', [(x, .214, 1.326, .071, 1), (x * 1.09, .316, 1.113, .117, .86),
		(x * 1.25, .245, .910, .091, .93), (x * 1.37 + .028, .185, .779, .005, .85)])
		for x in (-.215, -.124, -.021, .100, .207)]
	style('long', long + fringe([
		(.087, -.121, 1.386, .063, .9), (.031, -.263, 1.293, .069, .89),
		(-.068, -.321, 1.241, .058, .78), (-.185, -.294, 1.177, .003, .68),
	], range(-1, 2), .065))

	style('ponytail', [
		lock('Ponytail', [(0, .244, 1.301, .062, 1), (.018, .353, 1.370, .070, .91),
			(.045, .451, 1.285, .109, .83), (.070, .482, 1.112, .094, .94),
			(.146, .398, .981, .038, .96), (.172, .335, .948, .003, 1)]),
		lock('Side fringe', [(-.033, -.196, 1.343, .061, .92), (-.158, -.306, 1.255, .063, .9),
			(-.249, -.283, 1.147, .006, .6)]),
		toy.torus('Hair tie', major=.063, minor=.016, loc=(.016, .338, 1.355),
			rot=(DEG(71), 0, 0), mat=m['Accent'], major_seg=24, minor_seg=8),
	], .007)

	buns = []
	for s in (-1, 1):
		x = s * .262
		buns += [
			loft('Twisted bun', [(1.283, x, .052, .029, .030), (1.320, x, .057, .098, .091),
				(1.397, x * 1.08, .063, .123, .109), (1.466, x * 1.10, .073, .090, .083),
				(1.510, x * 1.08, .078, .021, .029)], hair, segments=32, flutes=.071),
			toy.torus('Bun ribbon', major=.076, minor=.014, loc=(x, .059, 1.313),
				rot=(0, s * DEG(19), 0), mat=m['Accent'], major_seg=24, minor_seg=8),
		]
	style('buns', buns + fringe([
		(-.089, -.143, 1.389, .052, .90), (-.052, -.261, 1.301, .061, .87),
		(.049, -.330, 1.228, .058, .77), (.154, -.303, 1.186, .007, .8),
	], range(-1, 2), .059))

	curls = []
	for row, (count, polar) in enumerate(((13, 1.17), (11, .80), (7, .40), (1, 0))):
		for i in range(count):
			a = 2 * math.pi * (i + .33 * row) / count
			x = .342 * math.sin(polar) * math.sin(a)
			y = -.300 * math.sin(polar) * math.cos(a) + .021
			z = 1.12 + .285 * math.cos(polar)
			r = .077 + .010 * math.cos(2.44 * i + row)
			curls.append(ellipsoid('Curl', (x, y, z), (r, r * .91, r * .89), hair, segments=16, rings=10))
	style('curly', curls, .006)

	for key in hair_assets.FIT:
		forehead = .034 if key in ('anime', 'ayato', 'wavy') else .050
		scalp = fitted(base, 'Hidden scalp', 'M', hair, (
			lambda p: p.z - (.339 + forehead * max(0, -p.y) / .135 - .055 * max(0, p.y) / .125),
		), .019)
		pieces = [scalp, (hair_assets.fitted_shape(key, hair, base.surface()), 'head')]
		if key == 'layers':
			pieces.extend((piece, 'head') for piece in fringe([
				(.010, -.125, 1.399, .068, .91), (.020, -.250, 1.351, .080, .97),
				(-.019, -.317, 1.257, .077, .93), (-.111, -.306, 1.164, .007, .85),
			], range(-2, 3), .061))
		out.append(part(pieces, f'{prefix}Hair_{key.title()}', rig, 'hair', item='hair_' + key))
	return out


def folded_skirt(name, kind, material, lower=.216, upper=.49):
	width = .278 if kind == 'F' else .262
	return loft(name, [
		(lower, 0, -.016, width * .955, .197), (lower + .024, 0, -.018, width, .226),
		(lower + .102, 0, -.023, width * .96, .233), (upper - .049, 0, -.017, .234, .218),
		(upper, 0, -.014, .224, .226),
	], material, flutes=.060, segments=32)


def fitted(base, name, kind, material, cuts, offset):
	mesh = base.garment(name, kind, material, cuts, offset)
	sub = mesh.modifiers.new('Soft fabric', 'SUBSURF')
	sub.levels = 1
	toy.apply_modifiers(mesh)
	return (mesh, None)


def sewn(base, name, kind, material, cuts, ease):
	mesh = base.garment(name, kind, material, cuts, ease, tailored=True)
	edge = mesh.modifiers.new('Fabric lining and hem', 'SOLIDIFY')
	edge.thickness = .012
	edge.offset = -1
	toy.apply_modifiers(mesh)
	return mesh, None


def tops(base, rig, kind, m, prefix=''):
	out = []
	for name, cuff, width, ease in (('tee', .106, .105, .031), ('tank', .103, .063, .025),
		('hoodie', .088, .158, .040), ('dress', .097, .102, .030)):
		pieces = [sewn(base, name, kind, m['Top'], (
			lambda p: p.z - cuff,
			lambda p: .193 + min(.035, abs(p.x) * .23) - p.z,
			lambda p: width - abs(p.x),
		), ease)]
		pieces.append((line('Neck seam', [(-.117, -.123, .742), (-.074, -.144, .710),
			(0, -.169, .690), (.074, -.144, .710), (.117, -.123, .742)], .010, m['Accent']), 'spine'))
		if name == 'tee':
			pieces.append((line('Embroidered arc', [(.035, -.172, .611), (.063, -.171, .592),
				(.092, -.151, .619)], .008, m['Accent']), 'spine'))
		if name == 'hoodie':
			pieces.extend([
				(loft('Folded hood', [(.650, 0, .087, .118, .043), (.701, 0, .131, .173, .087),
					(.752, 0, .155, .158, .086), (.780, 0, .132, .072, .035)],
					m['Top']), 'spine'),
				(loft('Kangaroo pocket', [(.458, 0, -.187, .096, .027), (.487, 0, -.202, .115, .032),
					(.536, 0, -.207, .089, .027), (.551, 0, -.189, .069, .017)],
					m['Top'], segments=20), 'spine'),
			])
			for s in (-1, 1):
				pieces.append((line('Drawcord', [(s * .058, -.151, .712), (s * .055, -.190, .646),
					(s * .032, -.226, .570 - .009 * s)], .008, m['Accent']), 'spine'))
		if name == 'dress':
			pieces.append((folded_skirt('Dress pleats', kind, m['Top']), 'hips'))
			pieces.append((line('Sash trim', [(-.204, -.117, .477), (-.112, -.210, .479),
				(0, -.246, .477), (.112, -.210, .479), (.204, -.117, .477)],
				.013, m['Accent']), 'hips'))
		out.append(part(pieces, f'{prefix}Top_{name.title()}_{kind}', rig, 'top', kind, 'top_' + name,
			hides='bottom' if name == 'dress' else None))
	return out


def bottoms(base, rig, kind, m, prefix=''):
	out = []
	for name, start in (('pants', .023), ('shorts', .039), ('skirt', None)):
		if name == 'skirt':
			pieces = [(folded_skirt('Skirt pleats', kind, m['Bottom'], lower=.238), 'hips')]
		else:
			pieces = [sewn(base, name, kind, m['Bottom'], (lambda p: p.z - start, lambda p: .119 - p.z), .023)]
		out.append(part(pieces, f'{prefix}Bottom_{name.title()}_{kind}', rig, 'bottom', kind, 'bottom_' + name))
	return out


def shoes(rig, m, prefix=''):
	out = []
	for name in ('sneakers', 'boots'):
		pieces = []
		for s, bone in ((1, 'knee_L'), (-1, 'knee_R')):
			x = s * .111
			pieces.extend([
				(loft('Padded sole', [(.005, x, -.013, .073, .087), (.018, x, -.018, .103, .120),
					(.042, x, -.021, .103, .122), (.052, x, -.021, .094, .112)], m['Sole']), bone),
				(loft('Soft toe', [(.029, x, -.019, .092, .108), (.064, x, -.025, .100, .118),
					(.101, x, -.003, .089, .104), (.134, x, .004, .081, .088),
					(.163 if name == 'boots' else .142, x, .006, .077, .084)], m['Shoes']), bone),
			])
			for i in range(2):
				pieces.append((line('Stitched lace', [(x - .036, -.097 - .020 * i, .112 - .010 * i),
					(x + .028, -.102 - .020 * i, .112 - .010 * i)], .008, m['Accent']), bone))
			if name == 'boots':
				pieces.append((loft('Boot cuff', [(.144, x, .004, .081, .089), (.160, x, .006, .089, .093),
					(.181, x, .008, .080, .090)], m['Sole'], segments=20), bone))
		out.append(part(pieces, f'{prefix}Shoes_{name.title()}', rig, 'shoes', item='shoes_' + name))
	return out


def wardrobe(base, rig, kind, m, prefix=''):
	return [
		body_parts(base, rig, kind, m, prefix),
		*tops(base, rig, kind, m, prefix),
		*bottoms(base, rig, kind, m, prefix),
	]


def details(base, rig, m, prefix=''):
	return [
		*eyes_parts(base, rig, m, prefix), *brows_parts(base, rig, m, prefix),
		*mouth_parts(base, rig, m, prefix), cheeks_part(base, rig, m, prefix),
		*hair_parts(base, rig, m, prefix), *shoes(rig, m, prefix),
	]


def build_modular():
	base = Chibi()
	try:
		m = mats()
		rig = base.rig()
		rig.name = 'AvatarModular'
		parts = wardrobe(base, rig, 'M', m) + wardrobe(base, rig, 'F', m) + details(base, rig, m)
		animate(rig)
		return rig, parts
	finally:
		base.cleanup()


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
	"""One complete preset using the same rig and surfaces as the runtime."""
	look = LOOKS[name]
	m = mats(f'_{name}')
	for key, mat_key in (('skin', 'Skin'), ('hair', 'Hair'), ('top', 'Top'), ('bottom', 'Bottom'), ('shoes', 'Shoes'), ('sole', 'Sole')):
		if key in look['colors']:
			color = look['colors'][key]
			color = toy.PALETTE[color] if isinstance(color, str) else color
			bsdf = next(n for n in m[mat_key].node_tree.nodes if n.type == 'BSDF_PRINCIPLED')
			bsdf.inputs['Base Color'].default_value = tuple(toy.srgb_to_linear(v) for v in color) + (1.0,)
	base = Chibi()
	try:
		rig = base.rig()
		rig.name = f'Look_{name}'
		pieces = wardrobe(base, rig, look['body'], m, name + '_') + details(base, rig, m, name + '_')
		for mesh in pieces:
			slot = mesh.get('pelacord_slot')
			if slot != 'body' and mesh.get('pelacord_item') != look.get(slot):
				bpy.data.objects.remove(mesh, do_unlink=True)
		rig.location.x = x
		return rig
	finally:
		base.cleanup()


# --------------------------------------------------------------- catálogo ---

ITEM_NAMES = {
	'hair_anime': 'Corto en capas', 'hair_sidepart': 'Raya al costado', 'hair_layers': 'Melena en capas',
	'hair_ayato': 'Flequillo largo', 'hair_highpony': 'Colita alta', 'hair_wavy': 'Ondas y flequillo',
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
FREE = {'eyes_dot', 'brows_line', 'mouth_neutral', 'top_tee', 'bottom_pants', 'shoes_sneakers'}
PRICES = {'eyes': 60, 'brows': 40, 'mouth': 60, 'cheeks': 50, 'top': 150, 'bottom': 120, 'shoes': 100}


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
			'price': 0 if slot == 'hair' or item in FREE else PRICES.get(slot, 100),
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
