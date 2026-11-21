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
from city_architecture import Building, garden_bed  # noqa: E402
from city_square import cobbled_square, flower_pot, fountain, leafy_tree  # noqa: E402
import sets  # noqa: E402
import toy  # noqa: E402

DEG = math.radians


def door_marker(room, loc, facing_deg):
	marker = toy.empty(f'Door_{room}', loc=loc, rot=(0, 0, DEG(facing_deg)), display='SINGLE_ARROW', size=0.6)
	marker['pelacord_door'] = room
	return marker


def facade(name, x, y, width, depth, height, facing, door_room):
	obj = Building(name, width, depth, height).build()
	obj.location = (x, y, 0)
	obj.rotation_euler = (0, 0, DEG(facing))
	light = toy.point_light(f'{name}_Light', (0, -depth / 2 - 1.2, 3), color=(1.0, .78, .55), energy=115, radius=.5)
	light.parent = obj
	door_marker(door_room, (0, -depth / 2 - .9, 0), 0).parent = obj
	return obj


def street_lamp(name, x, y):
	pole = toy.material('Cast bronze', (.39,.29,.23),roughness=.54)
	glow = toy.material('StreetGlow', (.99,.79,.46), emission=.85, emission_color=(1.0,.77,.49))
	parts = [
		toy.cylinder(f'{name}_base',radius=.177,depth=.16,loc=(x,y,.10),mat=pole,segments=14,bevel=.041),
		toy.cone('Tapered foot',r1=.112,r2=.065,depth=.63,loc=(x,y,.424),mat=pole,segments=12,bevel=.025),
		toy.cylinder('Slender post',radius=.045,depth=1.67,loc=(x,y,1.49),mat=pole,segments=10,bevel=.016),
		toy.cylinder('Lantern foot',radius=.155,depth=.104,loc=(x,y,2.309),mat=pole,segments=6,bevel=.032),
		toy.cone('Warm glass panes',r1=.128,r2=.173,depth=.31,loc=(x,y,2.505),mat=glow,segments=6,bevel=.018),
		toy.cone('Bronze hood',r1=.204,r2=.046,depth=.181,loc=(x,y,2.735),mat=pole,segments=6,bevel=.025),
		toy.sphere('Lantern finial',radius=.044,loc=(x,y,2.842),mat=pole,segments=12,rings=8),
	]
	for i in range(6):
		a=i*math.tau/6
		parts.append(toy.rounded_box('Lantern pane mullion',size=(.026,.024,.325),
			loc=(x+.148*math.cos(a),y+.148*math.sin(a),2.50),radius=.010,mat=pole))
	for p in parts:
		toy.apply_transforms(p)
	toy.join(parts, name)


def bench(name, x, y, facing):
	wood = toy.material('Bench honeywood', (.63,.40,.28))
	stone = toy.material('Warm limestone',(.94,.826,.711))
	parts = [
		toy.rounded_box('Bench shaped base',size=(1.78,.59,.37),loc=(0,.023,.212),radius=.151,mat=stone),
		toy.rounded_box('Seat plank front',size=(1.74,.25,.11),loc=(0,-.111,.436),radius=.054,mat=wood),
		toy.rounded_box('Seat plank back',size=(1.72,.23,.11),loc=(0,.139,.435),radius=.053,mat=wood),
		toy.rounded_box('Soft bench back',size=(1.66,.11,.245),loc=(0,.253,.707),
			rot=(DEG(-11),0,0),radius=.054,mat=wood),
	]
	for s in (-1, 1):
		parts.append(toy.rounded_box('Sculpted bench end',size=(.205,.49,.61),loc=(s*.825,.035,.312),radius=.10,mat=stone))
		parts.append(toy.rounded_box('Back bracket',size=(.11,.165,.52),loc=(s*.68,.288,.587),
			rot=(DEG(-11),0,0),radius=.049,mat=stone))
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


def trail_sign_labels(name, label, size, board):
	from shop import text_mesh
	ink = toy.material('CampText', 'cream')
	x, y, z = board.location
	for suffix, side, turn in (('Front', -1, 0), ('Back', 1, math.pi)):
		text_mesh(name + suffix, label, size, (x, y + side*.10, z),
			ink, extrude=.015, rot=(math.pi/2, 0, turn))


def build_city():
	random.seed(3)
	grass = toy.material('Grass', (.49,.58,.43))
	grout = toy.material('Plaza warm grout', (.63,.51,.53))
	path = toy.material('Path', (.61,.49,.49))
	toy.rounded_box('Ground', size=(74,74,.43),loc=(0,-10,-.24),radius=.19,mat=grass)
	toy.cylinder('PlazaCircle',radius=6.98,depth=.09,loc=(0,0,-.034),mat=grout,segments=90,bevel=.02)
	toy.rounded_box('Street joints',size=(28.0,5.6,.025),loc=(0,-5.1,-.009),radius=.01,mat=path)
	toy.rounded_box('SidePathL',size=(4.45,11.0,.025),loc=(-9.03,-.55,-.009),radius=.01,mat=path)
	toy.rounded_box('SidePathR',size=(4.45,11.0,.025),loc=(9.03,-.55,-.009),radius=.01,mat=path)
	toy.rounded_box('TrailCamp',size=(2.4,6,.047),loc=(-9.5,7.5,-.010),rot=(0,0,DEG(35)),radius=.018,mat=path)
	cobbled_square()
	fountain()

	# Locales: cine, tienda y casa de juegos al fondo; living a la izquierda; mi casa a la derecha.
	facade('Cinema', -8.0, -9.0, 6.0, 4.0, 4.60, 180, 'cinema')
	facade('Shop', 0.0, -9.0, 6.0, 4.0, 4.55, 180, 'shop')
	facade('Games', 8.0, -9.0, 6.0, 4.0, 4.36, 180, 'games')
	facade('Lounge', -13.0, 1.0, 5.0, 4.0, 3.83, 90, 'living')
	facade('MyHouse', 13.0, 1.0, 4.5, 4.0, 3.24, -90, 'house')
	for x, y in ((-4.03,-7.8),(4.03,-7.8),(-7.8,3.55),(7.8,3.55)):
		garden_bed(x,y,1.55,.77)

	# Sendero al campamento con cartel de madera.
	wood = toy.material('SignWood', 'wood')
	toy.cylinder('CampSignPost', radius=0.07, depth=1.6, loc=(-9.30, 8.76, 0.8), mat=wood, segments=10)
	board = toy.rounded_box('CampSignBoard', size=(2.2, 0.12, 0.6), loc=(-9.30, 8.76, 1.55), radius=0.05, mat=wood)
	trail_sign_labels('CampSignText', 'CAMPAMENTO', .27, board)
	door_marker('campfire', (-11.0, 9.0, 0), 215)
	# Cartel al puerto (del otro lado del sendero).
	toy.cylinder('PortSignPost', radius=0.07, depth=1.6, loc=(11.6, 9.25, 0.8), mat=wood, segments=10)
	board = toy.rounded_box('PortSignBoard', size=(1.8, 0.12, 0.6), loc=(11.6, 9.25, 1.55), radius=0.05, mat=toy.material('PortSignWood', (.27,.35,.52)))
	trail_sign_labels('PortSignText', 'PUERTO', .31, board)
	toy.rounded_box('TrailPort', size=(2.4, 6, 0.05), loc=(9.5, 7.5, 0.027), rot=(0, 0, DEG(-35)), radius=0.02, mat=toy.material('Dirt', (0.38, 0.28, 0.24)))
	toy.torus('PortSignBuoy', major=0.22, minor=0.07, loc=(11.6, 9.13, 1.0), rot=(DEG(90), 0, 0), mat=toy.material('Buoy', 'seat_red'), major_seg=20, minor_seg=8)
	door_marker('port', (11.0, 9.0, 0), 145)
	for k in range(9):
		tree(f'CampTree_{k}', -14.7 + random.uniform(-1.2, 1.2) + (k % 3) * 1.4, 10.5 + (k // 3) * 1.3 + random.uniform(-0.3, 0.3), random.uniform(0.8, 1.2))

	# Faroles, bancos y árboles alrededor de la plaza.
	for k in range(8):
		a = k / 8 * math.tau + DEG(22.5)
		street_lamp(f'Lamp_{k}', math.cos(a) * 6.8, math.sin(a) * 6.8)
	for k, (x, y, f) in enumerate(((0, 3.6, 180), (-3.6, 0, -90), (3.6, 0, 90), (0, -3.6, 0))):
		bench(f'Bench_{k}', x, y, f)
	# Canopies behind the eaves and flower clusters in the foreground give the square a frame.
	for i,(x,y,z) in enumerate(((-12.8,-11.8,1.56),(-4.02,-11.3,1.72),(4.27,-12.2,1.84),
		(11.8,-11.9,1.69),(-12.9,6.7,1.34),(12.95,6.8,1.29),(-6.4,8.8,1.42),(6.8,9.2,1.45))):
		leafy_tree(f'Canopy {i}',x,y,z,i+30,foliage='gold' if i%3!=2 else 'olive')
	for i,(x,y,size) in enumerate(((-9.15,-6.36,.84),(-6.72,-6.35,.87),(-1.10,-6.11,.88),(1.25,-6.2,.82),
		(6.49,-6.18,.84),(9.61,-6.18,.9),(-2.42,-1.15,.67),(2.39,.96,.69),
		(-7.7,3.3,.89),(7.8,3.5,.87),(-5.8,6.4,.64),(5.1,6.4,.71))):
		flower_pot(f'Hydrangeas {i}',x,y,size,i+61,pink=i%3!=2)
	for i,(x,y,sz) in enumerate(((-19,-20,7.2),(-7,-25,8.5),(5,-23,7.8),(17,-24,9.1))):
		mat = toy.material('Distant park '+str(i), ((.53,.62,.45),(.56,.63,.47),(.49,.57,.43),(.51,.61,.44))[i])
		toy.sphere(f'Park hill {i}',radius=sz,scale=(1.40,.75,.41),loc=(x,y,-.60),mat=mat,segments=29,rings=16)
	cloud = toy.material('Peach cloud',(.99,.81,.72),roughness=.92,emission=.21)
	for i,(x,y,z,sz) in enumerate(((-17,-29,12.7,1.05),(-5,-36,15.8,1.26),(8,-33,13.6,.72),(18,-31,14.1,1.14))):
		patch = [toy.sphere('Cloud roll',radius=1,scale=(1.8*sz,1.02*sz,r*sz),
			loc=(x+off*sz,y,z+rise*sz),mat=cloud,segments=15,rings=9)
			for off,r,rise in ((-1.65,.54,0),(-.65,.89,.22),(.78,.66,.14),(1.81,.39,-.07))]
		for piece in patch: toy.apply_transforms(piece)
		toy.join(patch,f'Cloudbank {i}')
	sun = bpy.data.lights.new('CitySun', 'SUN')
	sun.energy = 2.1
	sun.angle = DEG(12)
	sun.color = (1.0,.83,.69)
	sun_obj = bpy.data.objects.new('CitySun', sun)
	sun_obj.rotation_euler = (DEG(39),DEG(-39),DEG(16))
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


# ---------------------------------------------------------------- puerto ----

def hotspot(kind, loc, facing_deg=0.0):
	"""Marcador para la app: `fish` = lugar para pescar (mira al agua), `fishmarket` = vender."""
	marker = toy.empty(f'Hotspot_{kind}_{len([o for o in bpy.data.objects if o.name.startswith("Hotspot_")])}', loc=loc, rot=(0, 0, DEG(facing_deg)), display='SINGLE_ARROW', size=0.5)
	marker['pelacord_hotspot'] = kind
	return marker


def pier_lamp(name, x, y):
	pole = toy.material('LampPole', (0.18, 0.14, 0.24))
	glow = toy.material('StreetGlow', 'cream', emission=4.0, emission_color=(1.0, 0.8, 0.5))
	cage = toy.material('LanternCage', 'wood_dark')
	parts = [
		toy.cylinder(f'{name}_pole', radius=0.06, depth=2.4, loc=(x, y, 1.2), mat=cage, segments=10),
		toy.rounded_box(f'{name}_cap', size=(0.36, 0.36, 0.08), loc=(x, y, 2.62), radius=0.03, mat=pole),
		toy.cylinder(f'{name}_glass', radius=0.14, depth=0.32, loc=(x, y, 2.42), mat=glow, segments=12),
	]
	for p in parts:
		toy.apply_transforms(p)
	toy.join(parts, name)


def rowboat(name, x, y, rot, color):
	hull = toy.material(f'{name}_Hull', color)
	inner = toy.material('BoatInner', 'wood')
	parts = [
		toy.sphere(f'{name}_hull', radius=1.0, scale=(0.75, 1.7, 0.42), loc=(0, 0, 0.05), mat=hull, segments=24, rings=12),
		toy.sphere(f'{name}_in', radius=0.9, scale=(0.62, 1.5, 0.3), loc=(0, 0, 0.2), mat=inner, segments=24, rings=12),
		toy.rounded_box(f'{name}_bench', size=(1.0, 0.25, 0.06), loc=(0, 0.2, 0.2), radius=0.03, mat=hull),
		toy.cylinder(f'{name}_oar', radius=0.03, depth=1.8, loc=(0.45, -0.2, 0.32), rot=(DEG(80), 0, DEG(20)), mat=inner, segments=8),
	]
	for p in parts:
		toy.apply_transforms(p)
	obj = toy.join(parts, name)
	# Cortar la mitad de abajo del casco (queda flotando a ras del agua).
	obj.location = (x, y, -0.12)
	obj.rotation_euler = (0, DEG(3), DEG(rot))
	return obj


def crate(name, x, y, s=0.5, rot=0):
	return toy.rounded_box(name, size=(s, s, s), loc=(x, y, s / 2), rot=(0, 0, DEG(rot)), radius=0.04, mat=toy.material('Crate', (0.7, 0.48, 0.28)))


def barrel(name, x, y):
	wood = toy.material('Barrel', (0.55, 0.33, 0.2))
	band = toy.material('BarrelBand', (0.25, 0.22, 0.28))
	parts = [toy.cylinder(f'{name}_body', radius=0.28, depth=0.7, loc=(x, y, 0.35), mat=wood, segments=16, bevel=0.05)]
	for z in (0.15, 0.55):
		parts.append(toy.torus(f'{name}_band_{z}', major=0.285, minor=0.025, loc=(x, y, z), mat=band, major_seg=24, minor_seg=6))
	for p in parts:
		toy.apply_transforms(p)
	toy.join(parts, name)


def build_port():
	"""El PUERTO: costanera de madera, muelle para pescar, botes, faro y la pescadería de Tano."""
	random.seed(8)
	water = toy.material('PortWater', (0.16, 0.36, 0.62), roughness=0.25, emission=0.35, emission_color=(0.2, 0.35, 0.65))
	foam = toy.material('Foam', 'white', emission=0.6)
	sand = toy.material('Sand', (0.86, 0.72, 0.52))
	plank_a = toy.material('PortPlank_A', (0.6, 0.4, 0.24))
	plank_b = toy.material('PortPlank_B', (0.52, 0.34, 0.2))
	post = toy.material('PierPost', (0.36, 0.22, 0.14))

	toy.rounded_box('Water', size=(80, 60, 0.1), loc=(0, -25, -0.32), radius=0.04, mat=water)
	toy.rounded_box('Sand', size=(40, 12, 0.5), loc=(0, 9.0, -0.25), radius=0.2, mat=sand)
	# Costanera: tablones a lo ancho (de y 1.5 a 5.2).
	planks = []
	for i in range(31):
		x = -7.5 + i * 0.5
		planks.append(toy.rounded_box(f'board_{i}', size=(0.48, 3.9, 0.12), loc=(x, 3.35, 0.0), radius=0.02, mat=plank_a if i % 2 else plank_b))
	# Muelle: de la costanera hacia el agua (x de -2.6 a -0.4, y de 1.5 a -3.6).
	for i in range(11):
		y = 1.25 - i * 0.48
		planks.append(toy.rounded_box(f'pplank_{i}', size=(2.4, 0.46, 0.12), loc=(-1.5, y, 0.0), radius=0.02, mat=plank_a if i % 2 else plank_b))
	for p in planks:
		toy.apply_transforms(p)
	toy.join(planks, 'Floor')
	posts = []
	for y in (1.4, -0.4, -2.2, -3.75):
		for x in (-2.75, -0.25):
			posts.append(toy.cylinder(f'post_{x}_{y}', radius=0.12, depth=1.3, loc=(x, y, -0.25), mat=post, segments=10))
	for x in range(-7, 8, 2):
		posts.append(toy.cylinder(f'edge_{x}', radius=0.1, depth=1.0, loc=(x, 1.4, -0.3), mat=post, segments=10))
	for p in posts:
		toy.apply_transforms(p)
	toy.join(posts, 'PierPosts')
	# Baranda de soga en la costanera (dejando libre la entrada al muelle).
	rope = toy.material('Rope', (0.85, 0.75, 0.55))
	ropes = []
	for x0, x1 in ((-7.4, -3.0), (0.0, 7.4)):
		ropes.append(toy.cylinder(f'rope_{x0}', radius=0.025, depth=x1 - x0, loc=((x0 + x1) / 2, 1.45, 0.55), rot=(0, DEG(90), 0), mat=rope, segments=6))
		for x in (x0, x1):
			ropes.append(toy.cylinder(f'rpost_{x}', radius=0.06, depth=0.65, loc=(x, 1.45, 0.32), mat=post, segments=8))
	for p in ropes:
		toy.apply_transforms(p)
	toy.join(ropes, 'Rail')
	# Espuma y anillos en el agua.
	for k in range(14):
		x = random.uniform(-14, 14)
		y = random.uniform(-14, -1)
		if -3.2 < x < 0.2 and y > -4:
			continue
		ring = toy.torus(f'foam_{k}', major=random.uniform(0.25, 0.6), minor=0.02, loc=(x, y, -0.25), mat=foam, major_seg=24, minor_seg=4)
		toy.apply_transforms(ring)
	foams = [o for o in bpy.data.objects if o.name.startswith('foam_')]
	if foams:
		toy.join(foams, 'Foam')

	# Botes, boyas, cajones y barriles.
	rowboat('Boat_A', 2.4, -2.4, 18, 'coral')
	rowboat('Boat_B', -5.4, -4.6, -30, 'sky')
	rowboat('Boat_C', 6.0, -6.5, 70, 'mint')
	buoy = toy.material('Buoy', 'seat_red')
	for k, (x, y) in enumerate(((4.5, -9), (-8, -10), (0.5, -12))):
		toy.sphere(f'buoy_{k}', radius=0.3, scale=(1, 1, 0.8), loc=(x, y, -0.15), mat=buoy if k % 2 == 0 else toy.material('BuoyWhite', 'white'), segments=14, rings=10)
	crate('Crate_1', -6.4, 4.4, 0.6, 12)
	crate('Crate_2', -5.8, 4.7, 0.45, -8)
	crate('Crate_3', -6.2, 4.5, 0.4, 30).location.z = 0.82
	barrel('Barrel_1', -4.9, 4.9)
	barrel('Barrel_2', 6.7, 4.6)

	# Pescadería de Tano: mostrador con hielo y pescados, toldo a rayas y cartel.
	counter = toy.material('Counter', (0.95, 0.9, 0.82))
	stripe_a = toy.material('AwningBlue', 'sky')
	stripe_b = toy.material('AwningWhite', 'white')
	parts = [
		toy.rounded_box('stall_counter', size=(2.6, 0.9, 1.0), loc=(0, 0, 0.5), radius=0.1, mat=counter),
		toy.rounded_box('stall_ice', size=(2.3, 0.7, 0.08), loc=(0, 0, 1.03), radius=0.03, mat=toy.material('Ice', (0.8, 0.93, 1.0), roughness=0.2)),
	]
	for side in (-1, 1):
		parts.append(toy.cylinder(f'stall_pole_{side}', radius=0.06, depth=2.6, loc=(side * 1.25, -0.4, 1.3), mat=post, segments=8))
	for i in range(6):
		parts.append(toy.rounded_box(f'stall_stripe_{i}', size=(0.46, 1.5, 0.08), loc=(-1.15 + i * 0.46, 0, 2.62), rot=(DEG(-12), 0, 0), radius=0.03, mat=stripe_a if i % 2 else stripe_b))
	fish_cols = [toy.material(f'StallFish_{c}', c) for c in ('coral', 'mustard', 'sky', 'sofa_purple')]
	for i in range(5):
		parts.append(toy.sphere(f'stall_fish_{i}', radius=0.14, scale=(1.6, 0.6, 0.5), loc=(-0.9 + i * 0.45, random.uniform(-0.15, 0.15), 1.12), mat=fish_cols[i % 4], segments=12, rings=8))
	for p in parts:
		toy.apply_transforms(p)
	stall = toy.join(parts, 'FishStall')
	stall.location = (4.8, 2.35, 0)
	import shop
	sign_mat = toy.material('StallSign', 'cream', emission=2.2, emission_color=(1.0, 0.9, 0.7))
	shop.text_mesh('StallSignText', 'PESCADERIA', 0.3, (4.8, 2.95, 2.95), sign_mat, extrude=0.03, rot=(DEG(90), 0, DEG(180)))
	toy.empty('Fishmonger', loc=(4.8, 1.75, 0))
	hotspot('fishmarket', (4.8, 3.15, 0), 0)

	# Lugares para pescar (miran al agua): punta y costados del muelle y la costanera.
	hotspot('fish', (-1.5, -3.55, 0), 0)
	hotspot('fish', (-2.45, -2.2, 0), -90)
	hotspot('fish', (-0.55, -1.2, 0), 90)
	hotspot('fish', (-5.6, 1.7, 0), 0)
	hotspot('fish', (1.4, 1.7, 0), 0)
	# Don Ramón pesca al lado del puesto (con su propia caña).
	toy.empty('NpcFisher', loc=(3.0, 1.7, 0), rot=(0, 0, 0))
	toy.cylinder('RamonRod', radius=0.018, depth=1.8, loc=(3.0, 1.15, 1.25), rot=(DEG(55), 0, 0), mat=post, segments=6)

	# Faroles del muelle y de la costanera.
	for k, y in enumerate((1.1, -0.9, -2.9)):
		pier_lamp(f'PierLamp_{k}', -2.75, y)
	for k, x in enumerate((-6.6, 0.4, 7.0)):
		pier_lamp(f'PierLamp_{k + 3}', x, 5.1)

	# Faro a lo lejos, cartel de entrada y cielo.
	white = toy.material('LightHouseWhite', 'white')
	red = toy.material('LightHouseRed', 'seat_red')
	lamp = toy.material('LightHouseLamp', 'cream', emission=8.0, emission_color=(1.0, 0.9, 0.6))
	lh = [toy.cylinder('lh_base', radius=1.6, depth=1.0, loc=(-13, -20, 0.2), mat=toy.material('Rock', 'stone'), segments=16, bevel=0.2)]
	for i in range(4):
		lh.append(toy.cone(f'lh_{i}', r1=1.05 - i * 0.12, r2=0.93 - i * 0.12, depth=1.5, loc=(-13, -20, 1.4 + i * 1.5), mat=white if i % 2 == 0 else red, segments=20))
	lh.append(toy.cylinder('lh_lamp', radius=0.5, depth=0.7, loc=(-13, -20, 7.3), mat=lamp, segments=16))
	lh.append(toy.cone('lh_roof', r1=0.7, r2=0.0, depth=0.7, loc=(-13, -20, 8.0), mat=red, segments=16))
	for p in lh:
		toy.apply_transforms(p)
	toy.join(lh, 'Lighthouse')
	wood = toy.material('SignWood', 'wood')
	# Cartelito al costado de la entrada del muelle (bajo, para que nunca tape la cámara).
	toy.cylinder('PierSignPost', radius=0.07, depth=1.3, loc=(0.35, 2.0, 0.65), mat=wood, segments=10)
	toy.rounded_box('PierSignBoard', size=(1.5, 0.12, 0.5), loc=(0.35, 1.95, 1.3), radius=0.05, mat=toy.material('PierSignWood', 'sky'))
	shop.text_mesh('PierSignText', 'MUELLE', 0.26, (0.35, 2.03, 1.28), toy.material('ArchTextMat', 'cream', emission=1.5, emission_color=(1.0, 0.9, 0.7)), extrude=0.02, rot=(DEG(90), 0, DEG(180)))
	sets.stars(160, 26, 3.0, seed=41, name='Stars')
	toy.sphere('Moon', radius=1.3, loc=(9, -26, 12), mat=toy.material('Moon', 'cream', emission=5.0, emission_color=(1.0, 0.95, 0.8)), segments=20, rings=12)
	sun = bpy.data.lights.new('PortSun', 'SUN')
	sun.energy = 1.2
	sun.color = (0.85, 0.8, 1.0)
	sun_obj = bpy.data.objects.new('PortSun', sun)
	sun_obj.rotation_euler = (DEG(40), DEG(15), DEG(30))
	toy.link(sun_obj)
	toy.point_light('PortFill', (0, 3, 3.5), color=(1.0, 0.8, 0.6), energy=400, radius=2.0)
	toy.empty('Spawn', loc=(0, 4.6, 0))
	return 'room_port.glb'


PLACES = {'city': build_city, 'games': build_games, 'port': build_port}

if __name__ == '__main__':
	for key, make in PLACES.items():
		toy.reset_scene()
		filename = make()
		toy.export_glb(filename, lights=True)
