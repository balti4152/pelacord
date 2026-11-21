"""Fit the six supplied silhouettes to the chibi head and give them a single clay material."""
from pathlib import Path
from math import copysign

import bpy
from mathutils import Vector

import toy

GUIDES = Path(toy.ROOT) / 'art' / 'source' / 'Hair Shapes.blend'
# Width, depth, hem, crown, front-to-back center in avatar space.
FIT = {
	'anime': (.842, .801, .913, 1.528, .010),
	'sidepart': (.872, .831, .910, 1.508, .031),
	'layers': (.849, .230, .723, 1.380, .276),
	'ayato': (.897, .830, .755, 1.488, .025),
	'highpony': (.799, 1.01, .632, 1.485, .135),
	'wavy': (.920, .843, .762, 1.472, .019),
}


def fitted_shape(name, material, skin):
	cache_name = 'Guide source ' + name
	source = bpy.data.meshes.get(cache_name)
	if source is None:
		with bpy.data.libraries.load(str(GUIDES), link=False) as (available, selected):
			if name not in available.meshes:
				raise ValueError(f'Missing silhouette {name} in {GUIDES.name}')
			selected.meshes = [name]
		source = selected.meshes[0]
		source.name = cache_name
	mesh = source.copy()
	mesh.name = 'Sculpted ' + name
	width, depth, hem, crown, center = FIT[name]
	for vertex in mesh.vertices:
		x, y, z = vertex.co
		point = Vector(((x - .5) * width, center + (y - .5) * depth, hem + z * (crown - hem)))
		if name == 'wavy' and point.y < -.16 and point.z < 1.105:
			strength = min(1, (1.105 - point.z) / .092) * min(1, (-.16 - point.y) / .09)
			point.x += copysign(max(0, .244 - abs(point.x)) * strength, point.x)
		if .864 < point.z < 1.390:
			origin = Vector((0, .010, point.z))
			radial = point - origin
			direction = radial.normalized()
			if radial.length > .001:
				_, _, _, surface_distance = skin.ray_cast(origin, direction)
				if surface_distance is not None and radial.length < surface_distance + .018:
					point = origin + direction * (surface_distance + .018)
		vertex.co = point
	mesh.materials.clear()
	mesh.materials.append(material)
	for face in mesh.polygons:
		face.material_index = 0
		face.use_smooth = True
	mesh.update()
	obj = bpy.data.objects.new(name + ' locks', mesh)
	toy.link(obj)
	if len(mesh.polygons) > 4200:
		reduce = obj.modifiers.new('Game resolution', 'DECIMATE')
		reduce.ratio = 4200 / len(mesh.polygons)
	thicken = obj.modifiers.new('Clay thickness', 'SOLIDIFY')
	thicken.thickness = .014
	thicken.offset = 0.0
	soften = obj.modifiers.new('Soft contours', 'SMOOTH')
	soften.factor = .45
	soften.iterations = 3
	toy.apply_modifiers(obj)
	return obj
