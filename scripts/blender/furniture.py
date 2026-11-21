"""
Muebles que se compran en la tienda y se ponen en la casa/sala de cada uno (estilo Club Penguin).

Cada mueble es su propio GLB: public/models/furniture/<id>.glb, con el origen en el piso al centro
y mirando a +Z en glTF (como los asientos y el avatar). Material `Base` = color principal que la
app recolorea (el usuario elige el color al comprar); `BaseLight` = su versión clara (almohadones).
Los asientos vienen marcados (`Seat_*`) igual que en las salas.

También escribe public/catalog_furniture.json (nombre, precio en monedas, asientos, colores).
"""
import json
import math
import os
import random
import sys

import bpy

sys.path.insert(0, os.path.dirname(__file__))
import sets  # noqa: E402
import toy  # noqa: E402

DEG = math.radians
OUT_DIR = os.path.join(toy.MODELS_DIR, 'furniture')


def base(color='sofa_purple'):
	return toy.material('Base', color)


def base_light(color='sofa_purple'):
	return toy.material('BaseLight', tuple(min(1, c * 1.15) for c in toy.PALETTE[color]))


def wood():
	return toy.material('Wood', 'wood')


def joined(parts, name):
	for p in parts:
		toy.apply_transforms(p)
	return toy.join(parts, name)


def rename_materials(obj, mapping):
	"""Las piezas que vienen de sets.py usan nombres por color: acá se unifican a Base/BaseLight."""
	for slot in obj.material_slots:
		if not slot.material:
			continue
		for prefix, new in mapping.items():
			if slot.material.name.startswith(prefix):
				slot.material = toy.material(new, 'sofa_purple') if new == 'Base' else base_light()


# ------------------------------------------------------------- muebles ------

def sofa3():
	obj = sets.sofa('Sofa', (0, 0, 0), 'sofa_purple', seats=3)
	rename_materials(obj, {'Sofa_': 'Base', 'Cushion_': 'BaseLight'})
	return obj


def loveseat():
	obj = sets.sofa('Loveseat', (0, 0, 0), 'sofa_purple', seats=2)
	rename_materials(obj, {'Sofa_': 'Base', 'Cushion_': 'BaseLight'})
	return obj


def armchair():
	obj = sets.sofa('Armchair', (0, 0, 0), 'sofa_purple', seats=1)
	rename_materials(obj, {'Sofa_': 'Base', 'Cushion_': 'BaseLight'})
	return obj


def pouf():
	obj = sets.pouf('Pouf', (0, 0, 0), 'coral')
	rename_materials(obj, {'Pouf_': 'Base', 'PoufTop_': 'BaseLight'})
	return obj


def beanbag():
	b = base()
	parts = [toy.sphere('bag', radius=0.42, scale=(1, 1, 0.55), loc=(0, 0, 0.22), mat=b, segments=24, rings=14),
		toy.sphere('bag_back', radius=0.32, scale=(1.1, 0.6, 0.9), loc=(0, 0.2, 0.42), mat=b, segments=20, rings=12)]
	obj = joined(parts, 'Beanbag')
	toy.mark_seat('Beanbag', (0, -0.05, 0.36), parent=obj)
	return obj


def coffee_table():
	w = wood()
	return joined([
		toy.cylinder('top', radius=0.55, depth=0.08, loc=(0, 0, 0.42), mat=w, segments=32, bevel=0.03),
		toy.cylinder('leg', radius=0.07, depth=0.38, loc=(0, 0, 0.2), mat=w, segments=14),
		toy.cylinder('foot', radius=0.25, depth=0.04, loc=(0, 0, 0.02), mat=w, segments=24, bevel=0.015),
	], 'CoffeeTable')


def side_table():
	w = wood()
	return joined([
		toy.cylinder('top', radius=0.28, depth=0.06, loc=(0, 0, 0.5), mat=w, segments=24, bevel=0.025),
		toy.cylinder('leg', radius=0.05, depth=0.48, loc=(0, 0, 0.25), mat=w, segments=12),
		toy.cylinder('foot', radius=0.18, depth=0.035, loc=(0, 0, 0.02), mat=w, segments=20, bevel=0.012),
	], 'SideTable')


def table_lamp():
	lamp = sets.table_lamp('TableLamp', (0, 0, 0))
	rename_materials(lamp, {'LampBase': 'Base'})
	bpy.data.objects['TableLamp_Light'].parent = lamp
	return lamp


def floor_lamp():
	b = base('mustard')
	shade = toy.material('LampShade', 'cream', roughness=0.7, emission=4.0, emission_color=(1.0, 0.78, 0.45))
	lamp = joined([
		toy.cylinder('foot', radius=0.18, depth=0.05, loc=(0, 0, 0.025), mat=b, segments=24, bevel=0.02),
		toy.cylinder('pole', radius=0.022, depth=1.35, loc=(0, 0, 0.7), mat=b, segments=10),
		toy.cone('shade', r1=0.26, r2=0.16, depth=0.28, loc=(0, 0, 1.45), mat=shade, segments=24, bevel=0.03),
	], 'FloorLamp')
	light = toy.point_light('FloorLamp_Light', (0, 0, 1.4), color=(1.0, 0.72, 0.42), energy=70, radius=0.2)
	light.parent = lamp
	return lamp


def plant():
	obj = sets.plant('Plant', (0, 0, 0))
	rename_materials(obj, {'PlantPot': 'Base'})
	return obj


def bookshelf():
	b = base('wood')
	colors = ['coral', 'sky', 'mustard', 'mint', 'sofa_purple', 'seat_red', 'cream']
	parts = [toy.rounded_box('frame_back', size=(1.1, 0.06, 1.7), loc=(0, 0.17, 0.85), radius=0.02, mat=b)]
	for side in (-1, 1):
		parts.append(toy.rounded_box(f'side_{side}', size=(0.06, 0.38, 1.7), loc=(side * 0.55, 0, 0.85), radius=0.025, mat=b))
	random.seed(4)
	for k, z in enumerate((0.04, 0.45, 0.88, 1.3, 1.68)):
		parts.append(toy.rounded_box(f'shelf_{k}', size=(1.12, 0.38, 0.05), loc=(0, 0, z), radius=0.02, mat=b))
		if z > 1.6:
			continue
		x = -0.46
		while x < 0.42:
			wbook = random.uniform(0.05, 0.09)
			h = random.uniform(0.24, 0.34)
			parts.append(toy.rounded_box(f'book_{k}_{x:.2f}', size=(wbook, 0.26, h), loc=(x + wbook / 2, 0.02, z + 0.025 + h / 2), radius=0.012, mat=toy.material(f'Book_{colors[int(x * 100) % len(colors)]}', colors[int(abs(x) * 97) % len(colors)])))
			x += wbook + 0.008
	return joined(parts, 'Bookshelf')


def bed():
	b = base('sky')
	sheet = toy.material('Sheet', 'cream')
	w = wood()
	parts = [
		toy.rounded_box('bed_frame', size=(1.3, 2.1, 0.3), loc=(0, 0, 0.2), radius=0.08, mat=w),
		toy.rounded_box('bed_head', size=(1.36, 0.14, 0.9), loc=(0, 1.02, 0.5), radius=0.07, mat=w),
		toy.rounded_box('mattress', size=(1.22, 2.0, 0.2), loc=(0, -0.02, 0.43), radius=0.08, mat=sheet),
		toy.rounded_box('blanket', size=(1.26, 1.3, 0.12), loc=(0, -0.36, 0.52), radius=0.06, mat=b),
	]
	for s in (-1, 1):
		parts.append(toy.rounded_box(f'pillow_{s}', size=(0.5, 0.3, 0.14), loc=(s * 0.3, 0.75, 0.6), radius=0.07, mat=sheet))
	obj = joined(parts, 'Bed')
	toy.mark_seat('Bed', (0, -0.6, 0.56), parent=obj)
	return obj


def rug():
	return toy.cylinder('Rug', radius=1.2, depth=0.025, loc=(0, 0, 0.0125), mat=base((0.36, 0.26, 0.58)) if False else base('sofa_purple'), segments=48, bevel=0.01)


def tv():
	frame = toy.material('Frame', (0.08, 0.06, 0.1))
	w = wood()
	parts = [
		toy.rounded_box('stand', size=(1.6, 0.45, 0.45), loc=(0, 0, 0.225), radius=0.07, mat=w),
		toy.rounded_box('tv_frame', size=(1.5, 0.1, 0.9), loc=(0, 0.05, 0.98), radius=0.05, mat=frame),
		toy.cylinder('tv_neck', radius=0.04, depth=0.1, loc=(0, 0.05, 0.5), mat=frame, segments=10),
	]
	obj = joined(parts, 'TV')
	screen = toy.rounded_box('Screen', size=(1.38, 0.03, 0.78), loc=(0, -0.005, 0.98), radius=0.012, mat=sets.screen_mat())
	screen.parent = obj
	return obj


def neon_moon():
	moon = sets.neon_moon('NeonMoon', (0, 0, 1.6))
	return moon


def campfire_mini():
	"""Chimenea / fogata chiquita para el living (luz cálida)."""
	stone = toy.material('Stone', 'stone')
	flame = toy.material('FlameOuter', 'cone_orange', roughness=0.5, emission=1.1, emission_color=(1.0, 0.28, 0.02))
	parts = [toy.rounded_box('hearth', size=(1.2, 0.5, 1.0), loc=(0, 0.1, 0.5), radius=0.1, mat=stone)]
	hole = toy.rounded_box('hole', size=(0.7, 0.6, 0.55), loc=(0, -0.05, 0.38), radius=0.08)
	mod = parts[0].modifiers.new('Hole', 'BOOLEAN')
	mod.operation = 'DIFFERENCE'
	mod.object = hole
	mod.solver = 'EXACT'
	toy.apply_modifiers(parts[0])
	bpy.data.objects.remove(hole, do_unlink=True)
	parts.append(toy.sphere('fire', radius=0.13, scale=(1.3, 0.8, 1.4), loc=(0, -0.02, 0.28), mat=flame, segments=14, rings=10))
	obj = joined(parts, 'Fireplace')
	light = toy.point_light('Fireplace_Light', (0, -0.3, 0.4), color=(1.0, 0.55, 0.22), energy=120, radius=0.3)
	light.parent = obj
	return obj


FURNITURE = {
	# id: (función, nombre, precio, recolor, categoría)
	'sofa': (sofa3, 'Sillón de 3', 400, True, 'asientos'),
	'loveseat': (loveseat, 'Sillón de 2', 300, True, 'asientos'),
	'armchair': (armchair, 'Sillón individual', 220, True, 'asientos'),
	'pouf': (pouf, 'Puf', 90, True, 'asientos'),
	'beanbag': (beanbag, 'Puf gigante', 160, True, 'asientos'),
	'bed': (bed, 'Cama', 380, True, 'dormitorio'),
	'coffee_table': (coffee_table, 'Mesa ratona', 150, False, 'mesas'),
	'side_table': (side_table, 'Mesita', 80, False, 'mesas'),
	'table_lamp': (table_lamp, 'Lámpara de mesa', 70, True, 'luces'),
	'floor_lamp': (floor_lamp, 'Lámpara de pie', 120, True, 'luces'),
	'neon_moon': (neon_moon, 'Neón de luna', 200, False, 'luces'),
	'fireplace': (campfire_mini, 'Chimenea', 450, False, 'luces'),
	'plant': (plant, 'Planta', 60, True, 'deco'),
	'bookshelf': (bookshelf, 'Biblioteca', 260, True, 'deco'),
	'rug': (rug, 'Alfombra redonda', 110, True, 'deco'),
	'tv': (tv, 'Tele', 500, False, 'deco'),
}


# Color de fábrica de cada mueble (el usuario lo puede cambiar al comprarlo).
DEFAULT_COLORS = {
	'sofa': '#8a5cff', 'loveseat': '#f5b326', 'armchair': '#f5b326', 'pouf': '#ff7350', 'beanbag': '#6bc7ff',
	'bed': '#6bc7ff', 'table_lamp': '#f5b326', 'floor_lamp': '#f5b326', 'plant': '#ff7350', 'bookshelf': '#9c6236',
	'rug': '#5c428f',
}


def build_item(key):
	make = FURNITURE[key][0]
	before = {o.name for o in bpy.data.objects}
	root = make()
	created = [o for o in bpy.data.objects if o.name not in before]
	return root, created


def export_all():
	os.makedirs(OUT_DIR, exist_ok=True)
	catalog = []
	for key, (make, name, price, recolor, category) in FURNITURE.items():
		toy.reset_scene()
		make()
		# La escena quedó sólo con este mueble (los objetos auxiliares, como los moldes de los
		# booleanos, ya se borraron): se exporta todo lo que hay.
		created = list(bpy.context.scene.objects)
		seats = len([o for o in created if o.get('pelacord_seat')])
		path = toy.export_glb(f'furniture/{key}.glb', objects=created, lights=True)
		catalog.append({'id': key, 'name': name, 'price': price, 'category': category, 'glb': f'models/furniture/{key}.glb',
			'seats': seats, 'recolor': ['Base', 'BaseLight'] if recolor else [], 'defaultColor': DEFAULT_COLORS.get(key)})
		print('[pelacord-3d] mueble', key, os.path.getsize(path) // 1024, 'KB')
	with open(os.path.join(toy.ROOT, 'public', 'catalog_furniture.json'), 'w', encoding='utf-8') as fh:
		json.dump({'items': catalog}, fh, ensure_ascii=False, indent=1)
	return catalog


def showroom():
	"""Todos los muebles en fila (para mirarlos con `look`)."""
	toy.reset_scene()
	x = 0.0
	for key in FURNITURE:
		root, created = build_item(key)
		width = max(o.dimensions.x for o in created if o.type == 'MESH') if any(o.type == 'MESH' for o in created) else 1
		root.location.x = x + width / 2
		x += width + 0.35


if __name__ == '__main__':
	export_all()
