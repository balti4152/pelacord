"""Original animated city fauna and the shop's capture sphere."""
from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).parent))
import avatar
from organic import ellipsoid, line, loft, sweep
import toy

DEG = avatar.DEG


def clay(name, color, roughness=.58):
	return toy.material(name, color, roughness=roughness)


def eyes(pieces, x, y, z, size):
	ink = clay('Glossy eyes', (.082, .051, .105), .25)
	shine = clay('Soft catchlight', (.99, .95, .88), .36)
	for s in (-1, 1):
		pieces += [
			(ellipsoid('Eye', (s*x, y, z), (size, size*.66, size*1.12), ink), 'head'),
			(ellipsoid('Catchlight', (s*x-size*.23, y-size*.61, z+size*.29),
				(size*.24, size*.10, size*.25), shine), 'head'),
		]


def cheeks(pieces, x, y, z, color):
	material = clay('Rosy cheeks', color)
	for s in (-1, 1):
		mesh = ellipsoid('Tinted cheek', (s*x, y, z), (.060, .023, .038), material)
		mesh.rotation_euler.z = s * DEG(32)
		pieces.append((mesh, 'head'))


def paws(pieces, coords, material, size, sole=None):
	for i, (x, y, z) in enumerate(coords):
		name = f'foot_{i}'
		pieces.append((ellipsoid('Paw', (x, y, z), size, material), name))
		if sole is not None:
			for j in (-1, 0, 1):
				pieces.append((line('Toe seam', [
					(x+j*size[0]*.35, y-size[1]*.86, z-.014),
					(x+j*size[0]*.35, y-size[1]*.99, z+.006),
				], .004, sole), name))


def muzzle(pieces, y, z, width, color):
	ink = clay('Nose and mouth', color, .37)
	pieces += [
		(ellipsoid('Button nose', (0, y-.014, z), (width*.40, .018, width*.29), ink), 'head'),
		(line('Smile', [(-width, y+.005, z-.029), (-width*.52, y-.012, z-.041),
			(0, y-.018, z-.029), (width*.52, y-.012, z-.041), (width, y+.005, z-.029)],
			.007, ink), 'head'),
	]


def nuez():
	fur = clay('Toasted apricot', (.84, .47, .26))
	inner = clay('Soft cinnamon', (.64, .28, .23))
	bib = clay('Oat milk', (.99, .83, .61))
	feet = [(-.135, -.037, .083), (.135, -.037, .083)]
	pieces = [
		(loft('Pear shaped coat', [
			(.075, 0, .040, .087, .10), (.135, 0, .028, .216, .173),
			(.267, 0, .028, .228, .194), (.395, 0, .024, .163, .138), (.442, 0, .018, .057, .058),
		], fur), 'body'),
		(ellipsoid('Oat belly', (0, -.141, .233), (.149, .064, .141), bib), 'body'),
		(ellipsoid('Head', (0, -.030, .508), (.273, .220, .235), fur, segments=32, rings=18), 'head'),
		(ellipsoid('Cream muzzle', (0, -.220, .450), (.130, .063, .093), bib), 'head'),
		(sweep('Curled tail', [(0, .142, .207, .043, .95), (.072, .235, .230, .082, .92),
			(.101, .256, .334, .090, .87), (.039, .214, .385, .049, .9),
			(.003, .187, .366, .006, .7)], inner), 'tail'),
	]
	for s in (-1, 1):
		ear = ellipsoid('Round ear', (s*.187, .005, .679), (.086, .055, .102), fur)
		ear.rotation_euler.y = s * DEG(22)
		patch = ellipsoid('Ear lining', (s*.197, -.041, .697), (.053, .020, .066), inner)
		patch.rotation_euler.y = s * DEG(22)
		pieces.extend([(ear, 'head'), (patch, 'head'),
			(sweep('Soft arm', [(s*.137, .000, .370, .052, 1), (s*.220, -.023, .309, .075, .96),
				(s*.246, -.072, .219, .056, .90), (s*.233, -.098, .183, .008, .9)], fur), 'body')])
	eyes(pieces, .103, -.225, .530, .032)
	cheeks(pieces, .167, -.199, .467, (.94, .38, .34))
	muzzle(pieces, -.271, .462, .057, (.24, .105, .12))
	paws(pieces, feet, fur, (.096, .121, .085), inner)
	return pieces, feet, (0, .015, .377), (0, .156, .201)


def brote():
	from math import cos, sin, tau

	skin = clay('Warm pear', (.74, .79, .43))
	rim = clay('Sandstone shell lip', (.84, .69, .46))
	seam = clay('Deep moss', (.34, .45, .24))
	scutes = [clay('Moss tile', (.53, .65, .33)), clay('Olive tile', (.64, .72, .38))]
	petal = clay('Cream blossom', (.98, .93, .79))
	pollen = clay('Pollen', (.98, .69, .30))
	feet = [(s * .171, y, .077) for y in (-.134, .180) for s in (-1, 1)]
	pieces = [
		(ellipsoid('Soft belly', (0, .046, .157), (.233, .266, .111), skin), 'body'),
		(loft('Shell rim', [(.159, 0, .066, .185, .207), (.192, 0, .065, .273, .286),
			(.226, 0, .064, .284, .311), (.248, 0, .064, .260, .287)], rim, segments=36), 'body'),
		(loft('Moss shell', [(.229, 0, .064, .256, .292), (.273, 0, .075, .267, .288),
			(.358, 0, .092, .213, .235), (.428, 0, .098, .122, .142),
			(.450, 0, .098, .016, .023)], seam, segments=36), 'body'),
		(ellipsoid('Round head', (0, -.224, .255), (.196, .191, .167), skin, segments=32, rings=18), 'head'),
		(ellipsoid('Soft muzzle', (0, -.366, .207), (.119, .051, .063), skin), 'head'),
		(sweep('Tiny tail', [(0, .269, .158, .035, 1), (.012, .355, .158, .028, 1),
			(.035, .382, .186, .003, .9)], skin), 'tail'),
	]
	for i in range(7):
		a = tau * (i + .14) / 7
		x, y = cos(a), sin(a)
		tile = ellipsoid('Rounded shell tile', (.166*x, .09 + .184*y, .344),
			(.112, .095, .057), scutes[i % 2], segments=20)
		tile.rotation_euler = (0, .53, a)
		pieces.append((tile, 'body'))
	pieces.append((ellipsoid('Crown tile', (0, .097, .428), (.125, .136, .039), scutes[1]), 'body'))
	for cx, cy, z, r in ((-.056, .121, .471, .023), (.055, .123, .466, .019), (-.011, .196, .454, .016)):
		pieces.append((ellipsoid('Flower center', (cx, cy, z+.012), (r*.56, r*.56, .011), pollen), 'body'))
		for i in range(5):
			a = tau*i/5
			p = ellipsoid('Flower petal', (cx + cos(a)*r, cy + sin(a)*r, z),
				(r*.86, r*.56, .011), petal, segments=12, rings=8)
			p.rotation_euler.z = a
			pieces.append((p, 'body'))
	paws(pieces, feet, skin, (.091, .116, .077), rim)
	eyes(pieces, .086, -.388, .279, .029)
	cheeks(pieces, .121, -.360, .217, (.96, .60, .50))
	smile = clay('Moss ink', (.27, .26, .13), .45)
	pieces.append((line('Little smile', [(-.035, -.409, .210), (-.019, -.416, .200),
		(0, -.419, .196), (.019, -.416, .200), (.035, -.409, .210)], .0065, smile), 'head'))
	return pieces, feet, (0, -.136, .225), (0, .248, .164)


def bruma():
	fur = clay('Mulberry coat', (.51, .43, .68))
	dark = clay('Lavender boots', (.36, .27, .48))
	chest = clay('Cloud bib', (.94, .88, .84))
	inner = clay('Peach lining', (.87, .58, .63))
	feet = [(s*.114, y, .082) for y in (-.131, .165) for s in (-1, 1)]
	pieces = [
		(ellipsoid('Round chest and haunches', (0, .064, .211), (.194, .280, .183), fur), 'body'),
		(ellipsoid('Soft bib', (0, -.130, .244), (.151, .111, .156), chest), 'body'),
		(loft('Fox cheeks', [(.227, 0, -.182, .062, .084), (.286, 0, -.179, .168, .164),
			(.374, 0, -.167, .218, .190), (.486, 0, -.129, .195, .158),
			(.550, 0, -.102, .098, .089), (.566, 0, -.101, .019, .024)], fur), 'head'),
		(ellipsoid('Cream mask', (0, -.309, .319), (.175, .077, .081), chest), 'head'),
		(sweep('Fox brush', [(0, .294, .230, .062, .92), (.095, .405, .260, .092, .91),
			(.174, .428, .344, .113, .83), (.245, .397, .447, .084, .91),
			(.298, .327, .455, .005, .89)], fur, segments=16), 'tail'),
		(sweep('Cream tail tip', [(.209, .417, .388, .107, .85), (.256, .397, .448, .082, .91),
			(.304, .330, .457, .004, .89)], chest, segments=16), 'tail'),
	]
	for s in (-1, 1):
		tip = s * .218
		pieces.extend([
			(sweep('Folded fox ear', [(s*.107, -.093, .453, .101, .62),
				(s*.143, -.086, .535, .098, .62), (s*.192, -.071, .663, .049, .67),
				(tip, -.062, .711, .006, .78)], fur, segments=14), 'head'),
			(sweep('Folded ear lining', [(s*.125, -.152, .508, .064, .26),
				(s*.157, -.141, .557, .064, .27), (s*.191, -.104, .644, .029, .32),
				(s*.203, -.091, .668, .003, .35)], inner), 'head'),
		])
	paws(pieces, feet, dark, (.081, .119, .090))
	eyes(pieces, .094, -.333, .405, .031)
	cheeks(pieces, .135, -.347, .343, (.89, .57, .62))
	muzzle(pieces, -.388, .347, .045, (.18, .11, .24))
	return pieces, feet, (0, -.084, .298), (0, .292, .230)


SPECIES = {'nuez': nuez, 'brote': brote, 'bruma': bruma}


def build_pet(species):
	pieces, feet, head, tail = SPECIES[species]()
	bones = {
		'root': ((0, 0, 0), (0, 0, .10), None),
		'body': ((0, 0, .19), (0, 0, .40), 'root'),
		'head': (head, (head[0], head[1], head[2]+.14), 'body'),
		'tail': (tail, (tail[0], tail[1]+.14, tail[2]+.04), 'body'),
	}
	for i, (x, y, z) in enumerate(feet):
		bones[f'foot_{i}'] = ((x, y, z+.04), (x, y, z-.05), 'body')
	rig = avatar.build_armature(bones=bones, scale_face=False)
	rig.name = species.title()
	for obj, bone in pieces:
		avatar.assign(obj, bone)
		toy.apply_transforms(obj)
	mesh = toy.join([obj for obj, _ in pieces], 'Sculpt')
	mesh.parent = rig
	mesh.modifiers.new('Skin', 'ARMATURE').object = rig
	rig.animation_data_create()
	avatar.new_action(rig, 'Idle')
	for f, offset, curl in ((1, 0, 0), (13, .015, 11), (25, .009, 0), (37, .014, -11), (49, 0, 0)):
		avatar.key(rig, f, 'body', loc=(0, offset, 0))
		avatar.key(rig, f, 'head', rot=(0, curl*.2, curl*.4))
		avatar.key(rig, f, 'tail', rot=(0, 0, curl*1.4))
	avatar.new_action(rig, 'Walk')
	for f, phase, rise in ((1, 1, 0), (7, 0, .025), (13, -1, 0), (19, 0, .025), (25, 1, 0)):
		avatar.key(rig, f, 'body', loc=(0, rise, 0), rot=(0, 0, phase * 4))
		avatar.key(rig, f, 'head', rot=(phase * 3, 0, -phase * 5))
		avatar.key(rig, f, 'tail', rot=(0, 0, phase * 20))
		for i in range(len(feet)):
			sign = 1 if i in (0, 3) else -1
			avatar.key(rig, f, f'foot_{i}', rot=(phase * sign * 32, 0, phase * sign * 4))
	avatar.new_action(rig, 'Startled')
	for f, rise, tilt in ((1, 0, 0), (5, .016, -12), (12, .128, 9), (20, .023, -5), (29, 0, 0)):
		avatar.key(rig, f, 'body', loc=(0, rise, 0), rot=(tilt*.4, 0, 0))
		avatar.key(rig, f, 'head', rot=(tilt, 0, 0))
		avatar.key(rig, f, 'tail', rot=(0, 0, tilt*2))
	rig.animation_data.action = None
	avatar.reset_pose(rig)
	return rig, mesh


def capture_sphere():
	body = clay('Deep lilac enamel', (.50, .31, .80), .32)
	trim = clay('Porcelain band', (.91, .85, .99), .35)
	lens = toy.material('Mint glow', (.40, .92, .82), roughness=.31, emission=.37)
	pieces = [ellipsoid('Porcelain shell', (0, 0, 0), (.116, .116, .116), body),
		toy.torus('Latitude ring', major=.107, minor=.013, mat=trim, major_seg=32, minor_seg=8),
		ellipsoid('Mint lens mount', (0, -.104, .019), (.049, .026, .042), trim),
		ellipsoid('Mint lens', (0, -.126, .019), (.031, .015, .025), lens)]
	for s in (-1, 1):
		pieces.append(ellipsoid('Status dot', (s*.063, -.092, .040), (.009, .011, .009), lens))
	for part in pieces:
		toy.apply_transforms(part)
	return toy.join(pieces, 'Capture sphere')


def export_all():
	for species in SPECIES:
		toy.reset_scene()
		rig, mesh = build_pet(species)
		toy.export_glb(f'pet_{species}.glb', [rig, mesh], animations=True)
	toy.reset_scene()
	toy.export_glb('capture_sphere.glb', [capture_sphere()])


if __name__ == '__main__':
	export_all()
