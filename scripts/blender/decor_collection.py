"""Colección Taller de Casa. Source meshes and catalog for the Blender exports."""

import json
from pathlib import Path

import bpy
from mathutils import Vector

import decor_furniture as furn
import decor_lamps as lamp
import decor_objects as obj
import decor_plants as plant
from decor_mesh import Model

# id, name, category, cost, model builder
ITEMS = {
	'atelier_gramophone': ('Gramófono de latón', 'deco', 165, obj.gramophone),
	'atelier_radio': ('Radio Capilla', 'deco', 100, obj.radio),
	'atelier_clock': ('Reloj de péndulo', 'deco', 170, obj.clock),
	'atelier_ceramic_cat': ('Gato de porcelana', 'deco', 65, obj.ceramic_cat),
	'atelier_coral': ('Jardín de coral', 'deco', 80, obj.coral),
	'atelier_sailboat': ('Velero a escala', 'deco', 85, obj.sailing_boat),
	'atelier_hourglass': ('Reloj de arena', 'deco', 75, obj.hourglass),
	'atelier_globe': ('Globo de gabinete', 'deco', 110, obj.atlas),
	'atelier_bird': ('Golondrina colgante', 'deco', 90, obj.bird_mobile),
	'atelier_monstera': ('Monstera en terracota', 'plantas', 70, plant.monstera),
	'atelier_bonsai': ('Bonsái florecido', 'plantas', 115, plant.bonsai),
	'atelier_hydrangea': ('Hortensias de jardín', 'plantas', 95, plant.hydrangea),
	'atelier_olive': ('Olivito en maceta', 'plantas', 80, plant.olive),
	'atelier_orchid': ('Orquídea de marfil', 'plantas', 100, plant.orchid),
	'atelier_succulents': ('Bandeja de suculentas', 'plantas', 55, plant.succulent),
	'atelier_ivy': ('Hiedra colgante', 'plantas', 110, plant.ivy_stand),
	'atelier_cactus': ('Cactus en flor', 'plantas', 70, plant.cactus),
	'atelier_lily_lamp': ('Lámpara de lirios', 'luces', 155, lamp.lily_lamp),
	'atelier_harbor_lamp': ('Farol de puerto', 'luces', 85, lamp.harbor_lamp),
	'atelier_paper_lamp': ('Farol de papel', 'luces', 105, lamp.paper_lamp),
	'atelier_scallop_lamp': ('Lámpara plisada', 'luces', 90, lamp.scallop_lamp),
	'atelier_shell_chair': ('Butaca concha', 'asientos', 190, furn.shell_chair),
	'atelier_reading_chair': ('Sillón de lectura', 'asientos', 195, furn.reading_chair),
	'atelier_window_bench': ('Banco de galería', 'asientos', 180, furn.window_bench),
	'atelier_wicker': ('Sillón colgante de mimbre', 'asientos', 225, furn.wicker_chair),
	'atelier_daybed': ('Diván de lino', 'dormitorio', 245, furn.linen_daybed),
	'atelier_cabinet': ('Aparador acanalado', 'mesas', 150, furn.cabinet),
	'atelier_arch_shelf': ('Biblioteca con arco', 'deco', 210, furn.arched_shelf),
	'atelier_mosaic': ('Mesa redonda de madera', 'mesas', 140, furn.wooden_table),
	'atelier_tea_cart': ('Carrito de té', 'mesas', 160, furn.tea_cart),
	'atelier_piano': ('Piano vertical', 'deco', 260, furn.upright_piano),
	'atelier_mirror': ('Espejo de pie', 'dormitorio', 120, furn.floor_mirror),
}


def studio(scene):
	stage=bpy.data.collections.new('Estudio de muebles')
	scene.collection.children.link(stage)
	ground=Model()
	ground.soft('porcelain',(0,0,-.081),40,40,.15,.2)
	ground.build('Suelo del estudio',stage).location.z=-.151
	camera=bpy.data.objects.new('Cámara del catálogo',bpy.data.cameras.new('Cámara del catálogo'))
	stage.objects.link(camera)
	camera.data.type='ORTHO'
	scene.camera=camera
	scene.world=bpy.data.worlds.new('Entorno del catálogo')
	scene.world.use_nodes=True
	bg=next(n for n in scene.world.node_tree.nodes if n.type=='BACKGROUND')
	bg.inputs[0].default_value=(.44,.38,.49,1)
	bg.inputs[1].default_value=.44
	scene.render.engine='BLENDER_EEVEE'
	if hasattr(scene,'eevee'):
		scene.eevee.taa_render_samples=24
	scene.render.resolution_x=350
	scene.render.resolution_y=300
	scene.render.resolution_percentage=100
	scene.render.image_settings.file_format='PNG'
	lights=[]
	for offset,energy,shade,size in (((-2.2,-2.9,4.0),410,(1,.84,.68),3.0), ((2.4,-1.1,2.25),150,(.76,.80,1),2.5),
		((.8,2.5,3.4),330,(1,.73,.54),2.6)):
		data=bpy.data.lights.new('Suave del catálogo','AREA')
		data.energy=energy
		data.color=shade
		data.shape='DISK'
		data.size=size
		light=bpy.data.objects.new('Suave del catálogo',data)
		stage.objects.link(light)
		lights.append((light,Vector(offset)))
	return stage,camera,lights


def preview(scene, camera, lights, points, filename):
	lo=Vector(tuple(min(p[i] for p in points) for i in range(3)))
	hi=Vector(tuple(max(p[i] for p in points) for i in range(3)))
	mid=(lo+hi)*.5
	camera.location=mid+Vector((1.37,-3.8,2.19))
	camera.rotation_euler=(mid-camera.location).to_track_quat('-Z','Y').to_euler()
	inverse=camera.rotation_euler.to_quaternion().inverted()
	view=[inverse@(Vector(p)-mid) for p in points]
	width=max(p.x for p in view)-min(p.x for p in view)
	height=max(p.y for p in view)-min(p.y for p in view)
	camera.data.ortho_scale=max(width,height*350/300)*1.23
	for light,offset in lights:
		light.location=mid+offset
		light.rotation_euler=(-offset).to_track_quat('-Z','Y').to_euler()
	scene.render.filepath=str(filename)
	bpy.ops.render.render(write_still=True)


def export_models(directory, keys=None, render=False):
	"""Export from a clean scene and keep the edited pieces in an isolated Blender showroom."""
	directory=Path(directory)
	directory.mkdir(exist_ok=True,parents=True)
	selected=list(ITEMS if keys is None else keys)
	original=bpy.context.window.scene
	work=bpy.data.scenes.new('Taller de Casa · exportación')
	show=bpy.data.scenes.get('PelaCord | Taller de Casa') or bpy.data.scenes.new('PelaCord | Taller de Casa')
	studio_collection=None
	try:
		bpy.context.window.scene=work
		if render:
			studio_collection,camera,lights=studio(work)
		manifest=[]
		for key in selected:
			name,category,price,make=ITEMS[key]
			collection=bpy.data.collections.new(name)
			collection['pelacord_decor_id']=key
			work.collection.children.link(collection)
			model=make()
			mesh=model.build(name,collection)
			mesh['pelacord_decor_id']=key
			bpy.context.view_layer.update()
			for node in work.objects:
				node.select_set(node in collection.objects.values())
			file=directory/(key+'.glb')
			bpy.ops.export_scene.gltf(filepath=str(file),export_format='GLB',use_selection=True,
				use_active_scene=True,export_apply=True,export_lights=True,export_extras=True,export_animations=False)
			if render:
				preview(work,camera,lights,model.points,directory/(key+'.png'))
			manifest.append({'id':key,'name':name,'price':price,'category':category,
				'glb':'models/furniture/'+file.name,'seats':len(model.seats),'recolor':[],'defaultColor':None})
			work.collection.children.unlink(collection)
			for previous in list(show.collection.children):
				if previous.get('pelacord_decor_id')==key or previous.name==name:
					show.collection.children.unlink(previous)
			show.collection.children.link(collection)
			column,row=divmod(list(ITEMS).index(key),8)
			mesh.location=(row*2.25,column*2.24,0)
			print('CATÁLOGO',key,len(model.points),file.stat().st_size)
		piece=directory/('catalog-'+selected[0]+'.json')
		piece.write_text(json.dumps({'items':manifest},ensure_ascii=False,indent=1)+'\n',encoding='utf-8')
	finally:
		bpy.context.window.scene=original
		if studio_collection:
			for node in list(studio_collection.objects):
				bpy.data.objects.remove(node,do_unlink=True)
			bpy.data.collections.remove(studio_collection)
		bpy.data.scenes.remove(work)

