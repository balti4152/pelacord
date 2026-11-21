"""Surface tools for the world characters. Blender units; characters face -Y."""
import math

import bpy
from mathutils import Vector

import toy


def _mesh(name, rings, start, end, material):
	count = len(rings[0])
	points = [point for ring in rings for point in ring] + [start, end]
	last = (len(rings) - 1) * count
	faces = []
	for i in range(count):
		j = (i + 1) % count
		faces.append((len(points) - 2, j, i))
		for offset in range(0, last, count):
			faces.append((offset + i, offset + j, offset + count + j, offset + count + i))
		faces.append((len(points) - 1, last + i, last + j))
	mesh = bpy.data.meshes.new(name)
	mesh.from_pydata(points, [], faces)
	mesh.update()
	mesh.materials.append(material)
	obj = bpy.data.objects.new(name, mesh)
	toy.link(obj)
	for face in mesh.polygons:
		face.use_smooth = True
	return obj


def _sample(rows, detail):
	"""Interpolate sculpting guides before meshing; preserves their silhouettes."""
	for i in range(len(rows) - 1):
		a, b, c, d = (rows[max(0, i - 1)], rows[i], rows[i + 1], rows[min(i + 2, len(rows) - 1)])
		for step in range(detail):
			t = step / detail
			yield tuple(
				0.5 * (2 * y + (z - x) * t + (2 * x - 5 * y + 4 * z - v) * t*t
					+ (-x + 3 * y - 3 * z + v) * t*t*t)
				for x, y, z, v in zip(a, b, c, d)
			)
	yield rows[-1]


def loft(name, profile, material, *, segments=24, detail=3, flutes=0.0):
	"""Closed section loft from (z, center x, center y, half width, half depth)."""
	rings = []
	for z, x, y, rx, ry in _sample(profile, detail):
		ring = []
		for j in range(segments):
			a = 2 * math.pi * j / segments
			r = 1 + flutes * math.cos(8 * a)
			ring.append((x + math.cos(a) * max(.001, rx) * r, y + math.sin(a) * max(.001, ry) * r, z))
		rings.append(ring)
	return _mesh(name, rings, (profile[0][1], profile[0][2], profile[0][0]),
		(profile[-1][1], profile[-1][2], profile[-1][0]), material)


def sweep(name, guides, material, *, segments=10, detail=4):
	"""Closed tapered stroke from (x, y, z, radius, depth ratio)."""
	rows = list(_sample(guides, detail))
	rings = []
	for i, (x, y, z, radius, depth) in enumerate(rows):
		point = Vector((x, y, z))
		tangent = Vector(rows[min(i + 1, len(rows) - 1)][:3]) - Vector(rows[max(i - 1, 0)][:3])
		tangent.normalize()
		reference = Vector((0, -1, 0))
		if abs(reference.dot(tangent)) > .98:
			reference = Vector((0, 0, 1))
		side = reference.cross(tangent).normalized()
		normal = tangent.cross(side)
		r = max(.001, radius)
		rings.append([
			point + side * (math.cos(a) * r) + normal * (math.sin(a) * r * max(.08, depth))
			for a in (2 * math.pi * j / segments for j in range(segments))
		])
	return _mesh(name, rings, rows[0][:3], rows[-1][:3], material)


def line(name, path, radius, material):
	"""Rounded trim sewn onto clothing, or a tapered face detail."""
	return sweep(name, [(*point, radius * (.25 if i in (0, len(path) - 1) else 1), 1)
		for i, point in enumerate(path)], material, segments=8)


def ellipsoid(name, location, radii, material, *, segments=20, rings=12):
	return toy.sphere(name, radius=1, scale=radii, loc=location, mat=material, segments=segments, rings=rings)
