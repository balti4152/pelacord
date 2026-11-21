"""
Avatar de PelaCord: muñeco de vinilo / plastilina (proporciones chibi).

- Cabeza ovalada fusionada al torso (sin cuello), ojitos juntos, nariz botón, cejas de rayita.
- Brazos y piernas cilíndricos, manos tipo mitón, zapatillas gorditas.
- Esqueleto RÍGIDO (cada pieza sigue a un hueso al 100%, como un Playmobil): es el look buscado y
  exporta perfecto a glTF / Three.js.
- Materiales con nombre fijo para que la app los recolore por usuario:
  Skin, Shirt, Pants, Shoes, Sole, Hair, Ink (ojos/boca/cejas).

Animaciones (24 fps), pensadas para mezclarse en Three.js (AnimationMixer):
  Idle (loop) · Walk (loop) · Sit (pose) · Talk (loop, sólo boca/cabeza) · Blink (sólo ojos)
  Wave · Slap
Convención: el avatar mira hacia -Y en Blender (= +Z en glTF, de frente a la cámara de Three).
"""
import math
import os
import sys

import bpy
from mathutils import Vector

sys.path.insert(0, os.path.dirname(__file__))
import toy  # noqa: E402

DEG = math.radians

# Dónde está cada hueso (cabeza -> cola). Brazos y piernas apuntan hacia ABAJO.
BONES = {
	'root': ((0, 0, 0), (0, 0, 0.12), None),
	'hips': ((0, 0, 0.38), (0, 0, 0.52), 'root'),
	'spine': ((0, 0, 0.52), (0, 0, 0.78), 'hips'),
	'head': ((0, 0, 0.80), (0, 0, 1.20), 'spine'),
	'mouth': ((0, -0.19, 0.865), (0, -0.19, 0.905), 'head'),
	'eye_L': ((0.052, -0.18, 0.985), (0.052, -0.18, 1.02), 'head'),
	'eye_R': ((-0.052, -0.18, 0.985), (-0.052, -0.18, 1.02), 'head'),
	'arm_L': ((0.215, 0, 0.74), (0.215, 0, 0.44), 'spine'),
	'arm_R': ((-0.215, 0, 0.74), (-0.215, 0, 0.44), 'spine'),
	'leg_L': ((0.088, 0, 0.40), (0.088, 0, 0.07), 'hips'),
	'leg_R': ((-0.088, 0, 0.40), (-0.088, 0, 0.07), 'hips'),
}


# Cabeza grande (proporción chibi): todo lo que va en la cabeza se agranda desde el cuello. Lo usan
# también el avatar modular (wardrobe.py) y los sombreros (costumes.py) para que encajen.
HEAD_SCALE = 1.18
HEAD_PIVOT = (0.0, 0.0, 0.80)
HEAD_BONES = {'head', 'mouth', 'eye_L', 'eye_R'}


def head_matrix():
	from mathutils import Matrix
	pivot = Vector(HEAD_PIVOT)
	return Matrix.Translation(pivot) @ Matrix.Scale(HEAD_SCALE, 4) @ Matrix.Translation(-pivot)


def scale_head_point(co):
	px, py, pz = HEAD_PIVOT
	return (px + (co[0] - px) * HEAD_SCALE, py + (co[1] - py) * HEAD_SCALE, pz + (co[2] - pz) * HEAD_SCALE)


def assign(obj, bone):
	group = obj.vertex_groups.new(name=bone)
	group.add([v.index for v in obj.data.vertices], 1.0, 'REPLACE')
	return obj


def hair_cap(name, mat):
	"""Pelo esculpido: una "gorra" maciza sobre la cabeza (como pieza de Playmobil)."""
	import bmesh

	bm = bmesh.new()
	bmesh.ops.create_uvsphere(bm, u_segments=28, v_segments=16, radius=0.214)
	remove = []
	for v in bm.verts:
		v.co = Vector((v.co.x * 1.02, v.co.y * 0.99, v.co.z * 1.14))
		# Adelante deja la frente libre; atrás baja hasta la nuca.
		front = max(0.0, -v.co.y) / 0.21
		limit = -0.09 + front * 0.17
		if v.co.z < limit:
			remove.append(v)
	bmesh.ops.delete(bm, geom=remove, context='VERTS')
	obj = toy._new_mesh_object(name, bm, mat)
	obj.location = (0, 0.004, 0.985)
	mod = obj.modifiers.new('Solid', 'SOLIDIFY')
	mod.thickness = 0.03
	mod.offset = 1
	sub = obj.modifiers.new('Soft', 'SUBSURF')
	sub.levels = 1
	toy.apply_modifiers(obj)
	return toy.smooth(obj, 80)


def build_body(colors=None, suffix=''):
	colors = colors or {}
	mats = {
		'Skin': toy.material('Skin' + suffix, colors.get('skin', (0.98, 0.78, 0.62))),
		'Shirt': toy.material('Shirt' + suffix, colors.get('shirt', 'sofa_purple')),
		'Pants': toy.material('Pants' + suffix, colors.get('pants', (0.22, 0.28, 0.52))),
		'Shoes': toy.material('Shoes' + suffix, colors.get('shoes', 'white')),
		'Sole': toy.material('Sole' + suffix, colors.get('sole', 'coral')),
		'Hair': toy.material('Hair' + suffix, colors.get('hair', (0.30, 0.17, 0.10))),
		'Ink': toy.material('Ink', 'ink', roughness=0.6),
	}
	parts = []

	# Torso tipo "frijol" + pantalón (la parte de abajo) — la cabeza se superpone: no hay cuello.
	parts.append(assign(toy.capsule('torso', radius=0.17, height=0.43, scale=(1.06, 0.82, 1), loc=(0, 0, 0.615), mat=mats['Shirt']), 'spine'))
	parts.append(assign(toy.capsule('pants', radius=0.163, height=0.2, scale=(1.06, 0.8, 1), loc=(0, 0, 0.43), mat=mats['Pants']), 'hips'))

	# Cabeza ovalada + cara minimalista.
	parts.append(assign(toy.sphere('head', radius=0.2, scale=(1.0, 0.95, 1.15), loc=(0, 0, 0.98), mat=mats['Skin']), 'head'))
	for side in (1, -1):
		parts.append(assign(toy.sphere(f'ear_{side}', radius=0.046, scale=(0.5, 0.75, 1.0), loc=(side * 0.196, 0.0, 0.97), mat=mats['Skin'], segments=14, rings=10), 'head'))
		brow = toy.capsule(f'brow_{side}', radius=0.0095, height=0.052, loc=(side * 0.056, -0.175, 1.058), mat=mats['Ink'], segments=10, rings=8)
		brow.rotation_euler = (0, DEG(90), DEG(side * 8))
		toy.apply_transforms(brow)
		parts.append(assign(brow, 'head'))
		eye = toy.sphere(f'eye_{side}', radius=0.024, scale=(1.0, 0.55, 1.18), loc=(side * 0.052, -0.18, 1.0), mat=mats['Ink'], segments=14, rings=10)
		parts.append(assign(eye, 'eye_L' if side > 0 else 'eye_R'))
	parts.append(assign(toy.sphere('nose', radius=0.029, scale=(1.0, 0.9, 0.95), loc=(0, -0.2, 0.948), mat=mats['Skin'], segments=14, rings=10), 'head'))
	parts.append(assign(toy.sphere('mouth', radius=0.034, scale=(1.25, 0.42, 0.42), loc=(0, -0.183, 0.885), mat=mats['Ink'], segments=16, rings=10), 'mouth'))
	parts.append(assign(hair_cap('hair', mats['Hair']), 'head'))

	# Brazos: manga corta + antebrazo + mitón con pulgar insinuado.
	for side, bone in ((1, 'arm_L'), (-1, 'arm_R')):
		x = side * 0.215
		parts.append(assign(toy.capsule(f'sleeve_{side}', radius=0.06, height=0.17, loc=(x, 0, 0.67), mat=mats['Shirt']), bone))
		parts.append(assign(toy.capsule(f'forearm_{side}', radius=0.047, height=0.2, loc=(x, 0, 0.55), mat=mats['Skin']), bone))
		parts.append(assign(toy.sphere(f'mitten_{side}', radius=0.06, scale=(0.85, 0.78, 1.05), loc=(x, -0.004, 0.44), mat=mats['Skin'], segments=16, rings=12), bone))
		parts.append(assign(toy.sphere(f'thumb_{side}', radius=0.024, scale=(1, 1, 1.3), loc=(x - side * 0.012, -0.045, 0.462), mat=mats['Skin'], segments=10, rings=8), bone))

	# Piernas + zapatillas redondeadas (cuerpo blanco y suela de color).
	for side, bone in ((1, 'leg_L'), (-1, 'leg_R')):
		x = side * 0.088
		parts.append(assign(toy.capsule(f'leg_{side}', radius=0.064, height=0.32, loc=(x, 0, 0.245), mat=mats['Pants']), bone))
		parts.append(assign(toy.rounded_box(f'shoe_{side}', size=(0.13, 0.215, 0.1), loc=(x, -0.03, 0.07), radius=0.046, mat=mats['Shoes']), bone))
		parts.append(assign(toy.rounded_box(f'sole_{side}', size=(0.126, 0.205, 0.03), loc=(x, -0.03, 0.016), radius=0.013, mat=mats['Sole']), bone))

	for part in parts:
		toy.apply_transforms(part)
	body = toy.join(parts, 'AvatarBody')
	return body


def build_armature():
	data = bpy.data.armatures.new('AvatarRig')
	rig = bpy.data.objects.new('Avatar', data)
	toy.link(rig)
	bpy.context.view_layer.objects.active = rig
	with toy._ctx(rig):
		bpy.ops.object.mode_set(mode='EDIT')
		for name, (head, tail, parent) in BONES.items():
			bone = data.edit_bones.new(name)
			# Los huesos de la cara siguen a la cabeza agrandada (si no, el parpadeo y la boca escalan
			# desde un punto corrido).
			if name in ('mouth', 'eye_L', 'eye_R'):
				head, tail = scale_head_point(head), scale_head_point(tail)
			elif name == 'head':
				tail = scale_head_point(tail)
			bone.head = head
			bone.tail = tail
			bone.roll = 0
			if parent:
				bone.parent = data.edit_bones[parent]
		bpy.ops.object.mode_set(mode='OBJECT')
	for pb in rig.pose.bones:
		pb.rotation_mode = 'XYZ'
	return rig


# ------------------------------------------------------------- Animación ----

def reset_pose(rig):
	for pb in rig.pose.bones:
		pb.location = (0, 0, 0)
		pb.rotation_euler = (0, 0, 0)
		pb.scale = (1, 1, 1)


def key(rig, frame, bone, rot=None, loc=None, scale=None):
	pb = rig.pose.bones[bone]
	if rot is not None:
		pb.rotation_euler = tuple(DEG(a) for a in rot)
		pb.keyframe_insert('rotation_euler', frame=frame)
	if loc is not None:
		pb.location = loc
		pb.keyframe_insert('location', frame=frame)
	if scale is not None:
		pb.scale = scale
		pb.keyframe_insert('scale', frame=frame)


def new_action(rig, name):
	reset_pose(rig)
	action = bpy.data.actions.new(name)
	action.use_fake_user = True
	rig.animation_data.action = action
	return action


# Ejes locales (huesos con roll 0):
#   huesos verticales hacia arriba: rot X = cabecear adelante/atrás, rot Y = girar, rot Z = inclinar
#   brazos/piernas hacia abajo:      rot X negativo = hacia adelante, rot Z = abrir hacia el costado
#   (brazo derecho se abre con Z positivo; el izquierdo con Z negativo)

def anim_idle(rig):
	"""Respiración simple: sin escalar nada (antes se estiraba la cabeza) y con el loop cerrado."""
	new_action(rig, 'Idle')
	for f, bob, tilt, arm in ((1, 0.0, 0, 6), (25, 0.006, 1.5, 8), (49, 0.0, 0, 6)):
		key(rig, f, 'hips', loc=(0, bob, 0))
		key(rig, f, 'head', rot=(tilt, 0, 0))
		key(rig, f, 'arm_L', rot=(0, 0, -arm))
		key(rig, f, 'arm_R', rot=(0, 0, arm))


def anim_walk(rig):
	new_action(rig, 'Walk')
	swing = 32
	for f, phase in ((1, 1), (7, 0), (13, -1), (19, 0), (25, 1)):
		key(rig, f, 'leg_L', rot=(-swing * phase, 0, 0))
		key(rig, f, 'leg_R', rot=(swing * phase, 0, 0))
		key(rig, f, 'arm_L', rot=(swing * 0.8 * phase, 0, -7))
		key(rig, f, 'arm_R', rot=(-swing * 0.8 * phase, 0, 7))
		# Bamboleo de muñeco: el torso se inclina hacia el pie que pisa.
		key(rig, f, 'spine', rot=(4, 0, 6 * phase))
		key(rig, f, 'head', rot=(-3, 0, -3 * phase))
	for f, up in ((1, 0.0), (7, 0.028), (13, 0.0), (19, 0.028), (25, 0.0)):
		key(rig, f, 'hips', loc=(0, up, 0))


def anim_sit(rig):
	new_action(rig, 'Sit')
	# El origen del avatar va en la superficie del asiento: la cadera baja y las piernas van adelante.
	for f in (1, 25):
		key(rig, f, 'hips', loc=(0, -0.31, 0.0), rot=(-4, 0, 0))
		key(rig, f, 'leg_L', rot=(-88, 0, -4))
		key(rig, f, 'leg_R', rot=(-88, 0, 4))
		key(rig, f, 'arm_L', rot=(-34, 0, -10))
		key(rig, f, 'arm_R', rot=(-34, 0, 10))
		key(rig, f, 'spine', rot=(-2, 0, 0))


def anim_talk(rig):
	new_action(rig, 'Talk')
	for f, open_, nod in ((1, 1.0, 0), (4, 2.3, 3), (7, 0.9, 0), (10, 1.9, 2), (13, 1.1, -1), (16, 2.5, 3), (19, 0.8, 0), (22, 1.7, 1), (25, 1.0, 0)):
		key(rig, f, 'mouth', scale=(1.0 + (open_ - 1) * 0.15, open_, 1))
		key(rig, f, 'head', rot=(nod, 0, 0))


def anim_blink(rig):
	new_action(rig, 'Blink')
	for f, s in ((1, 1.0), (3, 0.08), (5, 0.08), (7, 1.0)):
		for eye in ('eye_L', 'eye_R'):
			key(rig, f, eye, scale=(1, s, 1))


def anim_wave(rig):
	new_action(rig, 'Wave')
	key(rig, 1, 'arm_L', rot=(0, 0, -6))
	key(rig, 1, 'arm_R', rot=(0, 0, 6))
	key(rig, 1, 'head', rot=(0, 0, 0))
	key(rig, 7, 'arm_R', rot=(-10, 0, 150))
	for f, side in ((11, 1), (15, -1), (19, 1), (23, -1), (27, 1)):
		key(rig, f, 'arm_R', rot=(-10, 0, 150 + side * 18))
		key(rig, f, 'head', rot=(0, 0, side * 4))
	key(rig, 31, 'arm_R', rot=(-10, 0, 150))
	key(rig, 37, 'arm_R', rot=(0, 0, 6))
	key(rig, 37, 'head', rot=(0, 0, 0))


def anim_slap(rig):
	"""Cachetada/empujón: carga atrás, latigazo cruzado, vuelve (dura menos de 1 s)."""
	new_action(rig, 'Slap')
	key(rig, 1, 'arm_R', rot=(0, 0, 6))
	key(rig, 1, 'spine', rot=(0, 0, 0))
	key(rig, 1, 'head', rot=(0, 0, 0))
	key(rig, 7, 'arm_R', rot=(25, 0, 105))
	key(rig, 7, 'spine', rot=(0, 28, 0))
	key(rig, 7, 'head', rot=(0, -12, 0))
	key(rig, 10, 'arm_R', rot=(-80, 0, 70))
	key(rig, 10, 'spine', rot=(4, -32, 0))
	key(rig, 10, 'head', rot=(0, 10, 0))
	key(rig, 14, 'arm_R', rot=(-70, 0, 55))
	key(rig, 14, 'spine', rot=(2, -26, 0))
	key(rig, 21, 'arm_R', rot=(0, 0, 6))
	key(rig, 21, 'spine', rot=(0, 0, 0))
	key(rig, 21, 'head', rot=(0, 0, 0))


ANIMATIONS = (anim_idle, anim_walk, anim_sit, anim_talk, anim_blink, anim_wave, anim_slap)


def build(colors=None, suffix=''):
	body = build_body(colors, suffix)
	rig = build_armature()
	body.parent = rig
	mod = body.modifiers.new('Rig', 'ARMATURE')
	mod.object = rig
	rig.animation_data_create()
	for make in ANIMATIONS:
		make(rig)
	rig.animation_data.action = None
	reset_pose(rig)
	return rig, body


def pose_for_preview(rig, action_name, frame):
	rig.animation_data.action = bpy.data.actions[action_name]
	bpy.context.scene.frame_set(frame)


if __name__ == '__main__':
	toy.reset_scene()
	rig, body = build()
	toy.export_glb('avatar.glb', objects=[rig, body], animations=True)
