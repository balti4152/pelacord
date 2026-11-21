"""
Une los catálogos en public/catalog.json (lo que lee la tienda de la app). No necesita Blender:
    python scripts/blender/catalog.py

Monedas: cada usuario arranca con START_COINS y gana monedas en la app (la economía la define la app).
"""
import json
import os

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
PUBLIC = os.path.join(ROOT, 'public')
START_COINS = 500

COSTUMES = [
	{'id': 'costume_cone', 'name': 'Cono de tránsito', 'slot': 'hat', 'price': 250, 'glb': 'models/costume_cone.glb', 'attach': 'head'},
	{'id': 'costume_frog', 'name': 'Gorro de rana', 'slot': 'hat', 'price': 300, 'glb': 'models/costume_frog.glb', 'attach': 'head'},
	{'id': 'costume_pirate', 'name': 'Sombrero pirata', 'slot': 'hat', 'price': 300, 'glb': 'models/costume_pirate.glb', 'attach': 'head'},
	{'id': 'costume_hotdog', 'name': 'Traje de pancho', 'slot': 'costume', 'price': 450, 'glb': 'models/costume_hotdog.glb', 'attach': 'spine', 'hides': ['top', 'hat']},
]


def load(name):
	with open(os.path.join(PUBLIC, name), encoding='utf-8') as fh:
		return json.load(fh)


def main():
	wardrobe = load('catalog_wardrobe.json')
	furniture = load('catalog_furniture.json')
	clothes = [{**item, 'glb': 'models/avatar_modular.glb'} for item in wardrobe['items']]
	catalog = {
		'version': 1,
		'currency': {'name': 'Pelamonedas', 'startCoins': START_COINS},
		'avatar': {'glb': 'models/avatar_modular.glb', 'bodies': ['M', 'F'], 'palettes': wardrobe['palettes'], 'looks': wardrobe['looks']},
		'shops': {
			'clothes': {'title': 'Ropa y estilo', 'sections': ['hair', 'eyes', 'brows', 'mouth', 'cheeks', 'top', 'bottom', 'shoes', 'hat', 'costume']},
			'furniture': {'title': 'Muebles', 'sections': sorted({item['category'] for item in furniture['items']})},
		},
		'items': clothes + COSTUMES + [{**item, 'slot': 'furniture'} for item in furniture['items']],
	}
	path = os.path.join(PUBLIC, 'catalog.json')
	with open(path, 'w', encoding='utf-8') as fh:
		json.dump(catalog, fh, ensure_ascii=False, indent=1)
	print(f'[pelacord-3d] catálogo: {len(catalog["items"])} artículos -> {path}')


if __name__ == '__main__':
	main()
