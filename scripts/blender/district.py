"""El barrio del castillo, sus locales y los accesorios de las salas."""
import math
import random

import bpy

import arena
import sets
import shop
import toy
from city_square import flower_pot, leafy_tree
from organic import loft, sweep

PI = math.pi
WHEEL_ORDER = (0, 32, 15, 19, 4, 21, 2, 25, 17, 34, 6, 27, 13, 36, 11, 30, 8, 23,
	10, 5, 24, 16, 33, 1, 20, 14, 31, 9, 22, 18, 29, 7, 28, 12, 35, 3, 26)
RED_NUMBERS = {1, 3, 5, 7, 9, 12, 14, 16, 18, 19, 21, 23, 25, 27, 30, 32, 34, 36}


def palette():
	return {k: arena.glossy('District ' + k, color, emission) for k, (color, emission) in {
		'pink': (arena.PINK, 0), 'yellow': (arena.YELLOW, 0), 'blue': (arena.BLUE, 0),
		'mint': (arena.GREEN, 0), 'purple': (arena.PURPLE, 0), 'orange': (arena.ORANGE, 0),
		'cream': ((1, .91, .76), 0), 'navy': ((.24, .12, .42), 0),
		'copper': ((.69, .35, .25), 0), 'cafe': ((.99, .71, .55), 0),
		'rose': ((.91, .38, .40), 0), 'teal': ((.19, .63, .56), 0),
		'flannel': ((.18, .51, .51), 0), 'light': ((1, .81, .53), 1.45),
		'white': ((1, .95, .88), .53), 'neon': ((.46, .83, 1), 1.2),
		'cherry': ((.86, .025, .11), 0), 'cherry_dark': ((.60, .021, .094), 0),
		'leaf': ((.23, .65, .21), 0), 'steel': ((.56, .68, .77), 0),
	}.items()}


def block(name, loc, size, mat, radius=.12, rot=(0, 0, 0)):
	return toy.rounded_box(name, loc=loc, size=size, radius=radius, mat=mat, rot=rot, segments=3)


def combine(parts, name, solid=False):
	for obj in parts:
		toy.apply_transforms(obj)
	obj = toy.join(parts, name)
	if solid:
		obj['pelacord_solid'] = True
	return obj


def entrance(room, loc):
	door = toy.empty('Door_' + room, loc=loc, rot=(0, 0, PI))
	door['pelacord_door'] = room


def sign(label, loc, size, mat):
	return shop.text_mesh('Sign ' + label, label, size, loc, mat, extrude=.027, rot=(PI/2, 0, PI))


def build_castle(m):
	y = -20.6
	brick_colors = [m[k] for k in ('blue', 'pink', 'yellow', 'mint', 'purple', 'orange')]
	rng = random.Random(64)
	for side in (-1, 1):
		x = side * 2.73
		walls = [block('Tower plinth', (x, y, .24), (2.58, 2.82, .48), m['purple'], .23)]
		for row in range(8):
			widths = (.58, 1.06, .58) if row % 2 else (1.10, 1.10)
			for depth in (-.87, .87):
				at = x - 1.14
				for width in widths:
					walls.append(block('Rounded tower brick', (at+width/2, y+depth, .68+row*.404),
						(width-.038, .82, .395), rng.choice(brick_colors), .076))
					at += width+.036
			walls.append(block('Rounded side brick', (x-side*.73, y, .68+row*.404),
				(.78, 1.15, .395), rng.choice(brick_colors), .078))
			walls.append(block('Rounded side brick', (x+side*.73, y, .68+row*.404),
				(.78, 1.15, .395), rng.choice(brick_colors), .078))
		walls += [block('Tower cap band', (x, y, 3.82), (2.57, 2.76, .33), m['cream'], .16),
			block('Tower window frame', (x, y+1.33, 3.10), (.80,.18,1.10), m['cream'], .21),
			block('Tower window', (x, y+1.44, 3.10), (.58,.12,.86), m['light'], .17)]
		height = .55 if side < 0 else 0
		for k in range(4):
			walls.append(block('Crenellation', (x+(-.82 if k%2 else .82), y+(-.88 if k<2 else .88), 4.12),
				(.63,.63,.54), m['pink' if side<0 else 'mint'], .14))
		walls.append(loft('Rounded spire', [(3.95,x,y,.77,.80),(4.23,x,y,.72,.71),
			(4.53+height*.25,x,y,.50,.50),(4.94+height,x,y,.14,.14),(5.08+height,x,y,.042,.042)],
			m['blue' if side < 0 else 'pink']))
		walls.append(toy.sphere('Spire finial', radius=.15, loc=(x,y,5.07+height), mat=m['yellow'], segments=16, rings=10))
		walls.append(toy.cylinder('Flagstaff', radius=.034, depth=.81, loc=(x,y,5.52+height), mat=m['cream'], segments=12))
		walls.append(block('Pennant', (x+side*.28,y,5.75+height), (.58,.12,.27), m['yellow'], .06, (0,side*.12,0)))
		combine(walls, 'CastleTowerL' if side < 0 else 'CastleTowerR', solid=True)

	# El paso central queda libre. El arco sólo tiene geometría por encima del personaje.
	arch = []
	for i in range(11):
		angle = PI*i/10
		arch.append(block('Arch brick', (math.cos(angle)*1.81,y+.76,2.49+math.sin(angle)*1.06),
			(.50,.85,.50), brick_colors[(i+2)%len(brick_colors)], .109, (0,PI/2-angle,0)))
	arch.append(block('Castle title plaque', (0,y+1.20,3.94), (2.80,.26,.61), m['navy'], .25))
	arch.append(sign('CASTILLO', (0,y+1.36,3.95), .37, m['white']))
	combine(arch,'Castle arch')
	for j in range(4):
		for x in (-.83,0,.83):
			block('Castle approach Floor', (x,y+1.27-j*.63,.018), (.80,.60,.065),
				brick_colors[(j+int(x+1))%len(brick_colors)], .028)


def roof_sign(room, x, y, m):
	y += .65
	base = block('Roof emblem plinth', (x,y,4.09), (2.6,1.44,.33), m['navy'], .16)
	parts = [base]

	def rotated(name, u, v, size, material, angle, depth=0, radius=.10):
		return block(name, (x+u*math.cos(angle)+v*math.sin(angle),y+depth,5.29-u*math.sin(angle)+v*math.cos(angle)),
			size, material, radius, (0,angle,0))

	if room == 'casino':
		for side in (-1, 1):
			cx, cz = x+side*.61, 4.84+side*.09
			fruit = toy.sphere('Glossy cherry', radius=.68, loc=(cx,y,cz), mat=m['cherry' if side<0 else 'cherry_dark'], segments=32, rings=20)
			fruit.scale = (1.06,.76,.91)
			parts += [fruit, sweep('Cherry stem', [(cx,y,cz+.46,.103, .94),
					(cx+side*.015,y,cz+1.04,.095,.95),(x+side*.18,y,6.06,.093,1),(x+.20,y,6.34,.083,1)],
				m['leaf'], segments=12)]
			glint = toy.sphere('Cherry lacquer glint', radius=.10, loc=(cx+.24,y+.486,cz+.20), mat=m['rose'], segments=16, rings=10)
			glint.scale = (.75,.40,1.43)
			parts.append(glint)
		leaf = toy.sphere('Cherry leaf',radius=.46,loc=(x-.13,y,6.17),mat=m['mint'],segments=20,rings=12)
		leaf.scale = (1.06,.20,.43)
		leaf.rotation_euler.y = -.56
		parts.append(leaf)
		label = 'Giant roof cherries'
	else:
		a = -.59
		parts += [rotated('Fork handle',0,-.66,(.31,.28,1.45),m['copper'],a,.16, .105),
			rotated('Fork neck',0,.22,(.24,.23,.88),m['steel'],a,.16),
			rotated('Fork shoulders',0,.59,(.67,.22,.42),m['steel'],a,.16)]
		for i in range(4):
			parts.append(rotated('Fork tine',(i-1.5)*.174,.96,(.128,.22,.62),m['steel'],a,.16, .061))
		a = .59
		parts += [rotated('Knife handle',0,-.67,(.32,.30,1.48),m['copper'],a,-.17, .109),
			rotated('Knife bolster',0,.025,(.42,.31,.25),m['yellow'],a,-.17),
			rotated('Knife blade',.09,.66,(.47,.20,1.34),m['steel'],a,-.17, .089),
			rotated('Knife rounded tip',.079,1.22,(.43,.19,.30),m['steel'],a,-.17, .085)]
		label = 'Crossed roof cutlery'
	combine(parts, label)


def storefront(name, room, x, y, color, trim, m):
	width, depth = (6.6, 4.35)
	front = y+depth/2
	is_casino = room == 'casino'
	body = [block('Stone footing', (x,y,.17), (width+.14,depth+.12,.35), trim, .16),
		block('Rounded facade', (x,y,1.77), (width,depth,3.33), color, .30),
		block('Roof cornice', (x,y,3.45), (width+.39,depth+.38,.33), trim, .16),
		block('Roof crown', (x,y,3.77), (width-.24,depth-.06,.51), color, .24)]
	for side in (-1,1):
		win = x+side*(width*.32)
		body.append(block('Padded window frame',(win,front+.04,1.72),(width*.24,.24,1.91),trim,.27))
		body.append(block('Lit window',(win,front+.18,1.72),(width*.19,.13,1.57),m['neon' if is_casino else 'light'],.24))
		bar = m['navy'] if is_casino else m['copper']
		body.append(block('Vertical window mullion',(win,front+.254,1.72),(.072,.075,1.52),bar,.026))
		body.append(block('Window sill',(win,front+.29,.91),(width*.25,.42,.15),trim,.06))
		if room == 'restaurant':
			flower_pot('Cafe flowers',win,front+.68,.69,42+int(side),pink=True)
	body += [block('Door surround',(x,front+.12,1.32),(1.60,.31,2.66),trim,.44),
		block('Inset double door',(x,front+.30,1.29),(1.24,.20,2.37),m['navy' if is_casino else 'copper'],.39)]
	for side in (-1,1):
		body.append(block('Door handle',(x+side*.13,front+.41,1.21),(.060,.077,.25),m['yellow'],.025))
	if room == 'restaurant':
		for i in range(13):
			body.append(block('Canvas awning stripe',(x+(i-6)*.515,front+.57,2.61),(.515,1.16,.17),
				m['cream' if i%2 else 'rose'],.075, (.16,0,0)))
			body.append(block('Awning scallop',(x+(i-6)*.515,front+1.11,2.49),(.50,.15,.25),
				m['cream' if i%2 else 'rose'],.071))
	body.append(block('Marquee',(x,front+.20,3.23),(width*.73,.47,.79),m['navy' if is_casino else 'copper'],.26))
	body.append(sign(name,(x,front+.46,3.24),.47 if len(name)<10 else .40,m['white']))
	if is_casino:
		for i in range(13):
			body.append(toy.sphere('Marquee bulb',radius=.088,loc=(x+(i-6)*.353,front+.48,2.94),mat=m['light'],segments=12,rings=8))
	combine(body, {'restaurant':'Restaurant','casino':'Casino'}[room], solid=True)
	roof_sign(room, x, y, m)
	entrance(room, (x,front+.93,0))


def add_district(lamp):
	m = palette()
	build_castle(m)
	storefront('RESTAURANTE','restaurant',-16.5,-19.05,m['cafe'],m['cream'],m)
	storefront('CASINO','casino',16.5,-19.05,m['purple'],m['yellow'],m)
	from smithy import exterior
	exterior(21.35,-8.75)
	entrance('smithy',(21.35,-5.92,0))
	for i, (x,y) in enumerate(((-20,-14.4),(-10.5,-14.4),(-5.5,-17.1),(5.5,-17.1),(10.5,-14.4),(20,-14.4))):
		lamp('DistrictLamp_'+str(i),x,y)
	for i,(x,y) in enumerate(((-22.7,-18.6),(-9.4,-20.9),(8.6,-21.9),(22.5,-21.1),(-19.5,-10.9),(16.2,-7.9))):
		leafy_tree('District canopy '+str(i),x,y,.95,120+i,foliage='gold' if i%2 else 'olive')
	for i,(x,y) in enumerate(((-5.2,-19.6),(5.2,-19.6),(-12.5,-16.0),(12.5,-16.0),(-7.1,-13.1),(7.1,-13.1))):
		flower_pot('District blossoms '+str(i),x,y,.84,84+i,pink=i%2==0)


def pedestal(name, x, y, width, depth, colors, rounded=False):
	leg, apron, top = colors
	pieces = [toy.cylinder('Pedestal', radius=.115, depth=.74, loc=(x,y,.39), mat=leg, segments=14, bevel=.04)]
	if rounded:
		pieces.append(toy.cylinder('Rounded tabletop',radius=width/2,depth=.16,loc=(x,y,.79),mat=top,segments=28,bevel=.067))
	else:
		pieces.append(block('Table rail',(x,y,.74),(width,depth,.22),apron,.10))
		pieces.append(block('Tabletop',(x,y,.86),(width-.10,depth-.10,.07),top,.032))
	combine(pieces,name,solid=True)


def build_restaurant():
	m=palette()
	sets.room_shell(11, 9.5, 'cream', (.76,.57,.45), height=3.6)
	floors=[]
	for i in range(15):
		for j in range(13):
			floors.append(block('Bistro glazed tile',(-5.15+i*.735,-4.40+j*.735,.006),(.725,.725,.046),
				m['cream' if (i+j)%2 else 'cafe'],.018))
	combine(floors,'Bistro Floor')
	counter=block('Marble counter',(0,-3.32,.58),(7.1,1.12,1.10),m['teal'],.19)
	counter['pelacord_solid']=True
	block('Counter brass inlay',(0,-2.71,.68),(6.75,.06,.06),m['yellow'],.025)
	block('Marble counter top',(0,-3.30,1.14),(7.28,1.32,.17),m['cream'],.075)
	block('Kitchen recess',(0,-4.63,1.86),(8.25,.15,2.82),m['cafe'],.18)
	for x in (-3,-1.5,0,1.5,3):
		block('Kitchen cabinet',(x,-4.5,.8),(1.41,.23,1.23),m['copper'],.073)
		block('Cabinet knob',(x,-4.34,.84),(.26,.07,.07),m['yellow'],.028)
	for x in (-2.76,0,2.76):
		toy.cylinder('Pendant stem',radius=.024,depth=.84,loc=(x,-3.1,3.00),mat=m['copper'],segments=10)
		toy.cone('Pendant shade',r1=.25,r2=.105,depth=.28,loc=(x,-3.1,2.53),mat=m['rose'],segments=24,bevel=.052)
		toy.sphere('Pendant bulb',radius=.135,loc=(x,-3.1,2.40),mat=m['light'],segments=16,rings=10)
	for i,(x,y) in enumerate(((-3.38,-.40),(3.38,-.40),(-3.38,2.68),(3.38,2.68))):
		pedestal('BistroTable_'+str(i),x,y,1.60,1.60,(m['copper'],m['copper'],m['cream']),rounded=True)
		for s in (-1,1):
			sets.pouf('BistroChair_'+str(i)+'_'+str(s),(x+s*1.13,y,.0),'mint' if i%2 else 'coral')
		toy.cylinder('Dinner plate',radius=.22,depth=.034,loc=(x,y-.25,.89),mat=m['white'],segments=20,bevel=.011)
		toy.cylinder('Bud vase',radius=.09,depth=.22,loc=(x,y+.25,.98),mat=m['teal'],segments=16,bevel=.036)
		toy.sphere('Table flower',radius=.12,loc=(x,y+.25,1.16),mat=m['rose'],segments=14,rings=9)
	sign('CARTA',(0,-4.51,2.62),.57,m['white'])
	shop.hotspot('Restaurant menu',(0,-2.20,0),'restaurant-menu')
	toy.point_light('Bistro warm fill',(0,1.1,3.55),energy=260,color=(1,.83,.69))
	toy.empty('Spawn',loc=(0,3.80,0))
	return 'room_restaurant.glb'


def build_smithy():
	from smithy import build
	return build()


def build_casino():
	from casino_room import build
	return build()


def disco_ball():
	x,y,z=.15,-.52,3.44
	mats=[]
	for i,color in enumerate(((.89,.94,1),(.69,.81,1),(.94,.83,1),(.78,.91,.97),(.94,.98,1))):
		mat=toy.material('Mirror tile '+str(i),color,roughness=.19,emission=.09)
		next(n for n in mat.node_tree.nodes if n.type=='BSDF_PRINCIPLED').inputs['Metallic'].default_value=.48
		mats.append(mat)
	vertices,faces=[],[]
	for row in range(10):
		for col in range(20):
			start=len(vertices)
			for a,b in ((.035,.04),(.965,.04),(.965,.96),(.035,.96)):
				az=math.tau*(col+a)/20
				polar=PI*(row+b)/10
				vertices.append((.36*math.sin(polar)*math.cos(az),.36*math.sin(polar)*math.sin(az),.36*math.cos(polar)))
			faces.append((start,start+3,start+2,start+1))
	mesh=bpy.data.meshes.new('Mirrored disco tiles')
	mesh.from_pydata(vertices,[],faces)
	for mat in mats:mesh.materials.append(mat)
	for face in mesh.polygons:face.material_index=(face.index*7+face.index//17)%len(mats)
	ball=bpy.data.objects.new('DiscoBall',mesh)
	ball.location=(x,y,z)
	toy.link(ball)
	toy.cylinder('Disco ceiling anchor',radius=.15,depth=.10,loc=(x,y,z+.42),mat=mats[0],segments=18,bevel=.03)
	toy.empty('DiscoAnchor',loc=(x,y,z+.42))
