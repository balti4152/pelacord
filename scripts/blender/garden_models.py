"""Patio y props de cultivo hechos para la cuadrícula de un metro."""
import math
import random

import bpy

import toy
from city_square import flower_pot, leafy_tree
from organic import line, loft, sweep


def materials():
	return {name: toy.material('Huerta ' + name, rgb, roughness=roughness) for name,rgb,roughness in (
		('green',(.57,.74,.44),.88),('border',(.80,.74,.61),.83),('wood',(.61,.38,.25),.85),
		('soil',(.48,.28,.23),.92),('wet',(.31,.20,.24),.87),('ridge',(.54,.32,.28),.91),
		('wet ridge',(.40,.25,.28),.87),('leaf',(.40,.70,.30),.69),('leaf dark',(.22,.53,.29),.66),
		('potato',(.86,.59,.28),.75),('carrot',(1,.47,.20),.58),('berry',(.94,.20,.35),.54),
		('mint',(.32,.77,.63),.39),('metal',(.54,.68,.79),.28),('yellow',(1,.78,.38),.50),
		('stone pale',(.91,.79,.68),.88),('stone rose',(.80,.67,.64),.83),
		('stone olive',(.76,.74,.61),.83),('cream',(.95,.88,.72),.69),
		('plum',(.47,.33,.46),.68),('sage',(.59,.70,.49),.77),
	)}


def block(name, loc, size, mat, radius=.09, rot=(0,0,0)):
	return toy.rounded_box(name,loc=loc,size=size,mat=mat,radius=radius,rot=rot,segments=3)


def group(parts,name):
	for obj in parts:toy.apply_transforms(obj)
	obj=toy.join(parts,name)
	obj['farm_model']=name
	return obj


def build_yard():
	m=materials()
	rng=random.Random(539)
	block('Garden Ground',(0,0,-.19),(33,31,.36),m['green'],.16)
	for side,y,width,rows in ((1,7.13,5.30,4),(-1,-7.10,14.22,3)):
		parts=[block('Path bedding',(0,y,.004),(width+.11,rows*.43+.10,.052),m['stone rose'],.11)]
		cols=round(width/.55)
		for row in range(rows):
			for col in range(cols):
				x=(col-(cols-1)*.5)*width/cols+(.08 if row%2 else -.08)
				parts.append(block('Garden hand-laid brick',(x,y+(row-(rows-1)*.5)*.43,.039+rng.uniform(0,.011)),
					(width/cols-.028,.407,.10),m[rng.choice(('stone pale','stone rose','stone olive'))],.072,(0,0,rng.uniform(-.04,.04))))
		for obj in parts:toy.apply_transforms(obj)
		toy.join(parts,'Garden stone path Floor '+str(side))

	fence=[]
	def fence_span(x,y,axis):
		loc=lambda offset,z:(x+offset,y,z) if axis==0 else (x,y+offset,z)
		size=lambda w,d,h:(w,d,h) if axis==0 else (d,w,h)
		for h in (.29,.67):
			fence.append(block('Rounded fence rail',loc(0,h),size(1.84,.125,.124),m['wood'],.037))
		for i in range(7):
			h=.71+(.10 if i in (1,3,5) else 0)
			fence.append(block('Rounded fence picket',loc((i-3)*.235,h*.50+.07),size(.184,.132,h),m['cream'],.069))
		fence.append(block('Garden post',loc(-.92,.49),size(.25,.25,.97),m['wood'],.084))
		fence.append(block('Garden post cap',loc(-.92,.99),size(.32,.32,.13),m['border'],.053))

	for side in (-1,1):
		for i in range(9):
			fence_span(side*8.23,(i-4)*1.84,1)
			x=(i-4)*1.84
			if side==-1 or abs(x)>2.04: fence_span(x,side*8.23,0)
	for obj in fence:toy.apply_transforms(obj)
	toy.join(fence,'Garden picket fence')

	for i,(x,y) in enumerate(((-8.88,-6.83),(8.75,-7.16),(-8.9,1.78),(8.9,3.68))):
		leafy_tree('Garden canopy '+str(i),x,y,1.01,424+i)
	for i,(x,y) in enumerate(((-5.40,6.87),(5.40,6.87),(-5.7,-6.79),(5.78,-6.79))):
		flower_pot('Garden flowers '+str(i),x,y,.80,784+i,pink=bool(i%2))

	for side in (-1,1):
		x=side*2.71
		block('Garden arbor footing',(x,7.92,.18),(.63,.61,.37),m['stone pale'],.12)
		block('Garden arbor post',(x,7.92,1.27),(.30,.34,2.54),m['wood'],.085,(0,side*.04,0))
		for i in range(8):
			y=7.95+math.sin(i*2.12)*.24
			leaf=toy.sphere('Arbor climbing leaf',radius=.21,loc=(x+math.cos(i*2.12)*.19,y,.48+i*.201),mat=m['leaf' if i%2 else 'sage'],segments=12,rings=8)
			leaf.scale=(.86,.59,1.22)
			leaf.rotation_euler.y=side*.41
	for y in (7.60,8.18):
		sweep('Curved garden arbor',[(x,y,2.39+.72*math.cos(x/2.78*math.pi/2),.145,1.08) for x in (-2.78,-1.86,-.93,0,.93,1.86,2.78)],m['wood'],segments=16)
	for i in range(9):
		x=(i-4)*.62
		block('Pergola crosspiece',(x,7.89,2.46+.72*math.cos(x/2.78*math.pi/2)),(.17,.98,.18),m['wood'],.08)
	from shop import text_mesh, hotspot
	block('Carved patio sign',(0,8.20,2.87),(1.43,.22,.56),m['plum'],.16)
	text_mesh('Patio carved lettering','PATIO',.29,(0,8.34,2.88),m['cream'],extrude=.018,rot=(math.pi/2,0,math.pi))
	text_mesh('Patio label','PATIO',.30,(0,7.67,2.57),m['border'],extrude=.016)
	block('Expansion stone base',(6.40,-6.96,.14),(1.20,1.01,.23),m['stone pale'],.12)
	block('Expansion lectern',(6.40,-6.96,.73),(.61,.69,1.24),m['mint'],.145)
	block('Expansion brass plaque',(6.40,-6.80,1.31),(.96,.73,.13),m['yellow'],.07,(-.24,0,0))
	for x,y in ((-7.45,-4.95),(-7.43,2.61),(7.44,-1.9),(7.46,4.6)):
		for i in range(5):
			r=.18+rng.random()*.11
			toy.sphere('Soft garden verge',radius=r,loc=(x+rng.uniform(-.22,.22),y+i*.37,r*.47),mat=m['sage' if i%2 else 'leaf'],segments=12,rings=8)
	hotspot('Garden expansion',(6.40,-6.06,0),'garden-land')
	toy.empty('Spawn',loc=(0,7.11,0))
	return 'room_yard.glb'


def potato_leaves(m, amount, height, spread, name):
	pieces=[]
	for i in range(amount):
		angle=i*2.40
		x,y=math.cos(angle)*spread, math.sin(angle)*spread
		pieces.append(line('Tapered stem',[(0,0,.01),(x*.46,y*.46,height*.42),(x*.84,y*.84,height*.91)],
			.016 if height<.25 else .023,m['leaf dark']))
		leaf=toy.sphere('Pump leaf',radius=1,scale=(.12*spread/.24,.072*spread/.24,.029),
			loc=(x*.88,y*.88,height*.80+(i%3)*height*.08),mat=m['leaf' if i%2 else 'leaf dark'],segments=12,rings=8)
		leaf.rotation_euler=(.27*math.sin(angle),-.38*math.cos(angle),angle)
		pieces.append(leaf)
	return pieces


def build_farm_props():
	m=materials()
	for wet in (False,True):
		parts=[block('Tilth soil',(0,0,.050),(.92,.92,.11),m['wet' if wet else 'soil'],.082)]
		for i in range(3):
			parts.append(block('Rounded furrow',((i-1)*.254,0,.102),(.197,.76,.075),m['wet ridge' if wet else 'ridge'],.036))
		group(parts,'Plot_Wet' if wet else 'Plot_Dry')
	for key in ('Potato','Carrot','Berry'):
		for stage,height,spread in (('Seedling',.177,.11),('Growing',.34,.22),('Ripe',.47,.29)):
			pieces=potato_leaves(m,4 if stage=='Seedling' else 7,height,spread,key)
			if stage=='Ripe':
				for i in range(3):
					angle=i*math.tau/3+.5
					x,y=math.cos(angle)*.20,math.sin(angle)*.20
					if key=='Carrot':
						pieces.append(loft('Orange root',[(.012,x,y,.027,.025),(.079,x,y,.102,.086),
							(.164,x,y,.086,.078)],m['carrot'],segments=14))
					else:
						color=m['potato' if key=='Potato' else 'berry']
						pieces.append(toy.sphere('Tuber' if key=='Potato' else 'Berry fruit',radius=.084,
							scale=(1.35,.95,.81 if key=='Potato' else 1.03),loc=(x,y,.061 if key=='Potato' else .223),
							mat=color,segments=14,rings=9))
			group(pieces,key+'_'+stage)
	parts=[toy.cylinder('Sprinkler base',radius=.172,depth=.11,loc=(0,0,.115),mat=m['mint'],segments=18,bevel=.033),
		toy.cylinder('Sprinkler riser',radius=.053,depth=.42,loc=(0,0,.28),mat=m['metal'],segments=14,bevel=.02),
		block('Sprinkler arms',(0,0,.50),(.46,.106,.09),m['metal'],.036)]
	for side in (-1,1):
		parts.append(block('Sprinkler nozzle',(side*.208,0,.535),(.085,.10,.125),m['yellow'],.039, (0,side*.25,0)))
	group(parts,'Sprinkler')
	hoe=[toy.cylinder('Tiller handle',radius=.028,depth=.75,loc=(0,0,.42),mat=m['wood'],segments=14,bevel=.014),
		block('Curved hoe blade',(0,-.077,.093),(.28,.19,.096),m['metal'],.045,(-.25,0,0))]
	group(hoe,'Hoe')
	can=[block('Watering can body',(0,0,.177),(.33,.28,.35),m['mint'],.112),
		toy.torus('Can handle',major=.123,minor=.026,loc=(0,.151,.249),rot=(math.pi/2,0,0),mat=m['mint'],major_seg=20,minor_seg=7),
		toy.cone('Can spout',r1=.046,r2=.030,depth=.31,loc=(0,-.227,.226),rot=(math.pi/3,0,0),mat=m['metal'],segments=16,bevel=.016)]
	group(can,'WateringCan')
	return 'farm_assets.glb'
