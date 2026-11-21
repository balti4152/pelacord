"""
La TIENDA de PelaCord (estilo Club Penguin). Entrando por la puerta: ropa a la DERECHA, muebles a
la IZQUIERDA y el mostrador al fondo. public/models/room_shop.glb

Puntos para la app (empties con extra `pelacord_hotspot`):
  Shop_Clothes    → abre el catálogo de ropa / peinados / caras (percheros)
  Shop_Furniture  → abre el catálogo de muebles (vitrina)
  Shop_Counter    → caja: comprar / ver monedas
  Fitting_Room    → probador: editor de personaje con espejo
  Shopkeeper      → dónde se para el vendedor (un avatar con el look 'shopkeeper')
  Spawn           → entrada
"""
import math
import os
import random
import sys

import bpy

sys.path.insert(0, os.path.dirname(__file__))
import furniture  # noqa: E402
import sets  # noqa: E402
import toy  # noqa: E402

DEG = math.radians
CLOTH_COLORS = ['coral', 'sky', 'mustard', 'mint', 'sofa_purple', 'seat_red', 'cream', 'frog_green']


def hotspot(name, loc, label):
	h = toy.empty(name, loc=loc, display='SPHERE', size=0.35)
	h['pelacord_hotspot'] = label
	return h


def text_mesh(name, body, size, loc, mat, extrude=0.05, rot=(DEG(90), 0, 0)):
	"""Texto 3D gordito (para el cartel), convertido a malla para que viaje en el GLB."""
	curve = bpy.data.curves.new(name, 'FONT')
	curve.body = body
	curve.size = size
	curve.extrude = extrude
	curve.bevel_depth = extrude * 0.6
	curve.bevel_resolution = 3
	curve.align_x = 'CENTER'
	curve.align_y = 'CENTER'
	tmp = bpy.data.objects.new(name + '_tmp', curve)
	bpy.context.scene.collection.objects.link(tmp)
	depsgraph = bpy.context.evaluated_depsgraph_get()
	mesh = bpy.data.meshes.new_from_object(tmp.evaluated_get(depsgraph))
	bpy.data.objects.remove(tmp, do_unlink=True)
	bpy.data.curves.remove(curve)
	obj = bpy.data.objects.new(name, mesh)
	toy.link(obj)
	obj.data.materials.clear()
	obj.data.materials.append(mat)
	obj.location = loc
	obj.rotation_euler = rot
	return toy.smooth(obj, 40)


def folded_shirt(name, loc, color):
	return toy.rounded_box(name, size=(0.34, 0.26, 0.07), loc=loc, radius=0.03, mat=toy.material(f'Cloth_{color}', color))


def hanging_shirt(name, loc, color, rot_z=0.0):
	mat = toy.material(f'Cloth_{color}', color)
	x, y, z = loc
	parts = [
		toy.rounded_box(f'{name}_body', size=(0.08, 0.34, 0.4), loc=(x, y, z - 0.25), radius=0.035, mat=mat),
		toy.rounded_box(f'{name}_sleeves', size=(0.07, 0.5, 0.12), loc=(x, y, z - 0.1), radius=0.04, mat=mat),
		toy.torus(f'{name}_hook', major=0.035, minor=0.006, loc=(x, y, z + 0.02), rot=(0, DEG(90), 0), mat=toy.material('Chrome', (0.75, 0.75, 0.8), roughness=0.5)),
	]
	for p in parts:
		toy.apply_transforms(p)
	return toy.join(parts, name)


def clothes_rack(name, loc, colors):
	chrome = toy.material('Chrome', (0.75, 0.75, 0.8), roughness=0.5)
	x, y, _ = loc
	parts = [toy.cylinder(f'{name}_bar', radius=0.025, depth=1.6, loc=(x, y, 1.45), rot=(DEG(90), 0, 0), mat=chrome, segments=10)]
	for s in (-1, 1):
		parts.append(toy.cylinder(f'{name}_post_{s}', radius=0.025, depth=1.45, loc=(x, y + s * 0.8, 0.73), mat=chrome, segments=10))
		parts.append(toy.rounded_box(f'{name}_foot_{s}', size=(0.5, 0.1, 0.05), loc=(x, y + s * 0.8, 0.025), radius=0.02, mat=chrome))
	for p in parts:
		toy.apply_transforms(p)
	rack = toy.join(parts, name)
	for k, color in enumerate(colors):
		hanging_shirt(f'{name}_shirt_{k}', (x, y - 0.66 + k * 0.22, 1.47), color)
	return rack


def mannequin(name, loc, top_color, hat=None):
	"""Maniquí redondito (mismo estilo que el avatar) mostrando ropa/disfraz."""
	white = toy.material('Mannequin', 'cream')
	top = toy.material(f'Cloth_{top_color}', top_color)
	x, y, _ = loc
	parts = [
		toy.cylinder(f'{name}_base', radius=0.22, depth=0.06, loc=(x, y, 0.03), mat=white, segments=24, bevel=0.02),
		toy.cylinder(f'{name}_pole', radius=0.03, depth=0.5, loc=(x, y, 0.3), mat=white, segments=10),
		toy.capsule(f'{name}_torso', radius=0.18, height=0.46, scale=(1.06, 0.82, 1), loc=(x, y, 0.78), mat=top),
		toy.sphere(f'{name}_head', radius=0.2, scale=(1, 0.95, 1.15), loc=(x, y, 1.16), mat=white),
	]
	for p in parts:
		toy.apply_transforms(p)
	obj = toy.join(parts, name)
	if hat:
		import costumes
		costume = costumes.COSTUMES[hat]()
		costume.location = (x, y, 0.18)
	return obj


def build_shop():
	# Paredes violeta noche + piso de tablas de madera (dos tonos).
	sets.room_shell(10, 9, 'night_purple', 'floor_plum')
	wood_a = toy.material('Plank_A', (0.55, 0.34, 0.2))
	wood_b = toy.material('Plank_B', (0.48, 0.29, 0.17))
	planks = [toy.rounded_box(f'plank_{i}', size=(0.48, 9.0, 0.04), loc=(-4.75 + i * 0.5, 0, 0.02), radius=0.015, mat=wood_a if i % 2 else wood_b) for i in range(20)]
	for p in planks:
		toy.apply_transforms(p)
	toy.join(planks, 'FloorPlanks')

	# Cartel "TIENDA" con luz cálida, arriba del mostrador.
	sign_mat = toy.material('SignText', 'mustard', emission=2.5, emission_color=(1.0, 0.75, 0.25))
	board = toy.material('SignBoard', (0.18, 0.09, 0.28))
	toy.rounded_box('SignBoard', size=(3.4, 0.12, 0.9), loc=(0, -4.38, 2.45), radius=0.12, mat=board)
	# Girado 180° en Z: si no, el texto miraba hacia la pared y se leía espejado.
	text_mesh('SignText', 'TIENDA', 0.62, (0, -4.3, 2.43), sign_mat, extrude=0.04, rot=(DEG(90), 0, DEG(180)))
	toy.point_light('SignLight', (0, -3.8, 2.4), color=(1.0, 0.75, 0.4), energy=60, radius=0.4)

	# Mostrador con caja registradora y una plantita.
	counter_mat = toy.material('Counter', 'mustard')
	top_mat = toy.material('CounterTop', 'wood_dark')
	toy.rounded_box('Counter', size=(3.0, 0.8, 1.0), loc=(0, -3.2, 0.5), radius=0.1, mat=counter_mat)
	toy.rounded_box('CounterTop', size=(3.15, 0.95, 0.08), loc=(0, -3.2, 1.04), radius=0.04, mat=top_mat)
	reg = toy.material('Register', 'sky')
	screen = toy.material('RegisterScreen', 'mint', emission=1.5)
	parts = [
		toy.rounded_box('reg_body', size=(0.5, 0.42, 0.22), loc=(0.8, -3.2, 1.19), radius=0.05, mat=reg),
		toy.rounded_box('reg_screen', size=(0.34, 0.08, 0.2), loc=(0.8, -3.05, 1.38), rot=(DEG(-20), 0, 0), radius=0.03, mat=screen),
	]
	for p in parts:
		toy.apply_transforms(p)
	toy.join(parts, 'Register')
	coin = toy.material('Coin', 'gold', roughness=0.5)
	for k in range(5):
		toy.cylinder(f'coin_{k}', radius=0.05, depth=0.015, loc=(0.25 + (k % 3) * 0.02, -3.0, 1.09 + k * 0.016), mat=coin, segments=16)
	sets.plant('CounterPlant', (-1.1, -3.25, 1.08))
	toy.empty('Shopkeeper', loc=(0, -3.9, 0))

	# --- Zona de ropa (izquierda) ---
	clothes_rack('RackA', (-3.7, -0.6, 0), CLOTH_COLORS[:7])
	clothes_rack('RackB', (-3.7, 1.9, 0), list(reversed(CLOTH_COLORS))[:7])
	shelf = toy.material('Shelf', 'wood')
	toy.rounded_box('ClothesShelf', size=(0.5, 2.6, 1.8), loc=(-4.65, -3.0, 0.9), radius=0.06, mat=shelf)
	random.seed(8)
	for row, z in enumerate((0.35, 0.85, 1.35)):
		toy.rounded_box(f'shelf_board_{row}', size=(0.56, 2.66, 0.05), loc=(-4.4, -3.0, z - 0.05), radius=0.02, mat=shelf)
		for k in range(4):
			for h in range(random.randint(2, 4)):
				folded_shirt(f'fold_{row}_{k}_{h}', (-4.42, -4.0 + k * 0.66, z + h * 0.072), random.choice(CLOTH_COLORS))
	mannequin('MannequinCone', (-2.4, 3.3, 0), 'sky', hat='cone')
	mannequin('MannequinFrog', (-1.5, 3.5, 0), 'coral', hat='frog')
	mannequin('MannequinPirate', (-3.3, 3.5, 0), 'cream', hat='pirate')
	hotspot('Shop_Clothes', (-3.0, 0.6, 0.8), 'clothes')

	# Probador con cortina.
	curtain = toy.material('FittingCurtain', 'sofa_purple')
	frame = toy.material('FittingFrame', 'wood_dark')
	toy.rounded_box('FittingFrame', size=(1.3, 1.3, 0.1), loc=(-4.2, 3.9, 2.3), radius=0.04, mat=frame)
	folds = [toy.capsule(f'fit_fold_{i}', radius=0.11, height=2.1, loc=(-4.8 + i * 0.2, 3.35, 1.15), mat=curtain, segments=12, rings=8) for i in range(4)]
	for f in folds:
		toy.apply_transforms(f)
	toy.join(folds, 'FittingCurtain')
	mirror = toy.material('Mirror', (0.75, 0.85, 0.95), roughness=0.15)
	toy.rounded_box('Mirror', size=(0.06, 0.8, 1.5), loc=(-4.85, 4.0, 1.1), radius=0.03, mat=mirror)
	hotspot('Fitting_Room', (-4.2, 3.9, 0.8), 'fitting')

	# --- Zona de muebles (derecha): tarima con un living armado de muestra ---
	plat = toy.material('Platform', 'dark_crimson')
	toy.rounded_box('Showcase', size=(3.4, 3.4, 0.25), loc=(3.0, 1.0, 0.125), radius=0.08, mat=plat)
	# De frente a la entrada (+Y): antes el sillón y el puf le daban la espalda a quien entraba.
	for key, loc, rot in (('loveseat', (3.0, 0.2, 0.25), 180), ('floor_lamp', (4.3, -0.2, 0.25), 0), ('coffee_table', (3.0, 1.3, 0.25), 0),
			('beanbag', (1.85, 1.75, 0.25), 150), ('plant', (4.25, 2.3, 0.25), 0), ('rug', (3.0, 1.0, 0.25), 0)):
		root, created = furniture.build_item(key)
		root.location = loc
		root.rotation_euler = (0, 0, DEG(rot))
	toy.rounded_box('PriceTag', size=(0.5, 0.04, 0.3), loc=(3.0, -0.72, 0.45), radius=0.05, mat=toy.material('Tag', 'cream'))
	hotspot('Shop_Furniture', (3.0, 1.0, 0.8), 'furniture')
	hotspot('Shop_Counter', (0, -2.4, 0.8), 'counter')

	# Lámparas colgantes cálidas (se ven desde la cámara alta, típica de Club Penguin).
	shade = toy.material('PendantShade', 'cream', emission=3.0, emission_color=(1.0, 0.8, 0.5))
	cord = toy.material('Cord', 'ink')
	for k, (x, y) in enumerate(((-2.5, -1.0), (0, 0.5), (2.5, -1.0), (0, -2.2))):
		toy.cylinder(f'cord_{k}', radius=0.01, depth=0.6, loc=(x, y, 2.95), mat=cord, segments=6)
		toy.sphere(f'pendant_{k}', radius=0.2, scale=(1, 1, 0.75), loc=(x, y, 2.55), mat=shade, segments=18, rings=10)
		toy.point_light(f'PendantLight_{k}', (x, y, 2.4), color=(1.0, 0.75, 0.45), energy=80, radius=0.3)

	# Entrada: felpudo y puerta en la pared de adelante (no hay pared, se marca el umbral).
	toy.rounded_box('DoorMat', size=(1.4, 0.8, 0.03), loc=(0, 4.0, 0.06), radius=0.02, mat=toy.material('Mat', 'coral'))
	neon = sets.neon_moon('ShopNeon', (3.6, -4.42, 2.3), size=0.35)
	# Relleno cálido general: la tienda es el lugar más "alegre" (como en Club Penguin).
	toy.point_light('ShopFill', (0, 0.5, 3.2), color=(1.0, 0.82, 0.7), energy=420, radius=2.5)
	toy.point_light('ShopFillBack', (0, -2.8, 2.6), color=(0.85, 0.7, 1.0), energy=160, radius=1.5)
	# Relleno desde la entrada: sin esto, a los personajes que miran hacia la puerta no se les veía la cara.
	toy.point_light('ShopFillFront', (0, 4.6, 2.3), color=(1.0, 0.88, 0.78), energy=380, radius=2.0)
	# Luz de "día" suave desde arriba: que todo se lea bien aunque la app no agregue ambiente.
	sun = bpy.data.lights.new('ShopSun', 'SUN')
	sun.energy = 1.6
	sun.color = (1.0, 0.92, 0.85)
	sun.angle = math.radians(25)
	sun_obj = bpy.data.objects.new('ShopSun', sun)
	sun_obj.rotation_euler = (DEG(35), DEG(10), DEG(20))
	toy.link(sun_obj)
	merge_small_parts()
	toy.empty('Spawn', loc=(0, 3.6, 0))
	return 'room_shop.glb'


def merge_small_parts():
	"""Junta las piezas chicas repetidas (ropa doblada, monedas, lámparas): menos objetos = la web
	dibuja más rápido. El GLB pasaba de 100 mallas sueltas a unas pocas."""
	for prefix, name in (('fold_', 'FoldedClothes'), ('coin_', 'Coins'), ('cord_', 'PendantCords'), ('pendant_', 'Pendants'),
			('shelf_board_', 'ShelfBoards'), ('RackA_shirt_', 'RackA_Shirts'), ('RackB_shirt_', 'RackB_Shirts')):
		group = [o for o in bpy.context.scene.objects if o.type == 'MESH' and o.name.startswith(prefix)]
		if len(group) > 1:
			toy.join(group, name)


PREVIEW = dict(target=(0, -0.3, 0.6), distance=8.0, height=6.5, angle_deg=0, background='night_purple', floor=False, lens=30)

if __name__ == '__main__':
	toy.reset_scene()
	build_shop()
	toy.export_glb('room_shop.glb', lights=True)
	if '--preview' in sys.argv:
		toy.preview_rig(**PREVIEW)
		toy.render_preview('room_shop.png', resolution=(1280, 900))
