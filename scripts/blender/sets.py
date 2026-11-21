"""
Escenarios de PelaCord: living, cine y fogata (estilo juguete, iluminación "cozy").

Cada uno es un GLB en public/models/:
  room_living.glb · room_cinema.glb · room_campfire.glb · ui_props.glb

Convenciones para la app (Three.js):
- `Seat_*`  (empties con extra pelacord_seat=true): dónde se sienta un avatar. Origen = superficie
  del asiento; el -Y local de Blender (+Z en glTF) mira hacia adelante, igual que el avatar.
- `Screen`  : la pantalla; su material se llama `ScreenMat` (la app le pone el video como textura).
- `Spawn`   : dónde aparece la gente al entrar.
- Luces puntuales cálidas exportadas como KHR_lights_punctual (lámparas, apliques, fogata).
- Fogata: animación `Flicker` (la llama late suave).
"""
import math
import os
import random
import sys

import bpy

sys.path.insert(0, os.path.dirname(__file__))
import toy  # noqa: E402

DEG = math.radians


def screen_mat():
	# Casi negro con un leve brillo: así se ve "apagada" hasta que la app le pone el video.
	return toy.material('ScreenMat', (0.06, 0.06, 0.09), roughness=0.4, emission=0.4, emission_color=(0.25, 0.25, 0.4))


def room_shell(width, depth, wall_color, floor_color, height=3.0, walls=('back', 'left', 'right')):
	floor = toy.rounded_box('Floor', size=(width, depth, 0.2), loc=(0, 0, -0.1), radius=0.06, mat=toy.material(f'Floor_{floor_color}', floor_color))
	parts = [floor]
	wall_mat = toy.material(f'Wall_{wall_color}', wall_color)
	if 'back' in walls:
		parts.append(toy.rounded_box('WallBack', size=(width, 0.2, height), loc=(0, -depth / 2 - 0.1, height / 2), radius=0.06, mat=wall_mat))
	for side, name in ((-1, 'left'), (1, 'right')):
		if name in walls:
			parts.append(toy.rounded_box(f'Wall_{name}', size=(0.2, depth, height), loc=(side * (width / 2 + 0.1), 0, height / 2), radius=0.06, mat=wall_mat))
	# Zócalo de un tono más claro: da forma a la habitación sin texturas.
	trim = toy.material(f'Trim_{wall_color}', tuple(min(1, c * 1.8 + 0.04) for c in toy.PALETTE[wall_color]))
	if 'back' in walls:
		parts.append(toy.rounded_box('TrimBack', size=(width, 0.06, 0.16), loc=(0, -depth / 2 + 0.02, 0.08), radius=0.02, mat=trim))
	return toy.join(parts, 'Room')


def stars(count, radius, min_z, seed=7, name='Stars'):
	"""Puntitos blancos flotando (estrellitas sutiles de las escenas nocturnas)."""
	random.seed(seed)
	glow = toy.material('StarGlow', 'white', emission=6.0)
	dots = []
	for i in range(count):
		theta = random.uniform(0, math.tau)
		phi = random.uniform(math.radians(8), math.radians(75))
		r = radius * random.uniform(0.85, 1.0)
		loc = (r * math.cos(theta) * math.cos(phi), r * math.sin(theta) * math.cos(phi), min_z + r * math.sin(phi))
		dots.append(toy.sphere(f'star_{i}', radius=random.uniform(0.02, 0.05) * radius / 10, loc=loc, mat=glow, segments=6, rings=4))
	for d in dots:
		toy.apply_transforms(d)
	return toy.join(dots, name)


def table_lamp(name, loc):
	shade = toy.material('LampShade', 'cream', roughness=0.7, emission=4.0, emission_color=(1.0, 0.78, 0.45))
	base_mat = toy.material('LampBase', 'mustard')
	x, y, z = loc
	parts = [
		toy.sphere(f'{name}_base', radius=0.09, scale=(1, 1, 0.7), loc=(x, y, z + 0.06), mat=base_mat, segments=18, rings=10),
		toy.cylinder(f'{name}_stem', radius=0.018, depth=0.22, loc=(x, y, z + 0.18), mat=base_mat, segments=10),
		toy.sphere(f'{name}_shade', radius=0.14, scale=(1, 1, 0.82), loc=(x, y, z + 0.36), mat=shade, segments=22, rings=12),
	]
	for p in parts:
		toy.apply_transforms(p)
	lamp = toy.join(parts, name)
	toy.point_light(f'{name}_Light', (x, y, z + 0.38), color=(1.0, 0.72, 0.42), energy=45, radius=0.15)
	return lamp


def sofa(name, loc, color, seats=3, facing=0.0):
	"""Sillón gordito: base, almohadones, respaldo y apoyabrazos redondeados."""
	mat = toy.material(f'Sofa_{color}', color)
	cushion = toy.material(f'Cushion_{color}', tuple(min(1, c * 1.12) for c in toy.PALETTE[color]))
	width = 0.66 * seats + 0.1
	parts = [
		toy.rounded_box(f'{name}_base', size=(width, 0.86, 0.34), loc=(0, 0, 0.2), radius=0.12, mat=mat),
		toy.rounded_box(f'{name}_back', size=(width, 0.26, 0.56), loc=(0, 0.32, 0.6), radius=0.12, mat=mat),
	]
	for side in (-1, 1):
		parts.append(toy.rounded_box(f'{name}_arm_{side}', size=(0.24, 0.88, 0.5), loc=(side * (width / 2 + 0.07), 0, 0.33), radius=0.11, mat=mat))
	seat_points = []
	for i in range(seats):
		x = (i - (seats - 1) / 2) * 0.66
		parts.append(toy.rounded_box(f'{name}_cushion_{i}', size=(0.62, 0.66, 0.15), loc=(x, -0.06, 0.44), radius=0.07, mat=cushion))
		parts.append(toy.rounded_box(f'{name}_backcushion_{i}', size=(0.6, 0.16, 0.36), loc=(x, 0.2, 0.7), radius=0.07, mat=cushion))
		seat_points.append((x, -0.08, 0.52))
	for p in parts:
		toy.apply_transforms(p)
	obj = toy.join(parts, name)
	obj.location = loc
	obj.rotation_euler = (0, 0, DEG(facing))
	for i, (x, y, z) in enumerate(seat_points):
		toy.mark_seat(f'{name}_{i + 1}', (x, y, z), parent=obj)
	return obj


def pouf(name, loc, color):
	mat = toy.material(f'Pouf_{color}', color)
	top = toy.material(f'PoufTop_{color}', tuple(min(1, c * 1.12) for c in toy.PALETTE[color]))
	parts = [
		toy.cylinder(f'{name}_body', radius=0.3, depth=0.34, loc=(0, 0, 0.17), mat=mat, segments=28, bevel=0.09),
		toy.sphere(f'{name}_top', radius=0.29, scale=(1, 1, 0.28), loc=(0, 0, 0.34), mat=top, segments=28, rings=12),
		toy.sphere(f'{name}_button', radius=0.03, scale=(1, 1, 0.5), loc=(0, 0, 0.42), mat=mat, segments=12, rings=8),
	]
	for p in parts:
		toy.apply_transforms(p)
	obj = toy.join(parts, name)
	obj.location = (loc[0], loc[1], loc[2] if len(loc) > 2 else 0.0)
	toy.mark_seat(name, (0, 0, 0.41), parent=obj)
	return obj


def plant(name, loc):
	pot = toy.material('PlantPot', 'coral')
	leaf = toy.material('PlantLeaf', (0.25, 0.65, 0.35))
	x, y, z = loc
	parts = [toy.cylinder(f'{name}_pot', radius=0.18, depth=0.32, loc=(x, y, z + 0.16), mat=pot, segments=20, bevel=0.05)]
	random.seed(hash(name) % 1000)
	for i in range(6):
		a = i / 6 * math.tau
		parts.append(toy.sphere(f'{name}_leaf_{i}', radius=0.13, scale=(0.7, 0.7, 1.2), loc=(x + math.cos(a) * 0.11, y + math.sin(a) * 0.11, z + 0.5 + random.uniform(-0.05, 0.12)), mat=leaf, segments=12, rings=8))
	parts.append(toy.sphere(f'{name}_leaf_top', radius=0.15, scale=(0.8, 0.8, 1.3), loc=(x, y, z + 0.7), mat=leaf, segments=12, rings=8))
	for p in parts:
		toy.apply_transforms(p)
	return toy.join(parts, name)


def neon_moon(name, loc, rot=(DEG(90), 0, 0), size=0.45):
	"""Cartel de neón con forma de luna (emisión suave)."""
	glow = toy.material('NeonMoon', 'cream', emission=7.0, emission_color=(1.0, 0.9, 0.6))
	disc = toy.cylinder(f'{name}_disc', radius=size, depth=0.04, loc=loc, rot=rot, mat=glow, segments=36, bevel=0.015)
	bite = toy.cylinder(f'{name}_bite', radius=size * 0.85, depth=0.2, loc=loc, rot=rot, segments=36)
	bite.location.x += size * 0.42
	bite.location.z += size * 0.18
	mod = disc.modifiers.new('Crescent', 'BOOLEAN')
	mod.operation = 'DIFFERENCE'
	mod.object = bite
	mod.solver = 'EXACT'
	toy.apply_modifiers(disc)
	bpy.data.objects.remove(bite, do_unlink=True)
	disc.name = name
	return disc


# ---------------------------------------------------------------- Living ----

def build_living():
	room_shell(8, 7, 'night_purple', 'floor_plum')
	toy.rounded_box('Rug', size=(3.6, 2.8, 0.03), loc=(0, 0.1, 0.015), radius=0.012, mat=toy.material('Rug', (0.36, 0.26, 0.58)))
	# Pantalla grande en la pared del fondo (la app le pone el video).
	frame = toy.rounded_box('ScreenFrame', size=(3.4, 0.12, 2.0), loc=(0, -3.42, 1.55), radius=0.06, mat=toy.material('Frame', (0.08, 0.06, 0.1)))
	screen = toy.rounded_box('Screen', size=(3.2, 0.04, 1.8), loc=(0, -3.35, 1.55), radius=0.015, mat=screen_mat())
	toy.rounded_box('TVStand', size=(2.4, 0.5, 0.45), loc=(0, -3.1, 0.225), radius=0.08, mat=toy.material('Stand', 'wood_dark'))

	sofa('Sofa', (0, 1.25, 0), 'sofa_purple', seats=3)
	# facing positivo: gira hacia +X, o sea hacia el centro y la pantalla (con -55 miraba a la pared).
	sofa('Armchair', (-2.3, 0.1, 0), 'mustard', seats=1, facing=55)
	pouf('Pouf_Orange', (1.9, -0.4), 'coral')
	pouf('Pouf_Blue', (2.35, 0.65), 'sky')

	# Mesa ratona redonda con lámpara (punto de luz cálida).
	wood = toy.material('Wood', 'wood')
	parts = [
		toy.cylinder('table_top', radius=0.55, depth=0.08, loc=(0, 0, 0.42), mat=wood, segments=32, bevel=0.03),
		toy.cylinder('table_leg', radius=0.07, depth=0.38, loc=(0, 0, 0.2), mat=wood, segments=14),
		toy.cylinder('table_foot', radius=0.25, depth=0.04, loc=(0, 0, 0.02), mat=wood, segments=24, bevel=0.015),
	]
	for p in parts:
		toy.apply_transforms(p)
	table = toy.join(parts, 'CoffeeTable')
	table.location = (0.1, -0.1, 0)
	table_lamp('TableLamp', (0.35, -0.2, 0.46))
	table_lamp('SideLamp', (-3.3, -1.6, 0.5))
	toy.cylinder('SideTable', radius=0.25, depth=0.5, loc=(-3.3, -1.6, 0.25), mat=wood, segments=20, bevel=0.03)

	plant('Plant', (3.4, -2.9, 0))
	neon_moon('NeonMoon', (2.4, -3.48, 2.2))
	stars(40, 3.5, 0.6, seed=3, name='FloatingSparkles').location = (0, -1.0, 0.4)
	toy.point_light('RoomFill', (0, 0.5, 2.8), color=(0.75, 0.6, 1.0), energy=120, radius=1.5)
	toy.empty('Spawn', loc=(0, 2.8, 0), rot=(0, 0, 0))
	return 'room_living.glb'


# ---------------------------------------------------------------- Cine ------

def cinema_seat(name, loc, rot_deg=0.0):
	red = toy.material('SeatRed', 'seat_red')
	dark = toy.material('SeatDark', (0.35, 0.05, 0.07))
	parts = [
		toy.rounded_box(f'{name}_base', size=(0.6, 0.62, 0.3), loc=(0, 0, 0.18), radius=0.06, mat=dark),
		toy.rounded_box(f'{name}_cushion', size=(0.56, 0.6, 0.16), loc=(0, -0.02, 0.38), radius=0.07, mat=red),
		toy.rounded_box(f'{name}_back', size=(0.58, 0.18, 0.72), loc=(0, 0.28, 0.72), radius=0.09, mat=red),
	]
	for side in (-1, 1):
		parts.append(toy.rounded_box(f'{name}_arm_{side}', size=(0.1, 0.6, 0.42), loc=(side * 0.34, 0, 0.36), radius=0.045, mat=dark))
	for p in parts:
		toy.apply_transforms(p)
	obj = toy.join(parts, name)
	obj.location = loc
	obj.rotation_euler = (0, 0, DEG(rot_deg))
	toy.mark_seat(name, (0, -0.04, 0.46), parent=obj)
	return obj


def curtain(name, x, height=4.2, width=1.4):
	mat = toy.material('Curtain', (0.62, 0.06, 0.1))
	folds = []
	count = 6
	for i in range(count):
		folds.append(toy.capsule(f'{name}_fold_{i}', radius=width / count * 0.62, height=height, loc=(x + (i - count / 2) * width / count, -5.25, height / 2), mat=mat, segments=14, rings=10))
	for f in folds:
		toy.apply_transforms(f)
	return toy.join(folds, name)


def sconce(name, loc, facing):
	glow = toy.material('SconceGlow', 'cream', emission=5.0, emission_color=(1.0, 0.75, 0.45))
	gold = toy.material('SconceGold', 'gold', roughness=0.6)
	x, y, z = loc
	plate = toy.rounded_box(f'{name}_plate', size=(0.05, 0.22, 0.34), loc=(x, y, z), radius=0.02, mat=gold)
	bowl = toy.sphere(f'{name}_bowl', radius=0.16, scale=(0.6, 1, 0.75), loc=(x - facing * 0.08, y, z + 0.04), mat=glow, segments=16, rings=10)
	for p in (plate, bowl):
		toy.apply_transforms(p)
	obj = toy.join([plate, bowl], name)
	toy.point_light(f'{name}_Light', (x - facing * 0.3, y, z + 0.1), color=(1.0, 0.7, 0.42), energy=55, radius=0.2)
	return obj


def build_cinema():
	room_shell(9, 11, 'dark_crimson', (0.12, 0.04, 0.06))
	# Pantalla gigante con marco y telón a los costados.
	toy.rounded_box('ScreenFrame', size=(6.6, 0.16, 3.4), loc=(0, -5.42, 2.4), radius=0.08, mat=toy.material('CinemaFrame', (0.06, 0.03, 0.05)))
	toy.rounded_box('Screen', size=(6.3, 0.04, 3.1), loc=(0, -5.32, 2.4), radius=0.02, mat=screen_mat())
	curtain('CurtainLeft', -3.9)
	curtain('CurtainRight', 3.9)
	toy.rounded_box('Stage', size=(8.6, 1.2, 0.4), loc=(0, -4.8, 0.2), radius=0.08, mat=toy.material('StageWood', 'wood_dark'))

	# Dos filas de butacas; la de atrás sobre una tarima (como un cine de verdad).
	step = toy.material('Step', (0.2, 0.06, 0.09))
	toy.rounded_box('Riser', size=(7.4, 1.6, 0.35), loc=(0, 2.4, 0.175), radius=0.06, mat=step)
	for row, (y, z) in enumerate(((0.2, 0.0), (2.4, 0.35))):
		for i in range(5):
			x = (i - 2) * 0.82
			cinema_seat(f'Butaca_{row + 1}_{i + 1}', (x, y, z))
	# Luces de pasillo en el piso (guía tenue).
	aisle = toy.material('AisleGlow', 'mustard', emission=3.0)
	for i in range(6):
		toy.sphere(f'aisle_{i}', radius=0.04, scale=(1, 1, 0.5), loc=(3.0, -3.2 + i * 1.2, 0.02), mat=aisle, segments=10, rings=6)
	for i, y in enumerate((-3.0, 0.0, 3.0)):
		sconce(f'SconceL_{i}', (-4.42, y, 2.4), facing=-1)
		sconce(f'SconceR_{i}', (4.42, y, 2.4), facing=1)
	# Pochoclera sobre la tarima, de detalle.
	popcorn_box = toy.material('PopcornBox', 'seat_red')
	stripes = toy.material('PopcornStripe', 'white')
	pop = toy.material('Popcorn', 'cream')
	box = toy.cone('PopcornBucket', r1=0.13, r2=0.17, depth=0.3, loc=(3.6, 2.6, 0.5), mat=popcorn_box, segments=16)
	kernels = [toy.sphere(f'pop_{i}', radius=0.06, loc=(3.6 + math.cos(i) * 0.08, 2.6 + math.sin(i) * 0.08, 0.68 + (i % 3) * 0.03), mat=pop, segments=8, rings=6) for i in range(7)]
	toy.torus('PopcornStripe', major=0.15, minor=0.012, loc=(3.6, 2.6, 0.52), mat=stripes)
	for k in kernels:
		toy.apply_transforms(k)
	toy.join(kernels, 'Popcorn')
	toy.point_light('CinemaFill', (0, 1.0, 3.6), color=(1.0, 0.5, 0.55), energy=90, radius=2.0)
	toy.empty('Spawn', loc=(3.0, 4.5, 0))
	return 'room_cinema.glb'


# ---------------------------------------------------------------- Fogata ----

def log(name, length, radius, loc, rot):
	bark = toy.material('Bark', 'wood_dark')
	inner = toy.material('LogInner', (0.85, 0.6, 0.36))
	body = toy.cylinder(f'{name}_bark', radius=radius, depth=length, mat=bark, segments=14, bevel=radius * 0.3)
	ends = [toy.cylinder(f'{name}_end_{s}', radius=radius * 0.78, depth=0.012, loc=(0, 0, s * length / 2), mat=inner, segments=14) for s in (-1, 1)]
	for p in [body] + ends:
		toy.apply_transforms(p)
	obj = toy.join([body] + ends, name)
	obj.location = loc
	obj.rotation_euler = rot
	return obj


def build_campfire():
	ground = toy.material('Ground', (0.10, 0.16, 0.20))
	toy.cylinder('Ground', radius=9, depth=0.3, loc=(0, 0, -0.15), mat=ground, segments=48, bevel=0.1)
	toy.cylinder('Clearing', radius=3.2, depth=0.02, loc=(0, 0, 0.01), mat=toy.material('Dirt', (0.22, 0.18, 0.22)), segments=40)

	# Anillo de piedras + leños cruzados.
	stone = toy.material('Stone', 'stone')
	random.seed(11)
	rocks = []
	for i in range(11):
		a = i / 11 * math.tau
		rocks.append(toy.sphere(f'rock_{i}', radius=0.16, scale=(1.1, 0.9, 0.6), loc=(math.cos(a) * 0.62, math.sin(a) * 0.62, 0.06), mat=stone, segments=10, rings=8))
		rocks[-1].rotation_euler = (0, 0, random.uniform(0, math.tau))
	for r in rocks:
		toy.apply_transforms(r)
	toy.join(rocks, 'StoneRing')
	for i in range(4):
		a = i / 4 * math.tau + 0.4
		log(f'FireLog_{i}', 0.75, 0.07, (math.cos(a) * 0.12, math.sin(a) * 0.12, 0.2), (DEG(62), 0, a + DEG(90)))

	# Llama: capas emisivas (naranja afuera, amarillo adentro) que "laten" con la animación Flicker.
	outer = toy.material('FlameOuter', 'cone_orange', roughness=0.5, emission=1.1, emission_color=(1.0, 0.28, 0.02))
	core = toy.material('FlameCore', 'mustard_sauce', roughness=0.5, emission=1.6, emission_color=(1.0, 0.72, 0.08))
	flames = []
	for i, (dx, dy, h, r) in enumerate(((0, 0, 0.7, 0.2), (0.1, 0.05, 0.5, 0.14), (-0.09, -0.04, 0.55, 0.15), (0.02, -0.1, 0.45, 0.12))):
		flames.append(toy.sphere(f'flame_{i}', radius=r, scale=(1, 1, h / r / 2), loc=(dx, dy, 0.2 + h / 2), mat=outer, segments=14, rings=10))
	flames.append(toy.sphere('flame_core', radius=0.11, scale=(1, 1, 2.2), loc=(0, 0, 0.42), mat=core, segments=14, rings=10))
	# Forma de gota: abajo redonda y arriba en punta (como una llama de juguete).
	for f in flames:
		zs = [v.co.z for v in f.data.vertices]
		low, high = min(zs), max(zs)
		for v in f.data.vertices:
			t = (v.co.z - low) / max(1e-6, high - low)
			k = 1.0 if t < 0.4 else max(0.04, 1 - (t - 0.4) / 0.6) ** 0.9
			v.co.x *= k
			v.co.y *= k
		toy.apply_transforms(f)
	flame = toy.join(flames, 'Flame')
	toy.set_origin(flame, (0, 0, 0.18))
	flame.animation_data_create()
	action = bpy.data.actions.new('Flicker')
	action.use_fake_user = True
	flame.animation_data.action = action
	for frame, sx, sz, rz in ((1, 1.0, 1.0, 0), (7, 1.06, 0.9, 6), (13, 0.95, 1.12, -4), (19, 1.04, 0.95, 3), (25, 1.0, 1.0, 0)):
		flame.scale = (sx, sx, sz)
		flame.rotation_euler = (0, 0, DEG(rz))
		flame.keyframe_insert('scale', frame=frame)
		flame.keyframe_insert('rotation_euler', frame=frame)
	toy.point_light('FireLight', (0, 0, 0.9), color=(1.0, 0.55, 0.22), energy=520, radius=0.4)

	# Troncos para sentarse alrededor (con su punto de asiento mirando al fuego).
	for i in range(4):
		a = i / 4 * math.tau + DEG(45)
		x, y = math.cos(a) * 2.0, math.sin(a) * 2.0
		bench = log(f'LogBench_{i}', 1.5, 0.2, (x, y, 0.2), (0, DEG(90), a + DEG(90)))
		facing = math.degrees(math.atan2(-x, y))  # -Y local apunta al fuego
		for k, offset in enumerate((-0.4, 0.4)):
			tx, ty = -math.sin(a) * offset, math.cos(a) * offset
			seat = toy.mark_seat(f'Log_{i + 1}_{k + 1}', (x + tx, y + ty, 0.4))
			seat.rotation_euler = (0, 0, DEG(facing + 180))

	# Arbolitos low-poly de silueta redonda alrededor.
	leaves = toy.material('PineLeaves', (0.12, 0.32, 0.28))
	trunk = toy.material('PineTrunk', 'wood_dark')
	random.seed(5)
	for i in range(9):
		a = i / 9 * math.tau + random.uniform(-0.2, 0.2)
		r = random.uniform(5.0, 7.5)
		x, y = math.cos(a) * r, math.sin(a) * r
		s = random.uniform(0.8, 1.3)
		parts = [toy.cylinder(f'tree_{i}_trunk', radius=0.12 * s, depth=0.6 * s, loc=(x, y, 0.3 * s), mat=trunk, segments=10)]
		for k in range(3):
			parts.append(toy.cone(f'tree_{i}_c{k}', r1=(0.9 - k * 0.22) * s, r2=0.08, depth=0.9 * s, loc=(x, y, (0.8 + k * 0.55) * s), mat=leaves, segments=12, bevel=0.06))
		for p in parts:
			toy.apply_transforms(p)
		toy.join(parts, f'Tree_{i}')

	stars(120, 14, 1.0, seed=21, name='Stars')
	moon = toy.material('Moon', 'cream', emission=5.0, emission_color=(1.0, 0.95, 0.8))
	toy.sphere('Moon', radius=0.8, loc=(-6, -9, 7), mat=moon, segments=20, rings=12)
	toy.empty('Spawn', loc=(0, 3.4, 0))
	return 'room_campfire.glb'


# ------------------------------------------------------- UI en el mundo -----

def build_ui():
	"""Piezas de interfaz diegética: el anillo de "sentate acá" y la placa del nombre."""
	white = toy.material('ReticleWhite', 'white', roughness=0.5, emission=2.0)
	toy.torus('SeatReticle', major=0.16, minor=0.008, mat=white, major_seg=48, minor_seg=6)
	plate = toy.material('Nameplate', (0.08, 0.06, 0.12), roughness=0.7)
	np = toy.capsule('NameplatePill', radius=0.06, height=0.44, mat=plate, segments=16, rings=10)
	np.rotation_euler = (0, DEG(90), 0)
	np.scale = (1, 0.18, 1)
	toy.apply_transforms(np)
	return 'ui_props.glb'


def build_house():
	"""Mi casa: habitación vacía (los muebles los pone cada uno con lo que compró en la tienda)."""
	room_shell(9, 8, 'night_purple', 'floor_plum')
	wood_a = toy.material('HousePlank_A', (0.55, 0.34, 0.2))
	wood_b = toy.material('HousePlank_B', (0.48, 0.29, 0.17))
	planks = [toy.rounded_box(f'hplank_{i}', size=(0.48, 8.0, 0.04), loc=(-4.25 + i * 0.5, 0, 0.02), radius=0.015, mat=wood_a if i % 2 else wood_b) for i in range(18)]
	for p in planks:
		toy.apply_transforms(p)
	toy.join(planks, 'Floor')
	# Ventana con cielo de noche y estrellitas (da profundidad aunque la casa esté vacía).
	sky = toy.material('WindowSky', 'midnight_blue', emission=0.6, emission_color=(0.15, 0.2, 0.5))
	frame = toy.material('WindowFrame', 'cream')
	toy.rounded_box('WindowFrame', size=(2.2, 0.12, 1.4), loc=(-1.6, -4.05, 1.7), radius=0.05, mat=frame)
	toy.rounded_box('WindowSky', size=(2.0, 0.06, 1.2), loc=(-1.6, -3.99, 1.7), radius=0.03, mat=sky)
	glow = toy.material('StarGlow', 'white', emission=6.0)
	random.seed(12)
	for i in range(14):
		toy.sphere(f'wstar_{i}', radius=0.02, loc=(-1.6 + random.uniform(-0.9, 0.9), -3.95, 1.7 + random.uniform(-0.5, 0.5)), mat=glow, segments=6, rings=4)
	neon_moon('HouseMoon', (2.6, -4.08, 2.1), size=0.35)
	toy.point_light('HouseFill', (0, 0.5, 3.0), color=(1.0, 0.85, 0.75), energy=320, radius=2.0)
	toy.point_light('HouseFillFront', (0, 4.2, 2.3), color=(1.0, 0.88, 0.78), energy=260, radius=2.0)
	toy.empty('Spawn', loc=(0, 3.0, 0))
	return 'room_house.glb'


SETS = {
	'living': build_living,
	'house': build_house,
	'cinema': build_cinema,
	'campfire': build_campfire,
	'ui': build_ui,
}

PREVIEWS = {
	'house': dict(target=(0, 0, 0.6), distance=8.0, height=6.0, angle_deg=180, background='night_purple', floor=False, lens=30),
	'living': dict(target=(-0.4, 0.6, 0.5), distance=3.9, height=1.9, angle_deg=30, background='night_purple', floor=False, lens=32),
	'cinema': dict(target=(0, -1.0, 1.2), distance=9.0, height=3.8, angle_deg=162, background='dark_crimson', floor=False, lens=30),
	'campfire': dict(target=(0, 0, 0.4), distance=7.2, height=3.6, angle_deg=-30, background='midnight_blue', floor=False, lens=32),
	'ui': dict(target=(0, 0, 0), distance=1.2, height=0.6, angle_deg=-20, background='night_purple', floor=False, lens=50),
}


def build_and_export(key, preview=False):
	toy.reset_scene()
	filename = SETS[key]()
	toy.export_glb(filename, animations=(key == 'campfire'), lights=True)
	if preview:
		toy.preview_rig(**PREVIEWS[key])
		# En la vista previa la luz de relleno se apaga un poco: lo que manda son las luces cálidas.
		for name in ('PreviewKey', 'PreviewRim'):
			light = bpy.data.objects.get(name)
			if light:
				light.data.energy *= 0.35
		toy.render_preview(f'room_{key}.png', resolution=(1280, 800))


if __name__ == '__main__':
	argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
	keys = [a for a in argv if a in SETS] or list(SETS)
	for key in keys:
		build_and_export(key, preview='--preview' in argv)
