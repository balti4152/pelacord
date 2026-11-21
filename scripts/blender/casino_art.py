"""Rendered game tokens and the original La Cereza mascot."""
import math
from casino_room import box, cherry, disc, orb
from organic import sweep
import bpy
import shop

SYMBOLS = ('cherry','lemon','bell','star','diamond','seven')


def badge(points, material):
	mesh=bpy.data.meshes.new('Token bevel mesh')
	count=len(points)
	mesh.from_pydata([(x,y,z+.62) for y in (-.103,.103) for x,z in points],[],
		[tuple(reversed(range(count))),tuple(range(count,2*count))]+[(i,(i+1)%count,count+(i+1)%count,count+i) for i in range(count)])
	shape=bpy.data.objects.new('Faceted symbol',mesh)
	bpy.context.scene.collection.objects.link(shape)
	mesh.materials.append(material)
	mod=shape.modifiers.new('Soft carved edges','BEVEL')
	mod.width=.048
	mod.segments=4
	shape.modifiers.new('Weighted normals','WEIGHTED_NORMAL')


def token(name,m):
	if name=='cherry':
		cherry(0,0,.48,.65,m)
	elif name=='lemon':
		fruit=orb('Lemon',0,0,.62,(.46,.27,.29),m['lemon'])
		fruit.rotation_euler.y=-.43
		orb('Lemon tip',.371,0,.78,(.105,.131,.092),m['lemon'])
		leaf=orb('Lemon leaf',.10,0,.995,(.23,.055,.090),m['green'])
		leaf.rotation_euler.y=-.34
	elif name=='bell':
		from organic import loft
		loft('Bell',[(.31,0,0,.38,.33),(.39,0,0,.35,.30),(.62,0,0,.25,.22),(.81,0,0,.19,.17),(.87,0,0,.082,.074)],m['brass'],segments=40)
		disc('Bell gold lip',0,0,.33,.373,.07,m['lemon'],.028)
		orb('Bell clapper',0,.10,.25,(.119,.118,.10),m['wood'])
		orb('Bell crown',0,0,.895,(.112,.099,.087),m['lemon'])
	elif name=='star':
		badge([(math.sin(i*math.pi/5)*r,math.cos(i*math.pi/5)*r) for i in range(10) for r in [(.49 if not i%2 else .245)]],m['lemon'])
	elif name=='diamond':
		badge([(0,.48),(.42,.16),(.31,-.14),(0,-.48),(-.31,-.14),(-.42,.16)],m['blue'])
		sweep('Gem glint',[(-.20,.108,.70,.017,1),(-.13,.13,.81,.023,1),(-.037,.119,.88,.013,1)],m['ivory'])
	elif name=='seven':
		shop.text_mesh('Carved seven','7',.88,(0,.04,.31),m['pink'],extrude=.09,rot=(math.pi/2,0,math.pi))


def mascot(m):
	for side in (-1,1):
		x=.26*side
		orb('Shiny dancing shoe',x,.16,.16,(.248,.33,.151),m['mahogany'])
		orb('Trouser leg',x,0,.38,(.186,.202,.322),m['wine'])
		orb('Tailcoat sleeve',side*.57,0,.87,(.23,.23,.358),m['jade']).rotation_euler.y=side*.55
		orb('Ivory glove',side*.76,.09,.78+(side+1)*.17,(.198,.178,.158),m['ivory'])
	orb('Tailcoat body',0,0,.76,(.51,.34,.47),m['jade'])
	orb('Ivory waistcoat',0,.28,.783,(.26,.089,.36),m['ivory'])
	orb('Cherry face',0,.04,1.62,(.65,.45,.53),m['berry'])
	orb('Cherry crown',-.28,.006,1.885,(.36,.31,.276),m['berry'])
	for side in (-1,1):
		x=side*.24
		orb('Glossy charcoal eye',x,.469,1.67,(.071,.032,.105),m['ink'])
		orb('Eye glint',x+.017,.493,1.704,(.019,.010,.024),m['ivory'])
		orb('Rosy cheek',side*.365,.425,1.53,(.096,.037,.050),m['blush'])
		orb('Wine velvet tie',side*.109,.388,1.075,(.114,.042,.069),m['wine'])
	orb('Golden tie pin',0,.424,1.076,(.048,.022,.050),m['brass'])
	sweep('Smile',[(-.14,.47,1.477,.022,1),(0,.503,1.417,.028,1),(.14,.47,1.477,.021,1)],m['mahogany'])
	sweep('Cherry stem',[(0,0,2.05,.057,1),(.044,-.027,2.29,.049,1),(.26,-.01,2.43,.038,1)],m['green'])
	orb('Cherry leaf',.355,0,2.41,(.23,.071,.112),m['green']).rotation_euler.y=-.32
	for i in range(3):
		orb('Brass waistcoat stud',0,.372,.91-i*.14,(.032,.018,.032),m['brass'])

