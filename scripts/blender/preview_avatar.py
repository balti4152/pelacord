"""Renderiza el avatar en cada pose (para revisar el estilo): art/previews/avatar_*.png"""
import os
import sys

import bpy

sys.path.insert(0, os.path.dirname(__file__))
import avatar  # noqa: E402
import toy  # noqa: E402

POSES = [('Idle', 1), ('Walk', 1), ('Sit', 1), ('Talk', 4), ('Wave', 15), ('Slap', 10)]

if __name__ == '__main__':
	toy.reset_scene()
	rig, body = avatar.build()
	toy.export_glb('avatar.glb', objects=[rig, body], animations=True)
	toy.preview_rig(target=(0, 0, 0.62), distance=2.6, height=0.55, angle_deg=-25, lens=60)
	for name, frame in POSES:
		avatar.reset_pose(rig)
		avatar.pose_for_preview(rig, name, frame)
		toy.render_preview(f'avatar_{name.lower()}.png', resolution=(600, 700))
