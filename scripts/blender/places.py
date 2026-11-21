"""
La CIUDAD (plaza desde la que se camina a cada lugar) y la CASA DE JUEGOS (mesa redonda para 6).

  public/models/room_city.glb   · public/models/room_games.glb

Convenciones extra para la app:
  Door_<sala>   (extra pelacord_door = id de la sala): puerta de la ciudad → "E para entrar".
  Seat_Table_N  asientos de la mesa redonda (miran al centro). `GameTable`: centro de la mesa.
"""
import math
import os
import random
import sys

import bpy

sys.path.insert(0, os.path.dirname(__file__))
import sets  # noqa: E402
import toy  # noqa: E402

DEG = math.radians


def door_marker(room, loc, facing_deg):
	marker = toy.empty(f'Door_{room}', loc=loc, rot=(0, 0, DEG(facing_deg)), display='SINGLE_ARROW', size=0.6)
	marker['pelacord_door'] = room
	return marker


def facade(name, x, y, width, depth, height, wall, roof, sign, sign_color, awning, facing=0, door_room=None):
	"""Un local de la ciudad: cuerpo redondeado, puerta, toldo y cartel con luz."""
	parts = []
	wall_mat = toy.material(f'{name}_Wall', wall)
	roof_mat = toy.material(f'{name}_Roof', roof)
	body = toy.rounded_box(f'{name}_body', size=(width, depth, height), loc=(0, 0, height / 2), radius=0.25, mat=wall_mat)
	top = toy.rounded_box(f'{name}_top', size=(width + 0.3, depth + 0.3, 0.35), loc=(0, 0, height + 0.1), radius=0.12, mat=roof_mat)
	door = toy.rounded_box(f'{name}_door', size=(1.5, 0.2, 2.3), loc=(0, -depth / 2 - 0.02, 1.15), radius=0.18, mat=toy.material('DoorDark', (0.12, 0.07, 0.1)))
	frame = toy.rounded_box(f'{name}_frame', size=(1.8, 0.16, 2.55), loc=(0, -depth / 2 + 0.02, 1.25), radius=0.2, mat=roof_mat)
	awn = toy.rounded_box(f'{name}_awning', size=(width * 0.8, 0.9, 0.18), loc=(0, -depth / 2 - 0.42, 2.75), rot=(DEG(-14), 0, 0), radius=0.08, mat=toy.material(f'{name}_Awning', awning))
	windows = []
	for side in (-1, 1):
		windows.append(toy.rounded_box(f'{name}_win_{side}', size=(1.1, 0.14, 1.2), loc=(side * (width / 2 - 1.1), -depth / 2 - 0.02, 1.7), radius=0.12,
			mat=toy.material('WindowGlow', 'cream', emission=1.6, emission_color=(1.0, 0.82, 0.5))))
	parts = [body, top, frame, door, awn] + windows
	for p in parts:
		toy.apply_transforms(p)
	obj = toy.join(parts, name)
	sign_mat = toy.material(f'{name}_Sign', sign_color, emission=2.8, emission_color=toy.PALETTE[sign_color] if isinstance(sign_color, str) else sign_color)
	import shop
	text = shop.text_mesh(f'{name}_SignText', sign, 0.62, (0, -depth / 2 - 0.12, height - 0.75), sign_mat, extrude=0.05, rot=(DEG(90), 0, 0))
	text.parent = obj
	obj.location = (x, y, 0)
	obj.rotation_euler = (0, 0, DEG(facing))
	toy.point_light(f'{name}_Light', (0, 0, 0), color=(1.0, 0.78, 0.5), energy=120, radius=0.5).parent = obj
	bpy.data.objects[f'{name}_Light'].location = (0, -depth / 2 - 1.2, 3.0)
	if door_room:
		door_marker(door_room, (0, -depth / 2 - 0.9, 0), 0).parent = obj
	return obj


def street_lamp(name, x, y):
	pole = toy.material('LampPole', (0.18, 0.14, 0.24))
	glow = toy.material('StreetGlow', 'cream', emission=4.0, emission_color=(1.0, 0.8, 0.5))
	parts = [
		toy.cylinder(f'{name}_base', radius=0.16, depth=0.2, loc=(x, y, 0.1), mat=pole, segments=14, bevel=0.04),
		toy.cylinder(f'{name}_pole', radius=0.05, depth=2.8, loc=(x, y, 1.5), mat=pole, segments=10),
		toy.sphere(f'{name}_bulb', radius=0.22, loc=(x, y, 3.0), mat=glow, segments=16, rings=10),
	]
	for p in parts:
		toy.apply_transforms(p)
	toy.join(parts, name)
	toy.point_light(f'{name}_Light', (x, y, 2.9), color=(1.0, 0.75, 0.45), energy=160, radius=0.3)


def bench(name, x, y, facing):
	wood = toy.material('BenchWood', 'wood')
	iron = toy.material('BenchIron', (0.18, 0.14, 0.24))
	parts = [
		toy.rounded_box(f'{name}_seat', size=(1.6, 0.5, 0.1), loc=(0, 0, 0.45), radius=0.04, mat=wood),
		toy.rounded_box(f'{name}_back', size=(1.6, 0.1, 0.45), loc=(0, 0.24, 0.75), radius=0.04, mat=wood),
	]
	for s in (-1, 1):
		parts.append(toy.rounded_box(f'{name}_leg_{s}', size=(0.1, 0.5, 0.45), loc=(s * 0.7, 0, 0.22), radius=0.03, mat=iron))
	for p in parts:
		toy.apply_transforms(p)
	obj = toy.join(parts, name)
	obj.location = (x, y, 0)
	obj.rotation_euler = (0, 0, DEG(facing))
	for k, off in enumerate((-0.4, 0.4)):
		toy.mark_seat(f'{name}_{k + 1}', (off, -0.02, 0.5), parent=obj)
	return obj


def tree(name, x, y, s=1.0):
	trunk = toy.material('TreeTrunk', 'wood_dark')
	leaves = toy.material('TreeLeaves', (0.2, 0.5, 0.36))
	parts = [toy.cylinder(f'{name}_trunk', radius=0.14 * s, depth=1.0 * s, loc=(x, y, 0.5 * s), mat=trunk, segments=10)]
	for k, (dx, dy, dz, r) in enumerate(((0, 0, 1.45, 0.75), (0.35, 0.1, 1.2, 0.5), (-0.3, -0.15, 1.25, 0.55), (0.05, 0.25, 1.85, 0.5))):
		parts.append(toy.sphere(f'{name}_leaf_{k}', radius=r * s, loc=(x + dx * s, y + dy * s, dz * s), mat=leaves, segments=14, rings=10))
	for p in parts:
		toy.apply_transforms(p)
	toy.join(parts, name)


def build_city():
	random.seed(3)
	grass = toy.material('Grass', (0.22, 0.42, 0.3))
	stone = toy.material('Plaza', (0.62, 0.55, 0.62))
	path = toy.material('Path', (0.5, 0.44, 0.52))
	toy.rounded_box('Ground', size=(34, 28, 0.4), loc=(0, 1, -0.2), radius=0.2, mat=grass)
	toy.cylinder('PlazaCircle', radius=6.2, depth=0.06, loc=(0, 0, 0.03), mat=stone, segments=64, bevel=0.02)
	toy.rounded_box('Street', size=(30, 3.0, 0.05), loc=(0, -5.6, 0.025), radius=0.02, mat=path)
	toy.rounded_box('SidePathL', size=(3.0, 10, 0.05), loc=(-10.5, 0, 0.026), radius=0.02, mat=path)
	toy.rounded_box('SidePathR', size=(3.0, 10, 0.05), loc=(10.5, 0, 0.026), radius=0.02, mat=path)
	toy.rounded_box('TrailCamp', size=(2.4, 6, 0.05), loc=(-9.5, 7.5, 0.027), rot=(0, 0, DEG(35)), radius=0.02, mat=toy.material('Dirt', (0.38, 0.28, 0.24)))

	# Fuente en el centro.
	water = toy.material('Water', 'sky', roughness=0.3, emission=0.4)
	fountain_stone = toy.material('FountainStone', 'cream')
	toy.cylinder('FountainBase', radius=1.8, depth=0.5, loc=(0, 0, 0.25), mat=fountain_stone, segments=40, bevel=0.12)
	toy.cylinder('FountainWater', radius=1.55, depth=0.08, loc=(0, 0, 0.47), mat=water, segments=40)
	toy.cylinder('FountainColumn', radius=0.25, depth=1.2, loc=(0, 0, 0.9), mat=fountain_stone, segments=20, bevel=0.06)
	toy.sphere('FountainTop', radius=0.42, scale=(1, 1, 0.5), loc=(0, 0, 1.55), mat=water, segments=20, rings=12)

	# Locales: cine, tienda y casa de juegos al fondo; living a la izquierda; mi casa a la derecha.
	facade('Cinema', -8.0, -9.0, 6.0, 4.0, 5.0, 'dark_crimson', 'mustard', 'CINE', 'mustard', 'seat_red', facing=180, door_room='cinema')
	facade('Shop', 0.0, -9.0, 6.0, 4.0, 4.4, (0.55, 0.36, 0.85), 'cream', 'TIENDA', 'mustard', 'coral', facing=180, door_room='shop')
	facade('Games', 8.0, -9.0, 6.0, 4.0, 4.6, 'midnight_blue', 'mint', 'JUEGOS', 'mint', 'sky', facing=180, door_room='games')
	facade('Lounge', -13.0, 1.0, 5.0, 4.0, 4.0, (0.85, 0.5, 0.35), 'cream', 'LIVING', 'cream', 'mustard', facing=90, door_room='living')

	# Mi casa: casita con techo a dos aguas.
	house_wall = toy.material('HouseWall', (0.98, 0.86, 0.7))
	roof = toy.material('HouseRoof', 'seat_red')
	parts = [
		toy.rounded_box('home_body', size=(4.5, 4.0, 3.0), loc=(0, 0, 1.5), radius=0.2, mat=house_wall),
		toy.rounded_box('home_door', size=(1.3, 0.2, 2.1), loc=(0, -2.02, 1.05), radius=0.16, mat=toy.material('HomeDoor', 'sky')),
		toy.rounded_box('home_win', size=(1.0, 0.14, 1.0), loc=(1.3, -2.02, 1.8), radius=0.12, mat=toy.material('WindowGlow', 'cream', emission=1.6, emission_color=(1.0, 0.82, 0.5))),
	]
	for s in (-1, 1):
		slab = toy.rounded_box(f'home_roof_{s}', size=(2.8, 4.6, 0.3), loc=(s * 1.15, 0, 3.55), rot=(0, DEG(s * -38), 0), radius=0.12, mat=roof)
		parts.append(slab)
	for p in parts:
		toy.apply_transforms(p)
	home = toy.join(parts, 'MyHouse')
	home.location = (13.0, 1.0, 0)
	home.rotation_euler = (0, 0, DEG(-90))
	door_marker('house', (0, -2.9, 0), 0).parent = home
	sign_mat = toy.material('HomeSign', 'cream', emission=2.0, emission_color=(1.0, 0.9, 0.7))
	import shop
	text = shop.text_mesh('MyHouse_SignText', 'MI CASA', 0.42, (0, -2.15, 2.75), sign_mat, extrude=0.04, rot=(DEG(90), 0, 0))
	text.parent = home

	# Sendero al campamento con cartel de madera.
	wood = toy.material('SignWood', 'wood')
	post = toy.cylinder('CampSignPost', radius=0.07, depth=1.6, loc=(-11.6, 9.3, 0.8), mat=wood, segments=10)
	board = toy.rounded_box('CampSignBoard', size=(2.2, 0.12, 0.6), loc=(-11.6, 9.25, 1.55), radius=0.05, mat=wood)
	shop_text = __import__('shop').text_mesh('CampSignText', 'CAMPAMENTO', 0.28, (-11.6, 9.15, 1.53), toy.material('CampText', 'cream'), extrude=0.02, rot=(DEG(90), 0, 0))
	door_marker('campfire', (-11.0, 9.0, 0), 215)
	for k in range(9):
		tree(f'CampTree_{k}', -13.5 + random.uniform(-1.2, 1.2) + (k % 3) * 1.4, 10.5 + (k // 3) * 1.3 + random.uniform(-0.3, 0.3), random.uniform(0.8, 1.2))

	# Faroles, bancos y árboles alrededor de la plaza.
	for k in range(8):
		a = k / 8 * math.tau + DEG(22.5)
		street_lamp(f'Lamp_{k}', math.cos(a) * 6.8, math.sin(a) * 6.8)
	for k, (x, y, f) in enumerate(((0, 3.6, 180), (-3.6, 0, -90), (3.6, 0, 90), (0, -3.6, 0))):
		bench(f'Bench_{k}', x, y, f)
	for k, (x, y) in enumerate(((-15, -6), (15, -6), (-15, 7), (15, 7), (5, 11), (-3, 12), (9, 10), (16, -2), (-16, -2))):
		tree(f'Tree_{k}', x, y, random.uniform(0.9, 1.3))
	flower = [toy.material(f'Flower_{c}', c) for c in ('coral', 'mustard', 'sky', 'sofa_purple')]
	for k in range(26):
		a = random.uniform(0, math.tau)
		r = random.uniform(6.6, 7.4)
		toy.sphere(f'flower_{k}', radius=0.09, loc=(math.cos(a) * r, math.sin(a) * r, 0.1), mat=random.choice(flower), segments=8, rings=6)
	flowers = [o for o in bpy.context.scene.objects if o.name.startswith('flower_')]
	for f in flowers:
		toy.apply_transforms(f)
	toy.join(flowers, 'Flowers')
	sets.stars(160, 26, 3.0, seed=31, name='Stars')
	toy.sphere('Moon', radius=1.2, loc=(-10, -22, 14), mat=toy.material('Moon', 'cream', emission=5.0, emission_color=(1.0, 0.95, 0.8)), segments=20, rings=12)
	sun = bpy.data.lights.new('CitySun', 'SUN')
	sun.energy = 1.2
	sun.color = (0.8, 0.78, 1.0)
	sun_obj = bpy.data.objects.new('CitySun', sun)
	sun_obj.rotation_euler = (DEG(40), DEG(15), DEG(30))
	toy.link(sun_obj)
	toy.empty('Spawn', loc=(0, 4.6, 0))
	return 'room_city.glb'


def chair(name, x, y, facing, color):
	mat = toy.material(f'Chair_{color}', color)
	wood = toy.material('ChairWood', 'wood_dark')
	parts = [
		toy.rounded_box(f'{name}_seat', size=(0.55, 0.55, 0.12), loc=(0, 0, 0.46), radius=0.05, mat=mat),
		toy.rounded_box(f'{name}_back', size=(0.55, 0.12, 0.55), loc=(0, 0.26, 0.78), radius=0.06, mat=mat),
	]
	for sx in (-1, 1):
		for sy in (-1, 1):
			parts.append(toy.cylinder(f'{name}_leg_{sx}{sy}', radius=0.035, depth=0.42, loc=(sx * 0.22, sy * 0.22, 0.21), mat=wood, segments=8))
	for p in parts:
		toy.apply_transforms(p)
	obj = toy.join(parts, name)
	obj.location = (x, y, 0)
	obj.rotation_euler = (0, 0, DEG(facing))
	return obj


def arcade(name, x, y, facing, color):
	body = toy.material(f'Arcade_{color}', color)
	screen = toy.material(f'ArcadeScreen_{color}', 'mint', emission=2.5, emission_color=toy.PALETTE['mint'])
	parts = [
		toy.rounded_box(f'{name}_body', size=(0.8, 0.8, 1.8), loc=(0, 0, 0.9), radius=0.08, mat=body),
		toy.rounded_box(f'{name}_screen', size=(0.6, 0.05, 0.5), loc=(0, -0.42, 1.35), rot=(DEG(-12), 0, 0), radius=0.03, mat=screen),
		toy.rounded_box(f'{name}_panel', size=(0.75, 0.35, 0.12), loc=(0, -0.48, 0.95), rot=(DEG(18), 0, 0), radius=0.04, mat=toy.material('ArcadePanel', 'ink')),
	]
	for k, c in enumerate(('coral', 'mustard', 'sky')):
		parts.append(toy.sphere(f'{name}_btn_{k}', radius=0.035, loc=(-0.15 + k * 0.12, -0.55, 1.03), mat=toy.material(f'Btn_{c}', c, emission=1.0), segments=8, rings=6))
	for p in parts:
		toy.apply_transforms(p)
	obj = toy.join(parts, name)
	obj.location = (x, y, 0)
	obj.rotation_euler = (0, 0, DEG(facing))
	return obj


def build_games():
	sets.room_shell(10, 9, 'midnight_blue', 'floor_plum')
	rug = toy.material('GamesRug', (0.42, 0.22, 0.55))
	toy.cylinder('TableRug', radius=2.6, depth=0.03, loc=(0, -0.5, 0.015), mat=rug, segments=48)
	# Mesa redonda con paño verde.
	wood = toy.material('TableWood', 'wood')
	felt = toy.material('TableFelt', (0.15, 0.48, 0.34))
	parts = [
		toy.cylinder('table_top', radius=1.2, depth=0.1, loc=(0, 0, 0.72), mat=wood, segments=48, bevel=0.04),
		toy.cylinder('table_felt', radius=1.05, depth=0.02, loc=(0, 0, 0.78), mat=felt, segments=48),
		toy.cylinder('table_leg', radius=0.14, depth=0.68, loc=(0, 0, 0.35), mat=wood, segments=16),
		toy.cylinder('table_foot', radius=0.5, depth=0.06, loc=(0, 0, 0.03), mat=wood, segments=24, bevel=0.02),
	]
	for p in parts:
		toy.apply_transforms(p)
	table = toy.join(parts, 'RoundTable')
	table.location = (0, -0.5, 0)
	toy.empty('GameTable', loc=(0, -0.5, 0.79), display='CIRCLE', size=1.0)
	colors = ['coral', 'sky', 'mustard', 'mint', 'sofa_purple', 'seat_red']
	for k in range(6):
		a = k / 6 * math.tau + DEG(90)
		x, y = math.cos(a) * 1.75, math.sin(a) * 1.75 - 0.5
		facing = math.degrees(math.atan2(-x, y + 0.5))
		c = chair(f'TableChair_{k + 1}', x, y, facing, colors[k])
		seat = toy.mark_seat(f'Table_{k + 1}', (0, -0.04, 0.53), parent=c)
		seat['pelacord_table'] = k + 1
	# Arcades contra la pared izquierda y un rincón gamer a la derecha.
	for k, c in enumerate(('seat_red', 'sofa_purple', 'sky')):
		arcade(f'Arcade_{k}', -4.4, -3.0 + k * 1.1, -90, c)
	# Sillón contra la pared derecha, mirando a la mesa (antes una tele tapaba la vista).
	sets.sofa('GamerSofa', (4.1, 1.0, 0), 'sky', seats=2, facing=-90)
	# Estantes con cajas de juegos.
	shelf = toy.material('Shelf', 'wood')
	toy.rounded_box('GameShelf', size=(2.6, 0.45, 1.9), loc=(2.6, -4.2, 0.95), radius=0.06, mat=shelf)
	random.seed(6)
	boxes = []
	for row, z in enumerate((0.4, 0.95, 1.5)):
		x = 1.45
		while x < 3.7:
			w = random.uniform(0.3, 0.5)
			boxes.append(toy.rounded_box(f'gbox_{row}_{x:.2f}', size=(w, 0.32, random.uniform(0.12, 0.3)), loc=(x + w / 2, -4.0, z), radius=0.025, mat=toy.material(f'GBox_{row}_{int(x * 10)}', random.choice(colors))))
			x += w + 0.06
	for b in boxes:
		toy.apply_transforms(b)
	toy.join(boxes, 'GameBoxes')
	# Cartel de neón y lámpara sobre la mesa.
	import shop
	shop.text_mesh('GamesNeon', 'JUEGOS', 0.55, (-1.6, -4.38, 2.4), toy.material('GamesNeonMat', 'mint', emission=3.5, emission_color=toy.PALETTE['mint']), extrude=0.04, rot=(DEG(90), 0, DEG(180)))
	shade = toy.material('PendantShade', 'cream', emission=3.0, emission_color=(1.0, 0.8, 0.5))
	toy.cylinder('TableCord', radius=0.012, depth=0.7, loc=(0, -0.5, 2.85), mat=toy.material('Cord', 'ink'), segments=6)
	toy.cone('TableLampShade', r1=0.45, r2=0.15, depth=0.3, loc=(0, -0.5, 2.4), mat=shade, segments=28, bevel=0.03)
	toy.point_light('TableLight', (0, -0.5, 2.1), color=(1.0, 0.82, 0.55), energy=260, radius=0.4)
	toy.point_light('GamesFill', (0, 2.5, 2.8), color=(0.75, 0.7, 1.0), energy=300, radius=2.0)
	toy.point_light('GamesFillFront', (0, 4.6, 2.3), color=(1.0, 0.88, 0.78), energy=260, radius=2.0)
	toy.empty('Spawn', loc=(0, 3.4, 0))
	return 'room_games.glb'


PLACES = {'city': build_city, 'games': build_games}

if __name__ == '__main__':
	for key, make in PLACES.items():
		toy.reset_scene()
		filename = make()
		toy.export_glb(filename, lights=True)
