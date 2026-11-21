"""Fila de avatares con colores distintos y cada disfraz: art/previews/costumes.png"""
import os
import sys

import bpy

sys.path.insert(0, os.path.dirname(__file__))
import avatar  # noqa: E402
import costumes  # noqa: E402
import toy  # noqa: E402

LOOKS = [
	('none', {'skin': (0.98, 0.78, 0.62), 'shirt': 'mustard', 'pants': (0.20, 0.24, 0.45), 'hair': (0.16, 0.10, 0.08)}),
	('cone', {'skin': (0.78, 0.55, 0.38), 'shirt': 'sky', 'pants': (0.30, 0.22, 0.40), 'hair': (0.10, 0.08, 0.07), 'sole': 'mint'}),
	('frog', {'skin': (0.99, 0.84, 0.72), 'shirt': 'coral', 'pants': (0.18, 0.30, 0.30), 'hair': (0.85, 0.60, 0.25)}),
	('pirate', {'skin': (0.55, 0.36, 0.24), 'shirt': (0.95, 0.95, 0.92), 'pants': (0.35, 0.18, 0.12), 'hair': (0.08, 0.06, 0.06), 'sole': 'mustard'}),
	('hotdog', {'skin': (0.96, 0.74, 0.58), 'shirt': 'sofa_purple', 'pants': (0.22, 0.28, 0.52)}),
]

if __name__ == '__main__':
	toy.reset_scene()
	built = costumes.build_all()
	spacing = 0.95
	for index, (costume, colors) in enumerate(LOOKS):
		x = (index - (len(LOOKS) - 1) / 2) * spacing
		rig, body = avatar.build(colors, suffix=f'_{index}')
		rig.location.x = x
		if costume != 'none':
			built[costume].location.x = x
	toy.preview_rig(target=(0, 0, 0.75), distance=5.6, height=1.1, angle_deg=-12, lens=50)
	toy.render_preview('costumes.png', resolution=(1500, 700))
