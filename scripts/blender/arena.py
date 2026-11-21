"""
La ARENA: estadio inflable de colores fuertes para los juegos party.

  public/models/room_arena.glb

Convenciones para la app:
  FieldBase      el piso redondo del centro (la app lo esconde cuando un juego pone su propio piso).
  Spawn          donde aparecés (en la tribuna de abajo, el "lobby").
  Hotspot (pelacord_hotspot = 'arena-admin')  la consola para armar y arrancar las partidas.
El campo de juego es un círculo de radio 9 en el centro; abajo hay un "pozo de gelatina".
"""
import math
import os
import random
import sys

sys.path.insert(0, os.path.dirname(__file__))
import bpy  # noqa: E402
import toy  # noqa: E402

DEG = math.radians

PINK = (1.0, 0.36, 0.72)
YELLOW = (1.0, 0.86, 0.18)
BLUE = (0.26, 0.62, 1.0)
GREEN = (0.32, 0.92, 0.5)
PURPLE = (0.62, 0.38, 1.0)
ORANGE = (1.0, 0.55, 0.16)
COLORS = (PINK, YELLOW, BLUE, GREEN, PURPLE, ORANGE)


def glossy(name, color, emission=0.0):
	"""Plástico brillante (poca rugosidad): así se ve 'inflable'."""
	return toy.material(name, color, roughness=0.32, emission=emission, emission_color=color if emission else None)


def build_arena():
	random.seed(21)
	# Pozo de gelatina rosa (donde se cae al perder).
	toy.cylinder('GooPool', radius=13.5, depth=0.3, loc=(0, 0, -11.5), mat=glossy('Goo', (1.0, 0.42, 0.78), emission=0.9), segments=64)
	for k in range(18):
		a = random.uniform(0, math.tau)
		r = random.uniform(2, 12)
		toy.sphere(f'GooBubble_{k}', radius=random.uniform(0.25, 0.6), scale=(1, 1, 0.55), loc=(math.cos(a) * r, math.sin(a) * r, -11.3), mat=glossy('GooBubble', (1.0, 0.6, 0.88), emission=0.6), segments=14, rings=8)
	bubbles = [o for o in bpy.data.objects if o.name.startswith('GooBubble_')]
	for b in bubbles:
		toy.apply_transforms(b)
	toy.join(bubbles, 'GooBubbles')

	# Piso del campo (radio 9) con gajos de colores.
	toy.cylinder('FieldBase', radius=9.0, depth=0.6, loc=(0, 0, -0.3), mat=glossy('FieldBase', (0.62, 0.5, 0.98)), segments=64)
	# Aros concéntricos de colores, cada uno un poquito más alto (si están a la misma altura,
	# "titilan": z-fighting).
	for k, r in enumerate((8.2, 6.6, 5.0, 3.4, 1.8)):
		toy.cylinder(f'FieldBaseRing_{k}', radius=r, depth=0.035, loc=(0, 0, 0.03 + k * 0.05), mat=glossy(f'FieldRing_{k % 2}', (1.0, 0.5, 0.78) if k % 2 == 0 else (0.42, 0.72, 1.0)), segments=64)
	# Borde inflable del pozo: tubo a rayas.
	tubes = []
	for k in range(24):
		# El de abajo (del lado del lobby) no va: ahí está el puente de entrada.
		if k == 6:
			continue
		a = k / 24 * math.tau
		seg = toy.cylinder(f'rim_{k}', radius=0.55, depth=2.55, loc=(math.cos(a) * 10.4, math.sin(a) * 10.4, 0.25), rot=(DEG(90), 0, a + DEG(90)), mat=glossy(f'Rim_{k % 2}', PINK if k % 2 else YELLOW), segments=20, bevel=0.2)
		tubes.append(seg)
	for t in tubes:
		toy.apply_transforms(t)
	toy.join(tubes, 'ArenaRim')

	# Lobby (abajo, cerca de la cámara): plataforma acolchada con rayas.
	toy.rounded_box('Lobby', size=(22, 6.4, 0.6), loc=(0, 13.2, -0.3), radius=0.25, mat=glossy('LobbyFloor', (0.55, 0.4, 0.98)))
	stripes = []
	for k in range(11):
		stripes.append(toy.rounded_box(f'lstripe_{k}', size=(1.0, 6.2, 0.04), loc=(-10 + k * 2, 13.2, 0.03), radius=0.02, mat=glossy('LobbyStripe', (0.68, 0.55, 1.0))))
	for s in stripes:
		toy.apply_transforms(s)
	toy.join(stripes, 'Floor')
	# Rampas que bajan del lobby al campo.
	# Puente plano del lobby al campo (en el medio, donde no hay tubo).
	toy.rounded_box('Bridge', size=(2.6, 2.4, 0.4), loc=(0, 9.5, -0.17), radius=0.12, mat=glossy('Bridge', YELLOW))
	for side in (-1, 1):
		toy.rounded_box(f'BridgeRail_{side}', size=(0.18, 2.4, 0.22), loc=(side * 1.3, 9.5, 0.08), radius=0.08, mat=glossy('BridgeRail', PINK))

	# Tribunas en arco (arriba, detrás del campo), escalones de colores.
	steps = []
	for row in range(4):
		r = 12.2 + row * 1.1
		for k in range(14):
			a = DEG(200 + k * (140 / 13))
			c = COLORS[(k + row) % len(COLORS)]
			steps.append(toy.rounded_box(f'stand_{row}_{k}', size=(2.4, 1.0, 0.6 + row * 0.7), loc=(math.cos(a) * r, math.sin(a) * r, (0.6 + row * 0.7) / 2 - 0.2), rot=(0, 0, a + DEG(90)), radius=0.2, mat=glossy(f'Stand_{(k + row) % len(COLORS)}', c)))
	for s in steps:
		toy.apply_transforms(s)
	toy.join(steps, 'Stands')

	# Inflables gigantes alrededor: bolas, estrellas y pilares.
	for k, (x, y, c) in enumerate(((-15, -6, PINK), (15, -6, BLUE), (-16, 3, GREEN), (16, 3, ORANGE), (-9, -15, YELLOW), (9, -15, PURPLE))):
		toy.sphere(f'BigBall_{k}', radius=1.4, loc=(x, y, 1.6), mat=glossy(f'BigBall_{k}', c), segments=28, rings=16)
		toy.cylinder(f'BallStand_{k}', radius=0.5, depth=0.4, loc=(x, y, 0.1), mat=glossy('BallStand', (1, 1, 1)), segments=20, bevel=0.1)
	for k, (x, y) in enumerate(((-12, 9.5), (12, 9.5))):
		pillar = [toy.cylinder(f'pillar_{k}_{i}', radius=0.7 - i * 0.04, depth=0.8, loc=(x, y, 0.4 + i * 0.8), mat=glossy(f'Pillar_{i % 2}', PINK if i % 2 else YELLOW), segments=20, bevel=0.3) for i in range(5)]
		pillar.append(toy.sphere(f'pillar_top_{k}', radius=0.75, loc=(x, y, 4.4), mat=glossy('PillarTop', BLUE, emission=0.6), segments=20, rings=12))
		for p in pillar:
			toy.apply_transforms(p)
		toy.join(pillar, f'Pillar_{k}')
	# Arco de globos sobre la entrada del lobby... al FONDO del lobby (para no tapar la cámara).
	balloons = []
	for k in range(26):
		t = k / 25
		a = DEG(180) * t
		x = math.cos(a) * 7.5
		z = 2.0 + math.sin(a) * 6.5
		balloons.append(toy.sphere(f'arch_{k}', radius=0.55, loc=(x, -16.5, z), mat=glossy(f'Arch_{k % len(COLORS)}', COLORS[k % len(COLORS)]), segments=16, rings=10))
	for b in balloons:
		toy.apply_transforms(b)
	toy.join(balloons, 'BalloonArch')
	import shop
	sign = glossy('ArenaSign', (1, 1, 1), emission=1.6)
	shop.text_mesh('ArenaText', 'ARENA', 1.6, (0, -16.3, 4.3), sign, extrude=0.18, rot=(DEG(90), 0, 0))

	# Consola de admin (con botones redondos que brillan).
	console = [
		toy.rounded_box('console_body', size=(1.4, 0.9, 1.0), loc=(0, 0, 0.5), radius=0.25, mat=glossy('ConsoleBody', PURPLE)),
		toy.rounded_box('console_top', size=(1.5, 1.0, 0.16), loc=(0, -0.08, 1.05), rot=(DEG(-18), 0, 0), radius=0.08, mat=glossy('ConsoleTop', (0.18, 0.12, 0.3))),
	]
	for k, c in enumerate((PINK, YELLOW, GREEN, BLUE)):
		console.append(toy.sphere(f'console_btn_{k}', radius=0.11, scale=(1, 1, 0.6), loc=(-0.45 + k * 0.3, -0.12, 1.15), mat=glossy(f'ConsoleBtn_{k}', c, emission=1.8), segments=14, rings=8))
	for p in console:
		toy.apply_transforms(p)
	obj = toy.join(console, 'AdminConsole')
	obj.location = (-6.5, 11.6, 0)
	obj.rotation_euler = (0, 0, DEG(180))
	marker = toy.empty('Hotspot_arena_admin', loc=(-6.5, 12.6, 0), display='SINGLE_ARROW', size=0.5)
	marker['pelacord_hotspot'] = 'arena-admin'

	# Nubes esponjosas y luces.
	for k in range(7):
		cx, cy, cz = random.uniform(-22, 22), random.uniform(-30, -20), random.uniform(8, 14)
		puffs = [toy.sphere(f'cloud_{k}_{i}', radius=random.uniform(1.4, 2.4), loc=(cx + i * 1.6 - 2.4, cy, cz + random.uniform(-0.4, 0.4)), mat=glossy('Cloud', (1, 1, 1), emission=0.4), segments=16, rings=10) for i in range(4)]
		for p in puffs:
			toy.apply_transforms(p)
		toy.join(puffs, f'Cloud_{k}')
	sun = bpy.data.lights.new('ArenaSun', 'SUN')
	sun.energy = 1.4
	sun.color = (1.0, 0.96, 0.9)
	sun_obj = bpy.data.objects.new('ArenaSun', sun)
	sun_obj.rotation_euler = (DEG(45), DEG(10), DEG(25))
	toy.link(sun_obj)
	toy.point_light('ArenaFill', (0, 6, 6), color=(1.0, 0.85, 0.95), energy=220, radius=3.0)
	toy.empty('Spawn', loc=(0, 13.2, 0))
	return 'room_arena.glb'


if __name__ == '__main__':
	toy.reset_scene()
	toy.export_glb(build_arena(), lights=True)
