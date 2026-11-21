"""Import the supplied chibi FBX and fit modular clothing to its weighted surface."""
from collections import defaultdict
import math
from pathlib import Path

import bpy
from mathutils import Matrix, Vector

import avatar
import toy

SOURCE = Path(toy.ROOT) / 'art' / 'source' / 'BaseMesh_Chibi.fbx'
HEIGHT = ((0, 0), (.061, .31), (.077, .382), (.176, .703),
	(.195, .755), (.210, .802), (.475, 1.395))
TORSO = {'Spine', 'Spine1', 'Spine2', 'Neck', 'RightShoulder', 'Left_Shoulder'}
ROT = {s: Matrix.Rotation(math.radians(s * 65), 3, 'Y') for s in (-1, 1)}
SUFFIX = {-1: 'R', 1: 'L'}


def normalized(raw, kind):
	x, y, z = raw
	for (low, a), (high, b) in zip(HEIGHT, HEIGHT[1:]):
		if z <= high:
			break
	z_world = a + (z - low) * (b - a) / (high - low)
	if kind == 'F':
		waist = max(0, 1 - abs(z - .128) / .039)
		hip = max(0, 1 - abs(z - .078) / .043)
		shoulder = max(0, 1 - abs(z - .176) / .021)
		x *= 1 - .12 * waist + .11 * hip - .055 * shoulder
		y *= 1 - .07 * waist + .065 * hip
	return Vector((x * 2.50, y * 2.42, z_world))


def mapped_bone(name):
	if name in TORSO:
		return 'spine'
	if name == 'Hips':
		return 'hips'
	if name == 'Head':
		return 'head'
	side = 'R' if name.startswith('Right') else 'L'
	if 'ForeArm' in name or 'Hand' in name:
		return 'elbow_' + side
	if 'Arm' in name:
		return 'arm_' + side
	if 'UpLeg' in name:
		return 'leg_' + side
	if 'Leg' in name or 'Foot' in name:
		return 'knee_' + side
	return 'hips'


def vertex_weights(vertex, names):
	weights = defaultdict(float)
	for group in vertex.groups:
		weights[mapped_bone(names[group.group])] += group.weight
	keys = sorted(weights, key=weights.get, reverse=True)[:4]
	total = sum(weights[k] for k in keys)
	return {k: weights[k] / total for k in keys} if total > 0 else {'hips': 1.0}


def mix_weights(a, b, t):
	return {k: (1 - t) * a.get(k, 0) + t * b.get(k, 0) for k in a.keys() | b.keys()}


class Chibi:
	def __init__(self):
		existing = set(bpy.context.scene.objects)
		bpy.ops.import_scene.fbx(filepath=str(SOURCE), use_anim=False)
		self.imported = set(bpy.context.scene.objects) - existing
		self.source = next(obj for obj in self.imported if obj.name.startswith('SM_Chibi_Body'))
		source_rig = next(obj for obj in self.imported if obj.type == 'ARMATURE')
		self.joints = {bone.name: source_rig.matrix_world @ bone.head_local for bone in source_rig.data.bones}
		self.raw = [self.source.matrix_world @ vertex.co for vertex in self.source.data.vertices]
		names = [group.name for group in self.source.vertex_groups]
		self.weights = [vertex_weights(v, names) for v in self.source.data.vertices]
		self.tailoring = {}

	def relaxed(self, raw, weights, kind):
		point = normalized(raw, kind)
		s = -1 if raw.x < 0 else 1
		side = SUFFIX[s]
		arm_weight = weights.get('arm_' + side, 0) + weights.get('elbow_' + side, 0)
		if arm_weight:
			shoulder = normalized(self.joints['RightArm' if s < 0 else 'Left_Arm'], kind)
			return point.lerp(shoulder + ROT[s] @ (point - shoulder), arm_weight)
		return point

	def relaxed_normal(self, raw, normal, weights):
		s = -1 if raw.x < 0 else 1
		side = SUFFIX[s]
		weight = weights.get('arm_' + side, 0) + weights.get('elbow_' + side, 0)
		return normal.lerp(ROT[s] @ normal, weight)

	def rig(self):
		# Keep the socket and animation names used by Three.js. Canonical local Y
		# follows the limb so the existing emotes keep the same axes.
		bones = {
			'root': ((0, 0, 0), (0, 0, .12), None),
			'hips': ((0, 0, .382), (0, 0, .51), 'root'),
			'spine': ((0, 0, .50), (0, 0, .745), 'hips'),
			'head': ((0, 0, .782), (0, 0, 1.32), 'spine'),
			'mouth': ((0, -.28, .921), (0, -.28, .980), 'head'),
			'eye_L': ((.091, -.305, 1.06), (.091, -.305, 1.12), 'head'),
			'eye_R': ((-.091, -.305, 1.06), (-.091, -.305, 1.12), 'head'),
		}
		for s, shoulder, elbow, hand, thigh, knee, foot in (
			(-1, 'RightArm', 'RightForeArm', 'RightHand', 'RightUpLeg', 'RightLeg', 'RightFoot'),
			(1, 'Left_Arm', 'Left_ForeArm', 'Left_Hand', 'Left_UpLeg', 'Left_Leg', 'Left_Foot'),
		):
			side = SUFFIX[s]
			a = normalized(self.joints[shoulder], 'M')
			e = a + ROT[s] @ (normalized(self.joints[elbow], 'M') - a)
			h = a + ROT[s] @ (normalized(self.joints[hand], 'M') - a)
			l, k, f = (normalized(self.joints[joint], 'M') for joint in (thigh, knee, foot))
			bones['arm_' + side] = (a, e, 'spine')
			bones['elbow_' + side] = (e, h, 'arm_' + side)
			bones['leg_' + side] = (l, k, 'hips')
			bones['knee_' + side] = (k, f, 'leg_' + side)
		return avatar.build_armature(bones=bones, scale_face=False)

	def body(self, kind, material, keep_raw=False):
		mesh = self.source.data.copy()
		mesh.name = 'Chibi skin ' + kind
		mesh.materials.clear()
		mesh.materials.append(material)
		for v, raw, weights in zip(mesh.vertices, self.raw, self.weights):
			v.co = self.relaxed(raw, weights, kind)
		if keep_raw:
			bind_coordinates = mesh.attributes.new('Tailoring coordinates', 'FLOAT_VECTOR', 'POINT')
			for attr, point in zip(bind_coordinates.data, self.raw):
				attr.vector = point
		for face in mesh.polygons:
			face.use_smooth = True
		mesh.update()
		obj = bpy.data.objects.new('Chibi skin ' + kind, mesh)
		toy.link(obj)
		apply_weights(obj, self.weights)
		sub = obj.modifiers.new('Smooth original contours', 'SUBSURF')
		sub.levels = 1
		toy.apply_modifiers(obj)
		return obj

	def clothing_surface(self, kind, material):
		"""Sample from the same welded and smoothed mesh that is rendered as skin."""
		if kind not in self.tailoring:
			body = self.body(kind, material, keep_raw=True)
			mesh = body.data
			raw = mesh.attributes['Tailoring coordinates'].data
			names = [group.name for group in body.vertex_groups]
			points = [(r.vector.copy(), v.co.copy(), v.normal.copy(),
				{names[g.group]: g.weight for g in v.groups}) for v, r in zip(mesh.vertices, raw)]
			self.tailoring[kind] = (points, [tuple(p.vertices) for p in mesh.polygons])
			bpy.data.objects.remove(body, do_unlink=True)
			bpy.data.meshes.remove(mesh)
		return self.tailoring[kind]

	def garment(self, name, kind, material, cuts, offset, tailored=False):
		"""Clip a fitted shell from the source, then retain the FBX skin weights."""
		if tailored:
			surface, polygons = self.clothing_surface(kind, material)
		else:
			normal_matrix = self.source.matrix_world.to_3x3()
			surface = [(raw, self.relaxed(raw, w, kind),
				self.relaxed_normal(raw, (normal_matrix @ v.normal).normalized(), w), w)
				for v, raw, w in zip(self.source.data.vertices, self.raw, self.weights)]
			polygons = [p.vertices for p in self.source.data.polygons]
		vertices, weights, faces, unique = [], [], [], {}

		def add(point):
			raw, pos, normal, w = point
			key = tuple(round(c, 6) for c in raw)
			if key not in unique:
				unique[key] = len(vertices)
				vertices.append(pos + normal.normalized() * offset)
				weights.append(w)
			return unique[key]

		for polygon in polygons:
			points = [surface[i] for i in polygon]
			for plane in cuts:
				points = clip(points, plane)
				if len(points) < 3:
					break
			if len(points) >= 3:
				face = list(dict.fromkeys(add(point) for point in points))
				if len(face) >= 3:
					faces.append(face)
		mesh = bpy.data.meshes.new(name)
		mesh.from_pydata(vertices, [], faces)
		mesh.materials.append(material)
		mesh.update()
		for face in mesh.polygons:
			face.use_smooth = True
		obj = bpy.data.objects.new(name, mesh)
		toy.link(obj)
		apply_weights(obj, weights)
		return obj

	def surface(self):
		"""The smoothed skin surface for fitting face and hair pieces."""
		from mathutils.bvhtree import BVHTree
		if not hasattr(self, 'head_surface'):
			body = self.body('M', toy.material('Face fitting', 'cream'))
			self.head_surface = BVHTree.FromPolygons(
				[v.co.copy() for v in body.data.vertices], [tuple(p.vertices) for p in body.data.polygons],
			)
			mesh = body.data
			bpy.data.objects.remove(body, do_unlink=True)
			bpy.data.meshes.remove(mesh)
		return self.head_surface

	def front_y(self, x, z, fallback):
		hit, _, _, _ = self.surface().ray_cast(Vector((x, -2, z)), Vector((0, 1, 0)))
		return hit.y if hit else fallback

	def cleanup(self):
		for obj in self.imported:
			bpy.data.objects.remove(obj, do_unlink=True)


def clip(points, plane):
	result = []
	for a, b in zip(points[-1:] + points[:-1], points):
		d0, d1 = plane(a[0]), plane(b[0])
		if (d0 >= 0) != (d1 >= 0):
			t = d0 / (d0 - d1)
			result.append(tuple(a[i].lerp(b[i], t) for i in range(3)) + (mix_weights(a[3], b[3], t),))
		if d1 >= 0:
			result.append(b)
	return result


def apply_weights(obj, weights):
	groups = {}
	for i, point in enumerate(weights):
		influences = sorted(((name, w) for name, w in point.items() if w > 1e-5), key=lambda pair: -pair[1])[:4]
		total = sum(w for _, w in influences)
		for name, weight in influences:
			if name not in groups:
				groups[name] = obj.vertex_groups.new(name=name)
			groups[name].add([i], weight / total, 'REPLACE')


def animate(rig):
	rig.animation_data_create()
	for make in avatar.ANIMATIONS:
		make(rig)
		if make is avatar.anim_walk:
			for frame, a, b in ((1, 8, 28), (7, 32, 7), (13, 28, 8), (19, 7, 32), (25, 8, 28)):
				avatar.key(rig, frame, 'knee_L', rot=(a, 0, 0))
				avatar.key(rig, frame, 'knee_R', rot=(b, 0, 0))
				avatar.key(rig, frame, 'elbow_L', rot=(-11, 0, 0))
				avatar.key(rig, frame, 'elbow_R', rot=(-11, 0, 0))
		elif make is avatar.anim_sit:
			for frame in (1, 25):
				avatar.key(rig, frame, 'knee_L', rot=(40, 0, 0))
				avatar.key(rig, frame, 'knee_R', rot=(40, 0, 0))
		elif make is avatar.anim_wave:
			for frame, bend in ((1, 0), (7, -25), (15, -39), (27, -25), (37, 0)):
				avatar.key(rig, frame, 'elbow_R', rot=(bend, 0, 0))
	rig.animation_data.action = None
	avatar.reset_pose(rig)
