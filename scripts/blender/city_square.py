"""Hand-set cobbles, garden foliage and the carved fountain in the town square."""
import math
import random

import bmesh
from mathutils import Euler, Matrix, Vector

from organic import line, loft, sweep
import toy


def cobbled_square(district=False):
	rng = random.Random(214)
	materials = [toy.material(f'Cobble {i}', color, roughness=.80) for i, color in enumerate((
		(.71,.57,.60), (.79,.64,.63), (.71,.60,.67), (.66,.55,.63), (.81,.69,.65),
		(.76,.61,.64), (.70,.56,.59), (.79,.67,.67), (.67,.57,.66)))]
	bm = bmesh.new()

	def brick(x, y, width, length, angle):
		# Every stone has its own dome, irregular plan, seams and color.
		z = rng.uniform(.026,.046)
		tilt = angle + rng.uniform(-.022,.022)
		co, si = math.cos(tilt), math.sin(tilt)
		x += rng.uniform(-.015,.015)
		y += rng.uniform(-.009,.009)
		w, l = width*rng.uniform(.927,.98)/2, length*rng.uniform(.923,.98)/2
		corner = min(w,l)*.30
		contour = ((-w+corner,-l), (w-corner,-l), (w,-l+corner), (w,l-corner),
			(w-corner,l), (-w+corner,l), (-w,l-corner), (-w,-l+corner))
		def ring(height, scale):
			return [bm.verts.new((x+scale*(u*co-v*si), y+scale*(u*si+v*co), height)) for u,v in contour]
		bottom = ring(-.017, .93)
		edge = ring(z-.024, 1)
		top = ring(z, .87)
		color = rng.randrange(len(materials))
		bm.faces.new(top).material_index = color
		for a,b in ((bottom,edge),(edge,top)):
			for i in range(8):
				j=(i+1)%8
				bm.faces.new((a[i],a[j],b[j],b[i])).material_index=color

	# Radial rows, centered on the fountain. Alternate the joints from course to course.
	for row in range(13):
		radius = 1.93 + row*.387
		count = round(math.tau * radius/.66)
		pitch = math.tau/count
		for column in range(count):
			a = pitch*(column + .5*(row%2))
			brick(radius*math.cos(a),radius*math.sin(a),radius*pitch,.387,a+math.pi/2)

	# Winding into the shop fronts and through the side passages without covering the radial rows.
	for j in range(-21,20):
		y = j*.397
		for i in range(-24,25):
			x = (i+.5*(j%2))*.595
			if math.hypot(x,y) < 7.01:
				continue
			forecourt = -7.8 < y < -2.4 and abs(x) < 13.35
			sidewalk = 7.0 < abs(x) < 11.10 and -6.05 < y < 4.95
			entry = y > 4.27 and y < 7.60 and abs(x) < 2.92
			if forecourt or sidewalk or entry:
				brick(x,y,.595,.397,0)
	if district:
		for j in range(-54, 2):
			y = j*.43
			for i in range(-37, 38):
				x = (i+.5*(j%2))*.615
				boulevard = -18.0 < y < -12.28 and abs(x) < 22.95
				sides = -13.0 <= y < -.60 and 13.45 < abs(x) < 16.24
				castle = -23.45 < y <= -18 and abs(x) < 5.34
				terraces = -19.65 < y <= -18 and 12.37 < abs(x) < 21.33
				smith = -6.48 < y < -3.3 and 15.40 <= x < 23.3
				if boulevard or sides or castle or terraces or smith:
					brick(x,y,.615,.43,0)
	obj = toy._new_mesh_object('Plaza cobblestones', bm)
	for material in materials:
		obj.data.materials.append(material)
	return obj


def _collect(name, objects):
	for obj in objects:
		toy.apply_transforms(obj)
	return toy.join(objects,name)


def foliage_mesh(name, pieces):
	bm = bmesh.new()
	materials = []
	for location, radii, rotation, material, segments, rings in pieces:
		if material not in materials:
			materials.append(material)
		transform = (Matrix.Translation(Vector(location)) @ Euler(rotation).to_matrix().to_4x4()
			@ Matrix.Diagonal((*radii, 1)))
		vertices = bmesh.ops.create_uvsphere(bm, u_segments=segments, v_segments=rings, radius=1,
			matrix=transform)['verts']
		index = materials.index(material)
		for face in {f for vertex in vertices for f in vertex.link_faces}:
			face.material_index = index
			face.smooth = True
	obj = toy._new_mesh_object(name,bm)
	for material in materials:
		obj.data.materials.append(material)
	return obj


def leafy_tree(name, x, y, size, seed, foliage='olive'):
	rng = random.Random(seed)
	wood = toy.material('Sculpted tree bark', (.49,.341,.270), roughness=.84)
	palette = ((.45,.51,.26),(.57,.61,.32),(.66,.66,.34),(.37,.48,.29),(.57,.65,.36))
	if foliage == 'gold':
		palette = ((.66,.60,.29),(.74,.66,.34),(.57,.60,.32),(.49,.55,.27),(.61,.64,.35))
	leaves = [toy.material(f'{foliage} leaf {i}', color, roughness=.76) for i,color in enumerate(palette)]
	height=3.61*size
	parts = [sweep('Curved trunk', [(x,y,-.025,.24*size,1),(x-.18*size,y+.11*size,height*.41,.17*size,1),
		(x+.20*size,y+.16*size,height*.78,.13*size,1),(x+.34*size,y,height,.055*size,1)],wood,segments=10)]
	canopy = []
	for i in range(5):
		a=i*math.tau/5+.23
		dx,dy=math.cos(a),math.sin(a)
		z=height*(.70+rng.uniform(-.05,.19))
		end=(x+dx*1.01*size,y+dy*.86*size,z)
		parts.append(sweep('Forked branch', [(x,y,height*.49,.105*size,1),
			(x+dx*.57*size,y+dy*.50*size,z-.29*size,.075*size,1),(*end,.004,.8)],wood,segments=8))
		canopy.append((end,(.90*size,.79*size,.70*size),(0,0,0),leaves[i],14,9))
		for k in range(14):
			az = rng.random()*math.tau
			polar = rng.uniform(.32,2.38)
			p = (end[0]+.84*size*math.sin(polar)*math.cos(az),end[1]+.73*size*math.sin(polar)*math.sin(az),
				end[2]+.62*size*math.cos(polar))
			r = rng.uniform(.13,.28)*size
			mat = leaves[rng.randrange(len(leaves))]
			rot = (rng.uniform(-.6,.7), rng.uniform(-1.4,1.4), az)
			canopy.append((p,(.75*r,.37*r,1.24*r),rot,mat,9,6))
	parts.append(foliage_mesh('Layered tree canopy',canopy))
	return _collect(name,parts)


def flower_pot(name, x, y, size, seed, pink=True):
	rng = random.Random(seed)
	stone = toy.material('Honey pottery', (.79,.62,.46), roughness=.78)
	soil = toy.material('Rich garden soil', (.35,.28,.24))
	leaves = [toy.material('Hydrangea foliage '+str(i), c) for i,c in enumerate(((.31,.47,.26),(.43,.55,.32),(.52,.59,.31)))]
	flowers = [toy.material(('Pink' if pink else 'Cream')+' petal '+str(i), c) for i,c in enumerate(
		((.93,.58,.67),(.97,.71,.73),(.86,.47,.58)) if pink else ((.96,.84,.66),(.98,.92,.75),(.95,.77,.60)))]
	parts = [loft('Carved pottery',[(z*size,x,y,w*size,w*size) for z,w in (
		(.0,.23),(.045,.25),(.137,.32),(.32,.37),(.46,.315),(.49,.322),(.545,.329))],stone,segments=26),
		toy.cylinder('Soil in pot',radius=.288*size,depth=.026*size,loc=(x,y,.541*size),mat=soil,segments=18)]
	blooms = []
	for i in range(11):
		a=i*2.399+rng.uniform(-.19,.2)
		r=rng.uniform(.18,.43)*size
		p=(x+math.cos(a)*r,y+math.sin(a)*r,(.69+rng.uniform(-.06,.18))*size)
		r=.171*size
		blooms.append((p,(1.5*r,.62*r,.34*r),(0,.4+i*.11,a),leaves[i%3],11,7))
	for i in range(6):
		a=i*math.tau/5
		r=.24*size if i else 0
		c=(x+math.cos(a)*r,y+math.sin(a)*r,(.99+rng.uniform(-.04,.14))*size)
		for j in range(7):
			b=j*math.tau/6
			d=.105*size if j else 0
			r=.075*size
			p=(c[0]+math.cos(b)*d,c[1]+math.sin(b)*d,c[2]-(.047*size if j else 0))
			blooms.append((p,(r,.9*r,.77*r),(0,0,0),flowers[(i+j)%3],9,6))
	parts.append(foliage_mesh('Hydrangea bouquet',blooms))
	return _collect(name,parts)


def fountain():
	stone = toy.material('Fountain honey limestone', (.86,.71,.57), roughness=.68)
	trim = toy.material('Fountain pale roll', (.95,.83,.67), roughness=.56)
	shadow = toy.material('Fountain seams', (.69,.54,.45), roughness=.78)
	water = toy.material('Fountain water', (.36,.64,.69), roughness=.17, emission=.12)
	splash = toy.material('Water glints', (.66,.86,.86), roughness=.24, emission=.18)
	parts = [
		toy.cylinder('Base plinth',radius=1.85,depth=.13,loc=(0,0,.088),mat=shadow,segments=54,bevel=.046),
		toy.cylinder('Carved basin',radius=1.74,depth=.44,loc=(0,0,.285),mat=stone,segments=60,bevel=.076),
		toy.cylinder('FountainWater',radius=1.57,depth=.038,loc=(0,0,.504),mat=water,segments=60,bevel=.014),
		toy.torus('Rounded basin lip',major=1.61,minor=.117,loc=(0,0,.525),mat=trim,major_seg=60,minor_seg=10),
		loft('Turned fountain column', [(z,0,0,r,r) for z,r in ((.44,.34),(.51,.33),(.59,.255),
			(.70,.25),(.79,.21),(.95,.22),(1.14,.29),(1.22,.31))],stone,segments=28),
		loft('Upper cup', [(z,0,0,r,r) for z,r in ((1.16,.23),(1.23,.37),(1.32,.50),
			(1.40,.54),(1.43,.52))],trim,segments=34),
		toy.cylinder('Upper water',radius=.46,depth=.025,loc=(0,0,1.433),mat=water,segments=36,bevel=.011),
		toy.sphere('Stone finial',radius=.133,scale=(1,1,.87),loc=(0,0,1.561),mat=stone,segments=18,rings=11),
	]
	for i in range(14):
		a=math.tau*i/14
		x,y=math.cos(a),math.sin(a)
		parts.append(toy.rounded_box('Individual basin block',size=(.70,.22,.33),loc=(1.685*x,1.685*y,.303),
			rot=(0,0,a+math.pi/2),radius=.103,mat=stone if i%3 else shadow,segments=3))
	for i in range(6):
		a=math.tau*(i+.11)/6
		x,y=math.cos(a),math.sin(a)
		parts.append(line('Falling water',[(.47*x,.47*y,1.443),(.57*x,.57*y,1.404),
			(.71*x,.71*y,1.14),(.78*x,.78*y,.79),(.82*x,.82*y,.525)],.022,splash))
	for r in (.53,.85,1.15,1.39):
		parts.append(toy.torus('Subtle water ripple',major=r,minor=.008,loc=(0,0,.526),
			mat=splash,major_seg=40,minor_seg=6))
	return _collect('Fountain stonework and water',parts)
