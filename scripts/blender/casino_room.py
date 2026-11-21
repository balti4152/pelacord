"""The La Cereza casino, its roulette wheel and the carved slot symbols."""
import math
import random

import bpy
from mathutils import Vector

import shop
import toy
from organic import loft, sweep

TAU = math.tau
WHEEL = (0, 32, 15, 19, 4, 21, 2, 25, 17, 34, 6, 27, 13, 36, 11, 30, 8, 23,
	10, 5, 24, 16, 33, 1, 20, 14, 31, 9, 22, 18, 29, 7, 28, 12, 35, 3, 26)
RED = {1, 3, 5, 7, 9, 12, 14, 16, 18, 19, 21, 23, 25, 27, 30, 32, 34, 36}


def palette():
	colors = {
		'mahogany': ((.21,.076,.098),.52), 'wood': ((.49,.22,.16),.43), 'wood light': ((.64,.31,.21),.45),
		'wine': ((.46,.13,.21),.83), 'berry': ((.78,.26,.34),.53), 'blush': ((.93,.46,.46),.59),
		'plaster': ((.72,.51,.46),.83), 'brass': ((.88,.61,.29),.32), 'ivory': ((1,.89,.73),.52),
		'jade': ((.16,.40,.34),.91), 'green': ((.24,.54,.39),.62), 'ink': ((.115,.10,.16),.46),
		'blue': ((.28,.61,.90),.27), 'pink': ((.83,.31,.65),.31), 'lemon': ((1,.75,.20),.32),
	}
	m = {name: toy.material('Cereza ' + name, color, roughness) for name,(color,roughness) in colors.items()}
	m['light'] = toy.material('Cereza opal', (1,.88,.68), .33, emission=.65, emission_color=(1,.75,.49))
	return m


def box(name, x, y, z, width, depth, height, mat, bevel=.08, rot=(0,0,0)):
	return toy.rounded_box(name, loc=(x,y,z), size=(width,depth,height), mat=mat, radius=bevel, rot=rot, segments=3)


def orb(name, x, y, z, dimensions, mat):
	return toy.sphere(name, radius=1, loc=(x,y,z), scale=dimensions, mat=mat, segments=24, rings=16)


def disc(name, x, y, z, radius, height, mat, bevel=.04, segments=56):
	return toy.cylinder(name, radius=radius, depth=height, loc=(x,y,z), mat=mat, segments=segments, bevel=bevel)


def merge(parts, name, solid=False):
	for part in parts:
		toy.apply_transforms(part)
	obj = toy.join(parts,name)
	if solid: obj['pelacord_solid'] = True
	return obj


def label(body, x, y, z, size, material):
	return shop.text_mesh('Casino lettering ' + body, body, size, (x,y,z), material, extrude=.010,
		rot=(math.pi/2,0,math.pi))


def cherry(x, y, z, size, m):
	for side in (-1,1):
		cx=x+side*size*.37
		cz=z+.055*side*size
		orb('Glazed cherry',cx,y,cz,(size*.42,size*.39,size*.39),m['berry' if side<0 else 'wine'])
		orb('Cherry shine',cx-size*.12,y+size*.32,cz+size*.17,(size*.089,size*.026,size*.057),m['blush'])
		pts=[(cx,y,cz+size*.29,size*.045,1),(cx+side*size*.025,y,cz+size*.52,size*.038,1),
			(x+size*.05,y,z+size*.74,size*.035,1),(x+size*.19,y,z+size*.87,size*.032,1)]
		sweep('Cherry stem',pts,m['green'],segments=12)
	leaf=orb('Cherry leaf',x-size*.08,y,z+size*.77,(size*.25,size*.06,size*.125),m['green'])
	leaf.rotation_euler.y=-.38


def make_wheel(x, y, z, m):
	base = [disc('Turned mahogany wheel case',x,y,z-.12,.93,.29,m['mahogany'],.075),
		disc('Roulette wood bevel',x,y,z-.012,.90,.11,m['wood'],.047),
		disc('Roulette inset',x,y,z+.026,.80,.061,m['ink'],.023)]
	for radius, height, thick, material in ((.869,.051,.026,m['brass']),(.814,.053,.017,m['ivory']),(.762,.048,.019,m['brass'])):
		base.append(toy.torus('Roulette racing rail',major=radius,minor=thick,loc=(x,y,z+height),mat=material,major_seg=96,minor_seg=8))
	merge(base,'CasinoWheelBase')

	rotor = [disc('Pocket bed',x,y,z+.035,.733,.057,m['ink'],.020),
		disc('Roulette instrument bowl',x,y,z+.076,.47,.10,m['mahogany'],.048),
		disc('Turned spindle',x,y,z+.128,.133,.24,m['brass'],.047),
		orb('Spindle crown',x,y,z+.279,(.094,.094,.057),m['ivory'])]
	for index, number in enumerate(WHEEL):
		angle = TAU*index/len(WHEEL)
		sin, cos = math.sin(angle), math.cos(angle)
		pocket = m['green'] if number == 0 else m['wine'] if number in RED else m['ink']
		rotor.append(box('Curved roulette pocket',x+.654*sin,y+.654*cos,z+.076,.108,.152,.022,pocket,.009,(0,0,-angle)))
		rotor.append(box('Rounded pocket divider',x+.647*math.sin(angle+TAU/74),y+.647*math.cos(angle+TAU/74),z+.096,
			.010,.148,.020,m['brass'],.004,(0,0,-angle-TAU/74)))
		rotor.append(shop.text_mesh('Wheel number',str(number),.054,(x+.657*sin,y+.657*cos,z+.091),m['ivory'],
			extrude=0,rot=(0,0,math.pi-angle)))
	for radius in (.516,.565,.736):
		rotor.append(toy.torus('Brass inlay',major=radius,minor=.009,loc=(x,y,z+.079),mat=m['brass'],major_seg=96,minor_seg=8))
	wheel = merge(rotor,'CasinoWheelRotor')
	toy.set_origin(wheel,(x,y,z))
	orb('CasinoWheelBall',x,y+.654,z+.127,(.035,.035,.035),m['ivory'])


def casino_table(x,y,label_text,game,m):
	parts = [disc('Table foot',x,y,.15,.72,.28,m['mahogany'],.071),
		disc('Table pedestal',x,y,.48,.29,.73,m['wood'],.08),
		box('Carved walnut playing table',x,y,.83,3.43,2.25,.25,m['wood'],.32),
		box('Brass border',x,y,.949,3.30,2.12,.073,m['brass'],.29),
		box('Inset table felt',x,y,.985,3.20,2.00,.052,m['jade'],.29)]
	merge(parts,label_text.title()+' table',True)
	shop.hotspot(label_text+' action',(x,y+1.58,0),'casino-'+game)
	for dx in (-1.13,1.13):
		px=x+dx
		disc('Stool foot',px,y+1.42,.072,.26,.128,m['mahogany'])
		disc('Stool brass stem',px,y+1.42,.26,.12,.44,m['brass'])
		orb('Velvet stool',px,y+1.42,.48,(.32,.32,.125),m['wine'])


def plaque(label_text,x,y,z,m):
	box('Inset nameplate',x,y,z,2.94,.17,.49,m['mahogany'],.12)
	box('Nameplate brass liner',x,y+.09,z,2.82,.033,.395,m['brass'],.095)
	box('Nameplate velvet',x,y+.112,z,2.74,.033,.324,m['wine'],.081)
	label(label_text,x,y+.14,z,.19,m['ivory'])


def build():
	m=palette()
	rng=random.Random(314)
	box('Walnut Floor',0,0,-.125,16.10,13.35,.24,m['mahogany'],.09)
	tiles=[]
	for row in range(21):
		for col in range(17):
			cx=(col-8)*.93
			cy=(row-10)*.625
			tiles.append(box('Rounded parquet stave',cx,cy,.002,.901,.596,.027,m[rng.choice(('wood','wood','wood light'))],.012))
	merge(tiles,'Casino parquet Floor')
	box('Velvet entry rug Floor',0,3.53,.022,5.75,5.85,.039,m['ivory'],.25)
	box('Entry carpet Floor',0,3.53,.039,5.58,5.64,.054,m['wine'],.22)
	box('Rear plaster Room',0,-6.51,2.22,16.05,.29,4.43,m['plaster'],.14)
	for x in (-7.91,7.91):
		box('Side plaster Room',x,0,2.22,.24,13.1,4.43,m['plaster'],.14)
		box('Walnut side panel Room',x,0,.66,.31,13.1,1.31,m['mahogany'],.09)
		box('Brass side moulding Room',x,0,1.33,.36,13.1,.07,m['brass'],.027)
	box('Walnut rear wainscot Room',0,-6.32,.66,15.62,.24,1.31,m['mahogany'],.09)
	box('Brass rear moulding Room',0,-6.14,1.34,15.62,.18,.073,m['brass'],.03)
	for x in (-7.44,-2.58,2.58,7.44):
		box('Walnut fluted pilaster',x,-6.11,2.03,.31,.34,3.98,m['wood'],.09)
		for dx in (-.085,0,.085):
			box('Milled pilaster flute',x+dx,-5.92,2.08,.031,.067,3.53,m['wood light'],.013)
		box('Pilaster capital',x,-6.10,3.98,.49,.42,.27,m['brass'],.07)
	for x in (-5.09,0,5.09):
		box('Velvet inset arch lining',x,-6.30,2.65,3.88,.16,2.92,m['mahogany'],.52)
		box('Velvet inset arch trim',x,-6.19,2.65,3.72,.11,2.78,m['brass'],.48)
		box('Tufted alcove backing',x,-6.10,2.65,3.59,.12,2.64,m['wine'],.43)
		for i in range(7):
			box('Velvet alcove fold',x+(i-3)*.43,-5.98,2.40,.41,.13,1.85,m['berry'] if i%2 else m['wine'],.085)
		toy.point_light('Casino alcove light',(x,-4.08,3.45),color=(1,.70,.47),energy=340,radius=.58)
		disc('Pendant cap',x,-4.02,3.63,.38,.16,m['brass'],.05)
		orb('Opal pendant',x,-4.02,3.47,(.29,.29,.26),m['light'])
	cherry(0,-5.82,3.33,.61,m)
	label('LA CEREZA',0,-5.84,2.77,.39,m['ivory'])
	plaque('BLACKJACK',-5.09,-5.79,2.57,m)
	plaque('TRAGAMONEDAS',5.09,-5.79,2.57,m)
	plaque('RULETA',0,-4.69,1.38,m)
	casino_table(-4.68,-2.62,'BLACKJACK','blackjack',m)
	casino_table(0,-2.62,'RULETA','roulette',m)
	make_wheel(0,-2.75,1.24,m)
	for i in range(5):
		disc('Stacked blackjack chips',-5.55,-2.31,1.028+i*.027,.083,.024,m['brass' if i%2 else 'wine'],.009,24)
	for i in range(3):
		box('Ivory display card',-4.65+i*.19,-2.59,1.031,.185,.31,.022,m['ivory'],.022,(0,0,.11*(i-1)))
	x,y=4.65,-2.88
	cabinet=[box('Walnut cabinet plinth',x,y,.18,3.07,1.47,.36,m['mahogany'],.14),
		box('Warm wood cabinet',x,y,1.31,2.94,1.30,2.34,m['wood'],.25),
		box('Rounded cabinet face',x,y+.61,1.48,2.76,.21,1.94,m['mahogany'],.17),
		box('Slot brass fascia',x,y+.72,1.64,2.62,.11,.66,m['brass'],.10),
		box('Slot velvet marquee',x,y+.71,2.24,2.55,.13,.35,m['wine'],.09),
		box('Chip tray',x,y+.74,.77,2.31,.48,.18,m['brass'],.077)]
	merge(cabinet,'CasinoMachine',True)
	label('GIRO CEREZA',x,y+.80,2.245,.21,m['ivory'])
	for i in range(5):
		px=x+(i-2)*.501
		box('Reel lining',px,y+.788,1.64,.47,.041,.55,m['ink'],.035)
		bpy.ops.mesh.primitive_plane_add(size=1,location=(px,y+.815,1.64),rotation=(math.pi/2,0,math.pi))
		panel=bpy.context.object
		panel.name='SlotsReel_'+str(i)
		panel.scale=(.43,.51,1)
		panel.data.materials.append(m['ivory'])
		orb('Marquee pearl',px,y+.80,2.61,(.048,.045,.048),m['light'])
	orb('Cherry red start button',x,y+.96,.89,(.22,.14,.072),m['berry'])
	shop.hotspot('Slot cabinet action',(x,y+1.46,0),'casino-slots')
	toy.empty('Spawn',loc=(0,5.52,0))
	return 'room_casino.glb'

