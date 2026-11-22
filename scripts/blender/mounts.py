"""Mini mounts for PelaCord. Wheels and pedals have their own axle pivots."""
import math
from pathlib import Path

import bpy
from mathutils import Vector

import toy
from decor_mesh import Model, PALETTE, TAU, soft_rectangle
from decor_collection import studio, preview

PALETTE.update({'BikeFramePaint': (.345,.72,.627), 'CarBodyPaint': (.92,.395,.47)})


def add_model(model, name, collection, parent, at=(0,0,0)):
	floor=min(p[2] for p in model.points)
	mesh=model.build(name,collection)
	mesh.parent=parent
	mesh.location=(at[0],at[1],at[2]+floor)
	return mesh


def wheel(radius, wide, spokes):
	g=Model()
	g.hoop('ink',(0,0,0),2*(radius-wide),2*(radius-wide),wide,front=True,yaw=math.pi/2,count=52)
	for side in (-1,1):
		x=side*wide*.74
		g.hoop('porcelain',(x,0,0),radius*1.55,radius*1.55,wide*.31,front=True,yaw=math.pi/2,count=44)
		g.ellipsoid('brass',(side*wide,0,0),(wide*.45,radius*.18,radius*.18),rings=8,count=16)
		for i in range(spokes):
			a=TAU*i/spokes
			g.tube('silver' if spokes>5 else 'oak',[(x,0,0),(x,math.cos(a)*radius*.69,math.sin(a)*radius*.69)],
				.0065 if spokes>5 else .012,divisions=1,count=7)
	g.ellipsoid('iron',(0,0,0),(wide*1.08,radius*.14,radius*.14),rings=8,count=16)
	return g


def bicycle():
	g=Model()
	paint='BikeFramePaint'
	rear=(0,.505,.282)
	head=(0,-.33,.68)
	hub=(0,.025,.309)
	seat=(0,.202,.642)
	for s in (-1,1):
		x=s*.051
		g.tube(paint,[hub,(x,.272,.282),(x,.505,.282)],.021,count=12)
		g.tube(paint,[seat,(x,.365,.477),(x,.505,.282)],.018,count=12)
		g.tube(paint,[(x,-.49,.282),(x,-.453,.441),(x,-.37,.591),head],.023,count=12,divisions=4)
		for y,z in ((-.47,.282),(.505,.282)):
			points=[(s*.020,y+.302*math.cos(a),z+.302*math.sin(a)) for a in [.20+math.pi*.77*i/22 for i in range(23)]]
			if s==1: g.tube(paint,points,.018,ratio=2.05,divisions=1,count=11)
	g.tube(paint,[hub,(0,-.128,.337),(0,-.222,.50),head],.035,count=16,divisions=4)
	g.tube(paint,[seat,(0,.082,.483),hub],.030,count=14,divisions=4)
	g.tube('brass',[seat,(0,.214,.715)],.023,count=13)
	g.soft('walnut',(0,.227,.721),.248,.306,.078,.092,bevel=.034)
	g.tube('cream',[(0,-.33,.61),(0,-.311,.737),(0,-.349,.819)],.023,count=13)
	g.tube('silver',[(-.239,-.307,.817),(-.157,-.358,.836),(0,-.370,.807),(.157,-.358,.836),(.239,-.307,.817)],.017,count=11,divisions=4)
	for s in (-1,1):
		g.tube('walnut',[(s*.164,-.356,.835),(s*.235,-.307,.816)],.024,divisions=1,count=11)
		g.ellipsoid('brass',(s*.24,-.305,.816),(.025,.024,.023),rings=7,count=12)
	g.ellipsoid('brass',(-.106,-.378,.856),(.032,.03,.027),rings=7,count=15)
	# Canastito de mimbre. El borde, las tramas horizontales y las tiras verticales tienen relieve.
	g.plate('oak',soft_rectangle(.342,.234,.079),(0,-.555,.678),.038,.021)
	for i in range(5):
		g.hoop('oak' if i%2 else 'maple',(0,-.557,.685+i*.027),.329+i*.014,.239+i*.012,.010,count=36)
	for i in range(18):
		a=TAU*i/18
		c,s=math.cos(a),math.sin(a)
		g.tube('woodcut',[(.167*c,-.557+.115*s,.680),(.194*c,-.557+.134*s,.789)],.0065,count=6,divisions=1)
	g.hoop('walnut',(0,-.557,.802),.400,.301,.015,count=48)
	crank=Model()
	for s in (-1,1):
		crank.tube('silver',[(0,0,0),(s*.136,s*.084,-s*.098)],.015,count=11,divisions=1)
		crank.soft('ink',(s*.154,s*.085,-s*.097),.092,.103,.025,.021)
	return g,[
		('Wheel_Front',wheel(.282,.032,10),(0,-.478,.282)),
		('Wheel_Rear',wheel(.282,.032,10),rear),
		('Crank',crank,hub),
	]


def car():
	g=Model()
	paint='CarBodyPaint'
	g.soft('walnut',(0,.026,.232),.835,1.385,.205,.224,bevel=.054)
	g.ellipsoid(paint,(0,-.464,.388),(.493,.359,.201),rings=13,count=34)
	g.ellipsoid(paint,(0,.524,.341),(.501,.296,.171),rings=12,count=34)
	g.soft('cream',(0,.032,.315),.687,.630,.11,.209)
	for s in (-1,1):
		g.tube(paint,[(s*.369,-.615,.376,.137),(s*.438,-.282,.376,.125),(s*.432,.100,.353,.087),
			(s*.426,.359,.366,.107),(s*.369,.595,.363,.122)],.109,count=22,divisions=4,ratio=.96)
		g.tube('cream',[(s*.526,-.56,.378),(s*.529,-.248,.369),(s*.504,.107,.343),(s*.509,.375,.355)],
			.014,count=11,divisions=3)
		for y in (-.465,.464):
			path=[(s*.422,y+.205*math.cos(a),.176+.205*math.sin(a)) for a in [.12+math.pi*.922*i/28 for i in range(29)]]
			g.tube(paint,path,.057,ratio=1.48,divisions=1,count=14)
		g.ellipsoid('brass',(s*.263,-.727,.389),(.102,.043,.084),rings=10,count=20)
		g.ellipsoid('opal',(s*.263,-.759,.392),(.075,.027,.062),rings=9,count=20)
		g.ellipsoid('rose',(s*.268,.769,.335),(.073,.035,.049),rings=8,count=17)
	g.tube('silver',[(-.346,-.690,.242),(-.40,-.724,.242),(0,-.786,.240),(.40,-.724,.242),(.346,-.690,.242)],
		.036,count=15)
	g.tube('cream',[(-.318,.687,.227),(-.359,.736,.227),(0,.784,.227),(.359,.736,.227),(.318,.687,.227)],
		.029,count=14)
	g.plate('teal',soft_rectangle(.224,.108,.039),(0,-.802,.309),.028,.018,front=True)
	g.ellipsoid('brass',(0,-.813,.315),(.032,.013,.023),rings=7,count=13)
	g.soft('berry',(0,.215,.370),.550,.355,.120,.163)
	g.plate('berry',soft_rectangle(.505,.254,.105),(0,.390,.512),.103,.04,front=True)
	g.tube('cream',[(-.20,.331,.57),(0,.329,.59),(.20,.331,.57)],.010,count=8)
	g.tube('iron',[(0,-.233,.396),(0,-.229,.561),(0,-.150,.633)],.020,count=11)
	g.hoop('walnut',(0,-.153,.650),.283,.244,.021,front=True,count=36)
	g.tube('brass',[(-.116,-.156,.65),(0,-.164,.65),(.116,-.156,.65)],.013,divisions=1,count=8)
	return g,[
		('Wheel_'+str(i),wheel(.171,.056,5),(x,y,.171))
		for i,(x,y) in enumerate([(-.461,-.454),(.461,-.454),(-.461,.459),(.461,.459)])
	]


def broom():
	g=Model()
	g.tube('walnut',[(0,.615,.150,.046),(0,.334,.167,.045),(0,.035,.217,.041),(0,-.32,.302,.037),
		(.019,-.674,.457,.033),(.044,-.842,.442,.024)],.04,count=17,divisions=5)
	g.tube('oak',[(.021,.588,.178,.009),(.028,.177,.217,.008),(.025,-.22,.299,.007),(.038,-.67,.477,.003)],
		.007,count=9)
	g.tube('brass',[(.023,-.695,.458),(.033,-.792,.474),(.047,-.845,.447)],.036,count=13,divisions=3)
	g.ellipsoid('lilac',(.043,-.858,.447),(.044,.045,.044),rings=9,count=19)
	g.ellipsoid('berry',(0,.027,.220),(.145,.202,.052),rings=11,count=26)
	# Cada mecha se curva hacia atrás; hay estrías de tres tonos desde la atadura hasta las puntas.
	for i in range(22):
		a=i*2.39996
		d=math.sqrt((i+.45)/22)
		x=math.cos(a)*d
		z=math.sin(a)*d
		g.tube(('maple','honey','oak','clay')[i%4],[
			(x*.043,.305,.168+z*.040,.026),(x*.076,.458,.158+z*.072,.037),
			(x*.154,.652,.137+z*.108,.041),(x*.157+.023,.835+math.cos(i)*.063,.163+z*.074,.021),
			(x*.149+.040,.957+math.cos(i*1.8)*.075,.191+z*.039,.005)
		],.036,count=9,divisions=4)
	for y,z,r in ((.367,.166,.062),(.414,.161,.075),(.455,.158,.082)):
		g.hoop('berry',(0,y,z),r*2,r*1.77,.011,front=True)
		g.hoop('brass',(0,y+.012,z),r*2.07,r*1.80,.006,front=True)
	g.tube('lilac',[(-.043,.377,.214),(-.113,.420,.195),(-.155,.493,.143)],.011,count=8)
	g.ellipsoid('opal',(-.155,.496,.141),(.026,.023,.033),rings=8,count=14)
	return g,[]


MODELS={'mount_bike':('Bicicleta Paseo',bicycle),'mount_car':('Autito Bombón',car),'mount_broom':('Escoba Luciérnaga',broom)}


def export(directory):
	directory=Path(directory)
	directory.mkdir(exist_ok=True,parents=True)
	original=bpy.context.window.scene
	work=bpy.data.scenes.new('PelaCord | Exportación de monturas')
	show=bpy.data.scenes.new('PelaCord | Monturas chibi')
	staging=None
	try:
		bpy.context.window.scene=work
		staging,camera,lights=studio(work)
		for index,(key,(name,builder)) in enumerate(MODELS.items()):
			collection=bpy.data.collections.new(name)
			work.collection.children.link(collection)
			root=toy.empty(name,col=collection)
			body,parts=builder()
			meshes=[add_model(body,'Carrocería de '+name,collection,root)]
			for label,model,at in parts:
				pivot=toy.empty(label,loc=at,parent=root,col=collection)
				meshes.append(add_model(model,label+' mesh',collection,pivot))
			bpy.context.view_layer.update()
			for node in work.objects:
				node.select_set(node in collection.objects.values())
			bpy.ops.export_scene.gltf(filepath=str(directory/(key+'.glb')),export_format='GLB',use_selection=True,
				use_active_scene=True,export_apply=True,export_extras=True,export_animations=False)
			points=[tuple(mesh.matrix_world@Vector(v.co)) for mesh in meshes for v in mesh.data.vertices]
			preview(work,camera,lights,points,directory/(key+'.png'))
			work.collection.children.unlink(collection)
			show.collection.children.link(collection)
			root.location.x=index*2.25
			print('MONTURA',key,(directory/(key+'.glb')).stat().st_size)
	finally:
		bpy.context.window.scene=original
		if staging:
			for node in list(staging.objects):
				bpy.data.objects.remove(node,do_unlink=True)
			bpy.data.collections.remove(staging)
		bpy.data.scenes.remove(work)

