"""Regenera TODOS los modelos 3D:  blender -b --python scripts/blender/build_all.py  [-- --preview]"""
import os
import sys

import bpy

sys.path.insert(0, os.path.dirname(__file__))
import avatar  # noqa: E402
import catalog  # noqa: E402
import costumes  # noqa: E402
import fauna  # noqa: E402
import furniture  # noqa: E402
import places  # noqa: E402
import sets  # noqa: E402
import shop  # noqa: E402
import wardrobe  # noqa: E402
import toy  # noqa: E402

if __name__ == '__main__':
	preview = '--preview' in sys.argv
	toy.reset_scene()
	rig, body = avatar.build()
	toy.export_glb('avatar.glb', objects=[rig, body], animations=True)
	toy.reset_scene()
	for key, obj in costumes.build_all().items():
		toy.export_glb(f'costume_{key}.glb', objects=[obj])
	for key in sets.SETS:
		sets.build_and_export(key, preview=preview)
	# Avatar modular (hombre/mujer + peinados, caras y ropa) y su catálogo.
	import json
	toy.reset_scene()
	wardrobe.MATS.clear()
	rig, parts = wardrobe.build_modular()
	toy.export_glb('avatar_modular.glb', objects=[rig] + parts, animations=True)
	with open(os.path.join(toy.ROOT, 'public', 'catalog_wardrobe.json'), 'w', encoding='utf-8') as fh:
		json.dump({'items': wardrobe.wardrobe_catalog(parts), 'palettes': wardrobe.PALETTES,
			'looks': {k: {s: v for s, v in look.items() if s != 'colors'} for k, look in wardrobe.LOOKS.items()}}, fh, ensure_ascii=False, indent=1)
	# Muebles de la tienda + la tienda.
	furniture.export_all()
	toy.reset_scene()
	shop.build_shop()
	toy.export_glb('room_shop.glb', lights=True)
	# Ciudad y casa de juegos.
	for key, make in places.PLACES.items():
		toy.reset_scene()
		toy.export_glb(make(), lights=True)
	catalog.main()
	fauna.export_all()
