"""The smith's cottage and workshop."""
import math
import random
import toy
import shop
from city_architecture import arch, arch_border
from organic import loft, sweep


def palette():
	return {key:toy.material('Herrería '+key,color,rough,emission) for key,(color,rough,emission) in {
		'charcoal':((.105,.14,.17),.52,0), 'iron':((.32,.42,.48),.33,0), 'steel':((.57,.64,.62),.40,0),
		'slate':((.235,.325,.37),.67,0), 'plaster':((.83,.64,.44),.85,0), 'sand':((.94,.76,.55),.86,0),
		'wood':((.44,.26,.19),.75,0), 'oak':((.61,.40,.23),.70,0), 'copper':((.67,.35,.22),.60,0),
		'terracotta':((.56,.27,.23),.77,0), 'mortar':((.37,.28,.25),.91,0), 'stone':((.62,.49,.39),.84,0),
		'light':((1,.66,.34),.57,.6), 'ember':((1,.29,.065),.63,2.9), 'coal':((.198,.13,.12),.91,0),
		'flame':((1,.44,.075),.58,1.1), 'flame tip':((1,.71,.25),.62,1.55),
	}.items()}


def block(name,x,y,z,sx,sy,sz,m,bevel=.08,rot=(0,0,0)):
	return toy.rounded_box(name,size=(sx,sy,sz),loc=(x,y,z),mat=m,radius=bevel,rot=rot,segments=3)


def merge(parts,name,solid=False):
	for obj in parts: toy.apply_transforms(obj)
	result=toy.join(parts,name)
	if solid: result['pelacord_solid']=True
	return result


def sign(text,x,y,z,sz,m):
	return shop.text_mesh('Letra '+text,text,sz,(x,y,z),m,extrude=.015,rot=(math.pi/2,0,math.pi))


def pane(x,y,z,w,m):
	return [arch('Arched iron surround',x,y,z,w,.47,.34,.16,m['wood']),
		arch('Amber window panes',x,y+.101,z+.045,w-.16,.41,.29,.055,m['light']),
		block('Rounded window mullion',x,y+.138,z+.392,.064,.060,.69,m['charcoal'],.021),
		block('Window cross rail',x,y+.143,z+.365,w-.13,.052,.060,m['charcoal'],.018),
		block('Cottage window sill',x,y+.115,z-.018,w+.29,.40,.16,m['sand'],.071)]

def hammer_sign(x,y,m):
	angle=-.49
	y+=.39
	def tilted(name,u,v,depth,width,thick,height,material,bevel=.10):
		return block(name,x+u*math.cos(angle)+v*math.sin(angle),y+depth,
			5.08+v*math.cos(angle)-u*math.sin(angle),width,thick,height,material,bevel,(0,angle,0))
	parts=[block('Iron sign mount',x+.43,y,4.00,.60,.65,.26,m['charcoal'],.081),
		tilted('Carved oak hammer shaft',0,-.32,0,.31,.33,2.02,m['oak'],.129),
		tilted('Rounded shaft grip',0,-.91,0,.37,.39,.68,m['wood'],.14),
		tilted('Forged rounded hammer head',0,.74,0,1.73,.68,.62,m['iron'],.16),
		tilted('Polished striking face',-.67,.74,0,.46,.78,.75,m['steel'],.12),
		tilted('Hammer rear heel',.68,.74,0,.40,.64,.53,m['charcoal'],.12),
		tilted('Rounded oval forged rivet',0,.74,.35,.27,.096,.23,m['charcoal'],.075)]
	return merge(parts,'Giant roof hammer')


def exterior(x,y):
	m=palette()
	front=y+1.9
	parts=[block('Warm stucco cottage',x,y,1.63,4.90,3.80,2.99,m['plaster'],.24),
		block('Masonry foundation',x,y,.245,5.05,3.94,.49,m['stone'],.16)]
	for side in (-1,1):
		parts.extend(pane(x+side*1.56,front+.05,1.08,.94,m))
		parts.append(block('Oak facade corner',x+side*2.26,front,1.53,.28,.25,2.85,m['wood'],.09))
	for row in range(2):
		for col in range(9):
			dx=(col-4)*.53+(.12 if row else 0)
			parts.append(block('Cottage foundation stone',x+dx,front+.10,.15+row*.221,.49,.23,.20,m['stone' if col%3 else 'sand'],.046))
	parts+= [arch('Forged oak door',x,front+.10,.25,1.48,1.16,.57,.25,m['wood']),
		arch_border('Sandstone doorway surround',x,front+.315,.23,1.69,1.29,.64,.11,m['sand']),
		block('Iron door handle',x+.33,front+.30,1.11,.087,.093,.24,m['iron'],.038),
		block('Door footstep',x,front+.39,.12,1.78,.62,.24,m['stone'],.095)]
	for dx in (-.40,-.20,0,.20,.40):
		parts.append(block('Solid oak door board',x+dx,front+.252,.99,.183,.069,1.37,m['oak' if dx==0 else 'wood'],.037))
	parts.append(block('Wide oak lintel',x,front+.07,2.88,5.16,.35,.24,m['wood'],.08))
	for sx in (-1,1):
		parts.append(block('Roof fascia',x+sx*1.38,y,3.39,2.99,4.30,.17,m['charcoal'],.065,(0,sx*.348,0)))
		for row in range(5):
			for col in range(9):
				dx=.29+row*.548
				parts.append(block('Individual slate roof tile',x+sx*dx,y+(col-4)*.46+(.085 if row%2 else 0),
					4.06-dx*.366,.621,.430,.136,m['slate' if (row+col)%4 else 'iron'],.061,(0,sx*.348,0)))
	parts+=[block('Slated rounded ridge',x,y,4.13,.27,4.50,.18,m['charcoal'],.079),
		block('Slate chimney',x-1.61,y-.98,3.90,.66,.68,1.84,m['terracotta'],.115),
		block('Stone chimney cap',x-1.61,y-.98,4.78,.84,.86,.20,m['stone'],.076),
		block('Sandstone smithery nameplate',x,front+.315,2.49,2.36,.22,.41,m['sand'],.13),
		sign('HERRERÍA',x,front+.46,2.49,.26,m['charcoal'])]
	hammer_sign(x,y,m)
	return merge(parts,'Smithy',True)


def build():
	m=palette()
	rng=random.Random(18)
	block('Workshop Floor',0,0,-.13,8.60,8.80,.25,m['mortar'],.12)
	pavers=[]
	for row in range(13):
		for col in range(12):
			pavers.append(block('Hand laid workshop paver',(col-5.5)*.70,(row-6)*.657,.015,.67,.626,.049,
				m[rng.choice(('stone','stone','stone','mortar','plaster'))],.016))
	merge(pavers,'Workshop pavers Floor')
	for x in (-4.26,4.26):
		block('Lime plaster side Room',x,0,1.98,.21,8.76,3.98,m['plaster'],.115)
		block('Oak side skirt Room',x,0,.22,.31,8.76,.44,m['wood'],.078)
	block('Lime plaster rear Room',0,-4.34,1.98,8.60,.20,3.98,m['plaster'],.115)
	for x in (-3.98,-.68,3.96):
		block('Heavy oak wall post',x,-4.10,1.91,.23,.34,3.78,m['wood'],.070)
	block('Workshop wall header',0,-4.075,3.65,8.53,.31,.34,m['wood'],.087)
	for x in (1.11,2.84):
		for obj in pane(x,-4.12,2.05,1.05,m): obj.name='Workshop '+obj.name
	x,y=-2.31,-3.32
	body=[block('Hearth limestone plinth',x,y,.32,2.98,1.86,.63,m['stone'],.17),
		block('Cinder back wall',x,y-.44,1.28,2.50,.72,2.43,m['mortar'],.15),
		arch('Firebrick back',x,y+.35,.57,1.97,.76,.64,.17,m['charcoal'])]
	for side in (-1,1):
		for i in range(5):
			body.append(block('Rounded firebrick pier',x+side*1.13,y+.21,.79+i*.255,.46,1.16,.234,m['terracotta'],.067))
	body.append(arch_border('Rounded stone arch ring',x,y+.84,.57,2.22,.86,.74,.18,m['sand']))
	for i in range(14):
		c=toy.sphere('Luminous coal',radius=.17,loc=(x-.76+i*.117,y+.63+rng.random()*.14,.68+rng.random()*.14),
			scale=(1,.8,.55),mat=m['coal' if i%3==1 else 'ember'],segments=12,rings=8)
		body.append(c)
	for i,dx in enumerate((-.49,-.24,.04,.36,.57)):
		h=(.24,.49,.61,.39,.25)[i]
		cx=x+dx
		body.append(loft('Rounded forge flame',[(.73,cx,y+.67,.13,.10),(.85,cx+.02,y+.70,.13,.094),
			(.83+h*.67,cx-.025,y+.69,.072,.056),(.85+h,cx+.072,y+.665,.009,.015)],
			m['flame' if i%2 else 'flame tip'],segments=16))
	body.append(block('Forged hood shoulder',x,y,2.56,2.61,1.63,.58,m['charcoal'],.25))
	body.append(block('Forged hood chimney',x,y-.20,3.11,1.48,1.07,.75,m['iron'],.125))
	merge(body,'Stone forge and iron hood',True)
	toy.point_light('Hearth light',(x,y+1.0,.95),color=(1,.39,.14),energy=590,radius=.60)

	ax,ay=1.15,-.46
	anvil=[toy.cylinder('Cut oak stump',radius=.60,depth=.78,loc=(ax,ay,.42),mat=m['oak'],segments=17,bevel=.055),
		toy.torus('Stump iron band',major=.58,minor=.037,loc=(ax,ay,.32),mat=m['charcoal'],major_seg=40,minor_seg=8),
		block('Anvil foot',ax,ay,.86,1.17,.58,.14,m['charcoal'],.050),
		block('Anvil waist',ax,ay,1.05,.79,.45,.31,m['iron'],.10),
		block('Anvil polished face',ax,ay,1.28,1.47,.51,.22,m['steel'],.052)]
	anvil.append(toy.cone('Rounded anvil horn',r1=.19,r2=.027,depth=.67,loc=(ax+.89,ay,1.25),
		rot=(0,math.pi/2,0),mat=m['iron'],segments=24,bevel=.023))
	merge(anvil,'Forged anvil and stump',True)
	shop.hotspot('Anvil upgrades',(ax,ay+.92,0),'smith-upgrades')
	for x in (.65,3.38):
		block('Workbench rounded leg',x,-3.37,.46,.22,.69,.91,m['wood'],.064)
	block('Workbench lower shelf',2.02,-3.37,.32,2.92,.75,.12,m['wood'],.043)
	block('Workbench oak slab',2.02,-3.37,.97,3.20,.95,.192,m['oak'],.071)['pelacord_solid']=True
	for i in range(4):
		block('Hammer or file handle',.82+i*.41,-3.31,1.105,.099,.47,.090,m['wood'],.037,(0,0,(i-2)*.13))
		block('Hammer or file head',.82+i*.41,-3.56,1.130,.22,.149,.131,m['iron'],.040)
	for i in range(3):
		block('Forged ingot',2.77+i*.20,-3.15,1.10,.174,.308,.11,m['steel' if i else 'copper'],.046,(0,0,.16*i))
	block('Wall mounted tool rail',1.9,-3.99,1.72,3.33,.18,.20,m['wood'],.051)
	for i in range(7):
		tx=.46+i*.48
		block('Hanging tool handle',tx,-3.87,1.51,.077,.100,.47,m['oak'],.028)
		if i%3==0:
			for side in (-1,1):
				sweep('Forged tongs jaw',[(tx,-3.84,1.57,.044,.7),(tx+side*.13,-3.82,1.75,.035,1),
					(tx+side*.10,-3.79,1.89,.041,.7)],m['iron'],segments=10)
		elif i%3==1:
			block('Forged hanging hammer',tx,-3.84,1.76,.24,.137,.14,m['iron'],.042)
		else:
			block('Forged hanging wedge',tx,-3.84,1.75,.156,.148,.235,m['steel'],.042,(0,.23,0))
	for i in range(3):
		block('Tall crate',-3.54,-1.30+i*.34,.25,.68,.30,.48,m['oak'],.057)
		for side in (-1,1):
			block('Crate framing slat',-3.54+side*.26,-1.10+i*.34,.28,.083,.071,.42,m['wood'],.027)
	toy.point_light('Workshop daylight',(2.05,-2.80,3.37),color=(1,.78,.51),energy=320,radius=.68)
	toy.empty('Spawn',loc=(0,3.42,0))
	return 'room_smithy.glb'

