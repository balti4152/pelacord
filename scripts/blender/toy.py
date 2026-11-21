"""
Base compartida para los modelos 3D de PelaCord (estilo "juguete de vinilo / plastilina").

Todo se genera por código para que se pueda regenerar y retocar sin abrir Blender:

    blender -b --python scripts/blender/build_all.py

Reglas del estilo (ver docs/estilo-3d.md):
- Colores sólidos, nada de texturas fotorrealistas.
- Materiales mate: roughness 0.8-0.9, metallic 0.
- Nada de bordes filosos: todo con bevel + suavizado.
- Pocos polígonos (corre en la web), pero siluetas gorditas.
"""
import math
import os

import bmesh
import bpy
from mathutils import Vector

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
MODELS_DIR = os.path.join(ROOT, 'public', 'models')
PREVIEW_DIR = os.path.join(ROOT, 'art', 'previews')

# ---------------------------------------------------------------- Paleta ----

PALETTE = {
	# Fondos oscuros saturados (no cansan la vista, hacen resaltar pantalla y personajes)
	'night_purple': (0.105, 0.062, 0.200),
	'midnight_blue': (0.050, 0.070, 0.180),
	'dark_crimson': (0.220, 0.035, 0.060),
	'floor_plum': (0.170, 0.105, 0.240),
	# Acentos vibrantes
	'sofa_purple': (0.520, 0.360, 0.900),
	'mustard': (0.960, 0.700, 0.150),
	'coral': (1.000, 0.450, 0.300),
	'sky': (0.420, 0.780, 1.000),
	'seat_red': (0.850, 0.090, 0.120),
	'mint': (0.400, 0.900, 0.700),
	'cream': (0.980, 0.930, 0.820),
	'wood': (0.620, 0.380, 0.220),
	'wood_dark': (0.380, 0.220, 0.130),
	'stone': (0.520, 0.500, 0.560),
	'white': (0.960, 0.960, 0.970),
	'ink': (0.040, 0.030, 0.050),
	'cone_orange': (1.000, 0.420, 0.060),
	'frog_green': (0.360, 0.800, 0.250),
	'sausage': (0.800, 0.300, 0.180),
	'bun': (0.960, 0.700, 0.380),
	'mustard_sauce': (1.000, 0.820, 0.100),
	'pirate_black': (0.080, 0.070, 0.090),
	'gold': (1.000, 0.780, 0.250),
}


def srgb_to_linear(c: float) -> float:
	return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4


def material(name: str, color, roughness: float = 0.85, emission: float = 0.0, emission_color=None):
	"""Material mate de juguete. `color` en sRGB (0-1) o nombre de la paleta."""
	if isinstance(color, str):
		color = PALETTE[color]
	existing = bpy.data.materials.get(name)
	if existing:
		return existing
	mat = bpy.data.materials.new(name)
	mat.use_nodes = True
	bsdf = mat.node_tree.nodes.get('Principled BSDF')
	linear = tuple(srgb_to_linear(c) for c in color) + (1.0,)
	bsdf.inputs['Base Color'].default_value = linear
	bsdf.inputs['Roughness'].default_value = roughness
	bsdf.inputs['Metallic'].default_value = 0.0
	if emission > 0:
		ecolor = emission_color or color
		if isinstance(ecolor, str):
			ecolor = PALETTE[ecolor]
		bsdf.inputs['Emission Color'].default_value = tuple(srgb_to_linear(c) for c in ecolor) + (1.0,)
		bsdf.inputs['Emission Strength'].default_value = emission
	mat.diffuse_color = linear
	return mat


# ------------------------------------------------------------ Escena -------

def reset_scene():
	"""Escena vacía. En segundo plano (-b) se reinicia de fábrica; en el Blender abierto (vía MCP)
	se borra el contenido a mano, porque reiniciar de fábrica con la interfaz abierta la rompe."""
	if bpy.app.background:
		bpy.ops.wm.read_factory_settings(use_empty=True)
	else:
		for obj in list(bpy.data.objects):
			bpy.data.objects.remove(obj, do_unlink=True)
		for col in list(bpy.data.collections):
			bpy.data.collections.remove(col)
		for store in (bpy.data.meshes, bpy.data.materials, bpy.data.armatures, bpy.data.actions,
				bpy.data.lights, bpy.data.cameras, bpy.data.curves, bpy.data.worlds):
			for block in list(store):
				store.remove(block)
	scene = bpy.context.scene
	scene.render.fps = 24
	scene.unit_settings.system = 'METRIC'
	return scene


def collection(name: str):
	col = bpy.data.collections.get(name) or bpy.data.collections.new(name)
	if col.name not in bpy.context.scene.collection.children:
		bpy.context.scene.collection.children.link(col)
	return col


def link(obj, col=None):
	for c in list(obj.users_collection):
		c.objects.unlink(obj)
	(col or bpy.context.scene.collection).objects.link(obj)
	return obj



def _ctx(active, selected=None):
	"""Contexto explícito para operadores: así andan igual en segundo plano y en el Blender abierto
	vía MCP (ahí no hay una ventana "activa" y operadores como join fallaban en silencio)."""
	selected = selected or [active]
	return bpy.context.temp_override(
		active_object=active, object=active, selected_objects=selected,
		selected_editable_objects=selected, view_layer=bpy.context.view_layer, scene=bpy.context.scene,
	)

def smooth(obj, angle_deg: float = 50):
	for poly in obj.data.polygons:
		poly.use_smooth = True
	# Bordes duros sólo donde el ángulo es muy marcado (Blender 4.1+).
	try:
		with _ctx(obj):
			bpy.ops.object.shade_auto_smooth(angle=math.radians(angle_deg))
	except Exception:
		pass
	return obj


def _new_mesh_object(name: str, bm: bmesh.types.BMesh, mat=None, col=None):
	mesh = bpy.data.meshes.new(name)
	bm.to_mesh(mesh)
	bm.free()
	obj = bpy.data.objects.new(name, mesh)
	link(obj, col)
	if mat:
		obj.data.materials.append(mat)
	return obj


def sphere(name, radius=0.5, scale=(1, 1, 1), loc=(0, 0, 0), mat=None, col=None, segments=24, rings=14):
	bm = bmesh.new()
	bmesh.ops.create_uvsphere(bm, u_segments=segments, v_segments=rings, radius=radius)
	for v in bm.verts:
		v.co = Vector((v.co.x * scale[0], v.co.y * scale[1], v.co.z * scale[2]))
	obj = _new_mesh_object(name, bm, mat, col)
	obj.location = loc
	return smooth(obj, 80)


def capsule(name, radius=0.2, height=0.6, scale=(1, 1, 1), loc=(0, 0, 0), mat=None, col=None, segments=24, rings=16):
	"""Cápsula vertical: `height` es el largo TOTAL (incluye las puntas redondas)."""
	bm = bmesh.new()
	bmesh.ops.create_uvsphere(bm, u_segments=segments, v_segments=rings, radius=radius)
	half = max(0.0, height / 2 - radius)
	for v in bm.verts:
		z = v.co.z + (half if v.co.z > 1e-6 else -half if v.co.z < -1e-6 else 0)
		v.co = Vector((v.co.x * scale[0], v.co.y * scale[1], z * scale[2]))
	obj = _new_mesh_object(name, bm, mat, col)
	obj.location = loc
	return smooth(obj, 80)


def cylinder(name, radius=0.1, depth=0.5, loc=(0, 0, 0), rot=(0, 0, 0), mat=None, col=None, segments=20, bevel=0.0):
	bm = bmesh.new()
	bmesh.ops.create_cone(bm, cap_ends=True, cap_tris=False, segments=segments, radius1=radius, radius2=radius, depth=depth)
	obj = _new_mesh_object(name, bm, mat, col)
	obj.location = loc
	obj.rotation_euler = rot
	if bevel > 0:
		round_edges(obj, bevel, segments=3)
	return smooth(obj)


def cone(name, r1=0.2, r2=0.0, depth=0.4, loc=(0, 0, 0), rot=(0, 0, 0), mat=None, col=None, segments=24, bevel=0.0):
	bm = bmesh.new()
	bmesh.ops.create_cone(bm, cap_ends=True, cap_tris=False, segments=segments, radius1=r1, radius2=max(r2, 0.0001), depth=depth)
	obj = _new_mesh_object(name, bm, mat, col)
	obj.location = loc
	obj.rotation_euler = rot
	if bevel > 0:
		round_edges(obj, bevel, segments=3)
	return smooth(obj)


def torus(name, major=0.3, minor=0.05, loc=(0, 0, 0), rot=(0, 0, 0), mat=None, col=None, major_seg=32, minor_seg=12):
	bpy.ops.mesh.primitive_torus_add(major_radius=major, minor_radius=minor, major_segments=major_seg, minor_segments=minor_seg, location=loc, rotation=rot)
	obj = bpy.context.active_object
	obj.name = name
	link(obj, col)
	if mat:
		obj.data.materials.append(mat)
	return smooth(obj, 80)


def round_edges(obj, width, segments=3):
	mod = obj.modifiers.new('Bevel', 'BEVEL')
	mod.width = width
	mod.segments = segments
	mod.limit_method = 'ANGLE'
	mod.harden_normals = False
	apply_modifiers(obj)
	return obj


def apply_modifiers(obj):
	with _ctx(obj):
		for mod in list(obj.modifiers):
			bpy.ops.object.modifier_apply(modifier=mod.name)


def rounded_box(name, size=(1, 1, 1), loc=(0, 0, 0), rot=(0, 0, 0), radius=0.08, mat=None, col=None, segments=4):
	"""Caja de "almohadón": bordes bien redondeados (nada filoso)."""
	bm = bmesh.new()
	bmesh.ops.create_cube(bm, size=1.0)
	for v in bm.verts:
		v.co = Vector((v.co.x * size[0], v.co.y * size[1], v.co.z * size[2]))
	obj = _new_mesh_object(name, bm, mat, col)
	r = min(radius, min(size) * 0.49)
	round_edges(obj, r, segments=segments)
	obj.location = loc
	obj.rotation_euler = rot
	return smooth(obj, 60)


def join(objects, name):
	"""Une varias piezas en un solo objeto (menos llamadas de dibujo en la web)."""
	objects = [o for o in objects if o]
	obj = objects[0]
	if len(objects) > 1:
		with _ctx(obj, objects):
			bpy.ops.object.join()
	obj.name = name
	obj.data.name = name
	obj.select_set(False)
	return obj


def apply_transforms(obj):
	with _ctx(obj):
		bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)


def set_origin(obj, point):
	"""Mueve el origen del objeto a `point` (en coordenadas del mundo) sin moverlo."""
	cursor = bpy.context.scene.cursor
	previous = cursor.location.copy()
	cursor.location = point
	with _ctx(obj):
		bpy.ops.object.origin_set(type='ORIGIN_CURSOR')
	cursor.location = previous


def empty(name, loc=(0, 0, 0), rot=(0, 0, 0), parent=None, col=None, display='PLAIN_AXES', size=0.15):
	obj = bpy.data.objects.new(name, None)
	obj.empty_display_type = display
	obj.empty_display_size = size
	obj.location = loc
	obj.rotation_euler = rot
	link(obj, col)
	if parent:
		obj.parent = parent
	return obj


def point_light(name, loc, color='cream', energy=60.0, radius=0.25, col=None):
	if isinstance(color, str):
		color = PALETTE[color]
	data = bpy.data.lights.new(name, 'POINT')
	data.color = color
	data.energy = energy
	data.shadow_soft_size = radius
	obj = bpy.data.objects.new(name, data)
	obj.location = loc
	link(obj, col)
	return obj


def mark_seat(name, loc, facing_deg=0.0, parent=None, col=None):
	"""Punto donde se sienta un avatar (la app pone ahí el anillo blanco de "sentate acá").

	Convención: el origen es la superficie del asiento y el eje -Y local mira hacia adelante
	(igual que el avatar), así la app coloca el avatar con la misma posición y rotación.
	"""
	seat = empty(f'Seat_{name}', loc=loc, rot=(0, 0, math.radians(facing_deg)), parent=parent, col=col, display='CIRCLE', size=0.2)
	seat['pelacord_seat'] = True
	return seat


# ---------------------------------------------------------- Exportar -------

def export_glb(filename: str, objects=None, animations: bool = False, lights: bool = False):
	os.makedirs(MODELS_DIR, exist_ok=True)
	path = os.path.join(MODELS_DIR, filename)
	for o in bpy.context.selected_objects:
		o.select_set(False)
	use_selection = objects is not None
	if use_selection:
		for o in objects:
			o.select_set(True)
	kwargs = dict(
		filepath=path,
		export_format='GLB',
		use_selection=use_selection,
		export_apply=True,
		export_yup=True,
		export_lights=lights,
		export_extras=True,
		export_animations=animations,
	)
	if animations:
		kwargs['export_animation_mode'] = 'ACTIONS'
	bpy.ops.export_scene.gltf(**kwargs)
	print(f'[pelacord-3d] exportado {path}')
	return path


# ------------------------------------------------------- Vista previa ------

def preview_rig(target=(0, 0, 0.6), distance=3.2, height=1.4, angle_deg=-28, background='night_purple', floor=True, lens=50):
	"""Cámara + luces "cozy" para revisar el estilo (no se exporta)."""
	scene = bpy.context.scene
	col = collection('_preview')
	target = Vector(target)
	rad = math.radians(angle_deg)
	cam_data = bpy.data.cameras.new('PreviewCam')
	cam_data.lens = lens
	cam = bpy.data.objects.new('PreviewCam', cam_data)
	cam.location = target + Vector((math.sin(rad) * distance, -math.cos(rad) * distance, height))
	direction = target - cam.location
	cam.rotation_euler = direction.to_track_quat('-Z', 'Y').to_euler()
	link(cam, col)
	scene.camera = cam

	key = bpy.data.lights.new('PreviewKey', 'AREA')
	key.energy = 260
	key.size = 3.0
	key.color = (1.0, 0.86, 0.72)
	key_obj = bpy.data.objects.new('PreviewKey', key)
	key_obj.location = target + Vector((-2.2, -2.4, 3.0))
	key_obj.rotation_euler = (target - key_obj.location).to_track_quat('-Z', 'Y').to_euler()
	link(key_obj, col)

	rim = bpy.data.lights.new('PreviewRim', 'AREA')
	rim.energy = 180
	rim.size = 2.0
	rim.color = (0.55, 0.5, 1.0)
	rim_obj = bpy.data.objects.new('PreviewRim', rim)
	rim_obj.location = target + Vector((2.4, 2.2, 2.2))
	rim_obj.rotation_euler = (target - rim_obj.location).to_track_quat('-Z', 'Y').to_euler()
	link(rim_obj, col)

	world = bpy.data.worlds.new('PreviewWorld')
	world.use_nodes = True
	bg = world.node_tree.nodes.get('Background')
	bg.inputs['Color'].default_value = tuple(srgb_to_linear(c) for c in PALETTE[background]) + (1.0,)
	bg.inputs['Strength'].default_value = 0.6
	scene.world = world

	if floor:
		ground = cylinder('_PreviewFloor', radius=6, depth=0.02, loc=(target.x, target.y, -0.011), mat=material('_floor', 'floor_plum'), col=col, segments=48)
		ground.hide_select = True
	return col


def render_preview(filename: str, resolution=(900, 900), frame=None):
	scene = bpy.context.scene
	scene.render.engine = 'BLENDER_EEVEE'
	scene.render.resolution_x, scene.render.resolution_y = resolution
	scene.render.film_transparent = False
	scene.view_settings.view_transform = 'AgX'
	try:
		scene.eevee.use_shadows = True
		scene.eevee.use_raytracing = False
	except Exception:
		pass
	if frame is not None:
		scene.frame_set(frame)
	os.makedirs(PREVIEW_DIR, exist_ok=True)
	scene.render.filepath = os.path.join(PREVIEW_DIR, filename)
	bpy.ops.render.render(write_still=True)
	print(f'[pelacord-3d] preview {scene.render.filepath}')


def remove_collection(name: str):
	col = bpy.data.collections.get(name)
	if not col:
		return
	for obj in list(col.objects):
		bpy.data.objects.remove(obj, do_unlink=True)
	bpy.data.collections.remove(col)
