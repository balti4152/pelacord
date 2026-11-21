"""
Disfraces y sombreros del avatar (misma geometría gordita y mate).

Cada uno se exporta como su propio GLB: public/models/costume_<id>.glb
Están modelados EN EL ESPACIO DEL AVATAR en reposo, con el origen en los pies del avatar. En la
app (Three.js) se colocan así:

    costume.position.set(0, 0, 0)          // en el origen del avatar, con el avatar en reposo
    avatar.add(costume); headBone.attach(costume)   // attach conserva la posición del mundo

La propiedad extra `pelacord_attach` del objeto dice a qué hueso va: 'head' o 'spine'.
"""
import math
import os
import sys

import bpy

sys.path.insert(0, os.path.dirname(__file__))
import toy  # noqa: E402

DEG = math.radians
HEAD_TOP = 1.21


def finish(parts, name, attach):
	for p in parts:
		toy.apply_transforms(p)
	obj = toy.join(parts, name)
	obj['pelacord_attach'] = attach
	return obj


def cone_hat():
	orange = toy.material('Cone_Orange', 'cone_orange')
	white = toy.material('Cone_Stripe', 'white', roughness=0.6)
	base_mat = toy.material('Cone_Base', (0.12, 0.1, 0.12))
	parts = [
		toy.rounded_box('cone_base', size=(0.36, 0.36, 0.05), loc=(0, 0, HEAD_TOP - 0.07), radius=0.025, mat=base_mat),
		toy.cone('cone_body', r1=0.15, r2=0.035, depth=0.42, loc=(0, 0, HEAD_TOP + 0.15), mat=orange, segments=28),
		toy.sphere('cone_tip', radius=0.038, loc=(0, 0, HEAD_TOP + 0.36), mat=orange, segments=16, rings=10),
		toy.torus('cone_stripe_1', major=0.118, minor=0.012, loc=(0, 0, HEAD_TOP + 0.09), mat=white),
		toy.torus('cone_stripe_2', major=0.085, minor=0.011, loc=(0, 0, HEAD_TOP + 0.21), mat=white),
	]
	obj = finish(parts, 'Costume_Cone', 'head')
	# Cono "torcido" con gracia: un poco ladeado, girando desde la coronilla.
	toy.set_origin(obj, (0, 0, HEAD_TOP - 0.08))
	obj.rotation_euler = (DEG(-6), DEG(9), 0)
	toy.apply_transforms(obj)
	return obj


def frog_hat():
	green = toy.material('Frog_Green', 'frog_green')
	white = toy.material('Frog_EyeWhite', 'white', roughness=0.5)
	ink = toy.material('Frog_Pupil', 'ink', roughness=0.5)
	pink = toy.material('Frog_Mouth', (0.95, 0.40, 0.50))
	# Capucha más grande que el pelo, con hueco para la cara (si no, el pelo la atravesaba).
	dome = toy.sphere('frog_dome', radius=0.25, scale=(1.08, 1.05, 1.05), loc=(0, 0.015, 1.0), mat=green, segments=32, rings=18)
	hole = toy.sphere('frog_hole', radius=0.17, scale=(1.08, 1.4, 1.12), loc=(0, -0.2, 0.92), segments=24, rings=14)
	mod = dome.modifiers.new('Face', 'BOOLEAN')
	mod.operation = 'DIFFERENCE'
	mod.object = hole
	mod.solver = 'EXACT'
	toy.apply_modifiers(dome)
	bpy.data.objects.remove(hole, do_unlink=True)
	toy.smooth(dome, 70)
	mouth = toy.capsule('frog_mouth', radius=0.013, height=0.2, loc=(0, -0.232, 1.13), mat=pink, segments=10, rings=8)
	mouth.rotation_euler = (DEG(-25), DEG(90), 0)
	parts = [dome, mouth]
	for side in (1, -1):
		x = side * 0.11
		parts.append(toy.sphere(f'frog_eye_{side}', radius=0.078, loc=(x, -0.05, 1.29), mat=white, segments=18, rings=12))
		parts.append(toy.sphere(f'frog_pupil_{side}', radius=0.037, scale=(1, 0.6, 1.1), loc=(x + side * 0.008, -0.118, 1.3), mat=ink, segments=14, rings=10))
		parts.append(toy.sphere(f'frog_lid_{side}', radius=0.083, scale=(1, 1, 0.55), loc=(x, -0.04, 1.335), mat=green, segments=18, rings=10))
	# La boca de la rana es una sonrisa encima de la frente: se dobla en arco.
	return finish(parts, 'Costume_Frog', 'head')


def pirate_hat():
	black = toy.material('Pirate_Black', 'pirate_black')
	gold = toy.material('Pirate_Gold', 'gold', roughness=0.55)
	white = toy.material('Pirate_Skull', 'white', roughness=0.6)
	parts = [
		toy.sphere('pirate_crown', radius=0.2, scale=(1.05, 1.0, 0.62), loc=(0, 0.01, HEAD_TOP - 0.03), mat=black, segments=28, rings=14),
		# Bicornio: media luna ancha y gordita.
		toy.sphere('pirate_brim', radius=0.33, scale=(1.0, 0.27, 0.42), loc=(0, 0.0, HEAD_TOP + 0.06), mat=black, segments=32, rings=16),
		toy.torus('pirate_trim', major=0.33, minor=0.018, loc=(0, 0.0, HEAD_TOP + 0.06), rot=(DEG(90), 0, 0), mat=gold, major_seg=40),
		toy.sphere('pirate_skull', radius=0.045, scale=(1, 0.5, 1.05), loc=(0, -0.085, HEAD_TOP + 0.1), mat=white, segments=16, rings=10),
	]
	parts[2].scale = (1.0, 0.42, 1.0)
	for side in (1, -1):
		parts.append(toy.capsule(f'pirate_bone_{side}', radius=0.011, height=0.11, loc=(0, -0.09, HEAD_TOP + 0.045), mat=white, segments=8, rings=6))
		parts[-1].rotation_euler = (0, DEG(side * 55), 0)
	return finish(parts, 'Costume_Pirate', 'head')


def hotdog_suit():
	"""Traje de pancho: salchicha que envuelve el cuerpo (con hueco para la cara), pan a los costados."""
	sausage = toy.material('Hotdog_Sausage', 'sausage')
	bun = toy.material('Hotdog_Bun', 'bun')
	sauce = toy.material('Hotdog_Mustard', 'mustard_sauce', roughness=0.7)
	body = toy.capsule('hotdog_sausage', radius=0.25, height=1.08, scale=(1.0, 0.9, 1.0), loc=(0, 0.02, 0.76), mat=sausage, segments=28, rings=18)
	# Hueco para la cara (booleano), así la cara del avatar queda a la vista.
	hole = toy.sphere('hotdog_hole', radius=0.19, scale=(1.0, 1.4, 1.15), loc=(0, -0.2, 0.96), segments=24, rings=14)
	mod = body.modifiers.new('Face', 'BOOLEAN')
	mod.operation = 'DIFFERENCE'
	mod.object = hole
	mod.solver = 'EXACT'
	toy.apply_modifiers(body)
	bpy.data.objects.remove(hole, do_unlink=True)
	toy.smooth(body, 70)
	parts = [body]
	for side in (1, -1):
		parts.append(toy.capsule(f'hotdog_bun_{side}', radius=0.13, height=0.98, scale=(0.8, 1.15, 1.0), loc=(side * 0.27, 0.05, 0.66), mat=bun, segments=24, rings=16))
	# Mostaza en zigzag sobre la salchicha (arriba de la cabeza).
	points = [(-0.12, 1.30), (-0.06, 1.38), (0.0, 1.30), (0.06, 1.38), (0.12, 1.30)]
	for i in range(len(points) - 1):
		(x1, z1), (x2, z2) = points[i], points[i + 1]
		length = math.hypot(x2 - x1, z2 - z1)
		seg = toy.capsule(f'hotdog_sauce_{i}', radius=0.022, height=length + 0.044, loc=((x1 + x2) / 2, -0.1, (z1 + z2) / 2), mat=sauce, segments=10, rings=8)
		seg.rotation_euler = (DEG(-20), math.atan2(x2 - x1, z2 - z1), 0)
		parts.append(seg)
	return finish(parts, 'Costume_Hotdog', 'spine')


COSTUMES = {
	'cone': cone_hat,
	'frog': frog_hat,
	'pirate': pirate_hat,
	'hotdog': hotdog_suit,
}


def build_all():
	built = {}
	for key, make in COSTUMES.items():
		built[key] = make()
	return built


if __name__ == '__main__':
	toy.reset_scene()
	for key, obj in build_all().items():
		toy.export_glb(f'costume_{key}.glb', objects=[obj])
