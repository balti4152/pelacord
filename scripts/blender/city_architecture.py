"""Modular clay-style storefronts for the PelaCord plaza. Local fronts face -Y."""
import math
import random

import bpy
from mathutils import Matrix, Vector

import shop
import toy

DEG = math.radians
DESIGNS = {
	'Cinema': ((.77, .47, .46), (.43, .29, .42), (.81, .50, .47), 'CINE'),
	'Shop': ((.57, .68, .55), (.44, .53, .47), (.64, .73, .60), 'TIENDA'),
	'Games': ((.44, .51, .65), (.31, .37, .54), (.75, .53, .34), 'JUEGOS'),
	'Lounge': ((.79, .57, .46), (.43, .37, .50), (.81, .66, .49), 'LIVING'),
	'MyHouse': ((.66, .56, .73), (.62, .37, .33), (.79, .53, .45), 'MI CASA'),
}


def arch_outline(width, spring, crown):
	radius=width*.5
	return [(-radius,0),(radius,0)] + [(radius*math.cos(a),spring+crown*math.sin(a))
		for a in (math.pi*i/18 for i in range(19))]


def arch_border(name, x, y, z, width, spring, crown, thickness, material):
	inner=arch_outline(width,spring,crown)
	outer=arch_outline(width+2*thickness,spring+thickness,crown+thickness*.62)
	n=len(inner)
	verts=[(x+px,y+dy,z+pz+dz) for outline,dy,dz in (
		(outer,-.18,-thickness*.62),(inner,-.185,0),(inner,.19,0),(outer,.116,-thickness*.62))
		for px,pz in outline]
	faces=[]
	for k in range(4):
		for i in range(n):
			j=(i+1)%n
			faces.append((k*n+i,k*n+j,((k+1)%4)*n+j,((k+1)%4)*n+i))
	mesh=bpy.data.meshes.new(name)
	mesh.from_pydata(verts,[],faces)
	mesh.materials.append(material)
	mesh.update()
	obj=bpy.data.objects.new(name,mesh)
	toy.link(obj)
	toy.round_edges(obj,.041,segments=3)
	return toy.smooth(obj,63)


def arch(name, x, y, bottom, width, spring, crown, depth, material, bevel=.035):
	"""Solid arch with straight jambs, an elliptical crown, and softly rolled edges."""
	outline = arch_outline(width, spring, crown)
	n = len(outline)
	verts = [(x + px, y + depth*d, bottom + pz) for d in (-.5, .5) for px, pz in outline]
	faces = [tuple(range(n)), tuple(range(2*n - 1, n - 1, -1))]
	faces.extend((i, i + n, (i + 1) % n + n, (i + 1) % n) for i in range(n))
	mesh = bpy.data.meshes.new(name)
	mesh.from_pydata(verts, [], faces)
	mesh.materials.append(material)
	mesh.update()
	obj = bpy.data.objects.new(name, mesh)
	toy.link(obj)
	if bevel:
		toy.round_edges(obj, bevel, segments=3)
	return toy.smooth(obj, 45)


class Building:
	def __init__(self, name, width, depth, height):
		self.name = name
		self.w, self.d, self.h = width, depth, height
		self.front = -depth / 2
		self.parts = []
		self.recesses = []
		wall, roof, detail, self.sign = DESIGNS[name]
		self.wall = toy.material(name + ' plaster', wall)
		self.roof = toy.material(name + ' roof', roof, roughness=.63)
		self.detail = toy.material(name + ' painted trim', detail, roughness=.68)
		self.stone = toy.material('Warm limestone', (.94, .826, .711), roughness=.71)
		self.shadow = toy.material('Deep wood', (.34, .24, .25))
		self.brass = toy.material('Satin brass', (.76, .56, .33), roughness=.49)
		self.glass = toy.material('Amber glass', (.93, .65, .37), roughness=.50, emission=.33,
			emission_color=(1, .71, .45))
		self.light = toy.material('Warm lantern glass', (.99, .81, .56), roughness=.44, emission=.66,
			emission_color=(1, .78, .45))

	def block(self, label, size, pos, material, bevel=.08, rot=(0, 0, 0)):
		self.parts.append(toy.rounded_box(label, size=size, loc=pos, radius=bevel, mat=material, rot=rot, segments=3))

	def arch(self, label, x, y, z, width, spring, crown, depth, material, bevel=.035):
		self.parts.append(arch(label, x, y, z, width, spring, crown, depth, material, bevel))

	def globe(self, label, pos, radii, material):
		self.parts.append(toy.sphere(label, radius=1, scale=radii, loc=pos, mat=material, segments=12, rings=8))

	def recess(self, label, x, front, bottom, width, spring, crown):
		# Actual cut into the wall. The sill and archivolt sit in front, the scene sits inside.
		cutter = arch(label, x, front+.015, bottom, width, spring, crown, .93, self.shadow, 0)
		self.recesses.append(cutter)

	def showcase(self, x, y, bottom, width, tall):
		shelf = toy.material('Warm display shelf', (.57,.37,.27),roughness=.65)
		if self.name == 'Cinema':
			curtain = toy.material('Velvet cinema curtains', (.63,.235,.30),roughness=.91)
			for side in (-1,1):
				for i in range(3):
					self.block('Velvet folds', (.085,.088,tall*.82),
						(x+side*(width*.30+.072*i),y-.084,bottom+tall*.54), curtain,.036)
				self.block('Mini cinema seat', (.19,.125,.23),
					(x+side*width*.16,y-.028,bottom+.165),curtain,.039)
			return
		for t in (.18,.61):
			z=bottom+t*tall
			self.block('Display shelf rail',(width*.84,.17,.057),(x,y,z),shelf,.020)
			for i in range(3):
				item_mat=toy.material('Shop detail '+str(i),((.93,.68,.42),(.80,.48,.37),(.76,.72,.49))[i],roughness=.63)
				dx=(i-1)*width*.24
				if self.name == 'Games':
					self.block('Game boxes',(.17,.13,.14+.034*i),(x+dx,y-.020,z+.121),item_mat,.035)
				else:
					self.globe('Jar on shelf',(x+dx,y-.012,z+.124),(.074,.069,.10+.015*i),item_mat)
					self.block('Jar lid',(.144,.13,.040),(x+dx,y-.012,z+.225+.015*i),self.brass,.019)

	def window(self, x, z, width, tall, *, projection=.08):
		y = self.front - projection
		crown=width*.47
		self.recess('Window opening',x,y,z,width,tall,crown)
		self.parts.append(arch_border('Carved window surround',x,y,z,width,tall,crown,.135,self.stone))
		self.arch('Golden alcove',x,y+.348,z+.013,width-.045,tall-.015,crown-.009,.033,self.glass,.013)
		if z < 1.05 and width>.80:
			self.showcase(x,y+.248,z+.048,width,tall)
		self.block('Vertical wooden muntin', (.060,.075,tall+crown-.04),
			(x,y-.118,z+(tall+crown)/2),self.shadow,.022)
		self.block('Window rail', (width+.015,.071,.066),
			(x,y-.119,z+tall*.64),self.shadow,.019)
		self.block('Stone window sill',(width+.426,.48,.154),(x,y-.072,z-.023),self.stone,.061)

	def door(self):
		y = self.front
		width, spring, crown = 1.40,1.56,.638
		self.recess('Recessed doorway',0,y,.164,width,spring,crown)
		self.parts.append(arch_border('Sculpted portal',0,y,.164,width,spring,crown,.202,self.stone))
		self.arch('Painted door',0,y+.254,.17,width-.083,spring-.046,crown-.025,.044,self.roof,.027)
		self.arch('Amber door fanlight',0,y+.216,1.53,.97,.065,.348,.024,self.glass,.013)
		for sign in (-1,1):
			self.block('Raised door panel',(.50,.050,.97),(sign*.303,y+.211,.762),self.detail,.028)
			self.block('Inner panel rebate',(.39,.025,.83),(sign*.303,y+.179,.763),self.roof,.024)
			self.globe('Door pull',(sign*.102,y+.151,1.036),(.038,.030,.069),self.brass)
		self.block('Door center stile',(.036,.039,1.74),(0,y+.177,1.04),self.shadow,.014)
		for i in range(3):
			self.block('Limestone entry tread',(1.95-.12*i,.34,.087),(0,y-.48+i*.14,.057+i*.063),self.stone,.037)

	def lantern(self, x, y, z):
		self.block('Lantern back', (.14, .13, .33), (x, y+.064, z+.10), self.brass, .047)
		self.block('Lantern arm', (.074, .28, .074), (x, y-.057, z+.22), self.brass, .030)
		self.globe('Lantern bulb', (x, y-.16, z), (.089, .089, .12), self.light)
		self.globe('Lantern cap', (x, y-.16, z+.116), (.099, .098, .044), self.brass)

	def planter(self, x, y, z, width):
		leaf = toy.material('Terrace leaves', (.40, .56, .33))
		flower = toy.material(self.name + ' flower', (.95, .78, .62) if self.name == 'Shop' else (.84, .61, .65))
		self.block('Planter trough', (width, .37, .22), (x, y, z+.11), self.detail, .086)
		for i in range(5):
			dx = (i - 2)*width/5
			self.globe('Planter leaf', (x+dx, y, z+.24), (.15, .15, .13), leaf)
			if i % 2 == 0:
				self.globe('Flower cluster', (x+dx, y-.046, z+.35), (.099, .087, .060), flower)

	def hip_roof(self, rise, shingles=False):
		base = self.h + .083
		w, d = self.w + .39, self.d + .40
		half_w, half_d = w / 2, d / 2
		ridge = half_d if shingles else half_d - .71
		mesh = bpy.data.meshes.new('Pitched roof')
		mesh.from_pydata([
			(-half_w,-half_d,base), (half_w,-half_d,base), (half_w,half_d,base), (-half_w,half_d,base),
			(0,-ridge,base+rise), (0,ridge,base+rise),
		], [], [(3,2,1,0), (0,1,4), (1,2,5,4), (2,3,5), (3,0,4,5)])
		mesh.materials.append(self.roof)
		mesh.update()
		obj = bpy.data.objects.new('Soft pitched roof',mesh)
		toy.link(obj)
		toy.round_edges(obj,.062,segments=3)
		self.parts.append(toy.smooth(obj,40))
		self.block('Roof eave', (w+.05,d+.04,.15), (0,0,base+.005), self.detail, .071)
		self.block('Rounded ridge', (.21,2*ridge+.06,.17), (0,0,base+rise-.025), self.roof, .079)

		theta = math.atan2(rise, half_w)
		length = math.hypot(rise, half_w)
		for sign in (-1,1):
			if shingles:
				for i in range(11):
					y = (i-5)*d/11
					for row in range(4):
						fraction = (row+.5)/4
						mat = self.detail if (i + row*3) % 8 == 0 else self.roof
						self.block('Rounded terracotta tile', (length/4+.105,.335,.146),
							(sign*half_w*fraction,y,base+rise*(1-fraction)+.036), mat,
							.068,(0,sign*theta,0))
			else:
				for i in range(5):
					y = (i-2)*ridge*.43
					self.block('Standing roof seam', (length*.96,.042,.065),
						(sign*half_w*.49,y,base+rise*.51+.040), self.roof,.019,(0,sign*theta,0))
		self.block('Capped chimney', (.59,.62,.94), (self.w*.24,self.d*.18,base+rise*.58), self.stone,.087)
		self.block('Chimney cap', (.73,.76,.18), (self.w*.24,self.d*.18,base+rise*.58+.48), self.detail,.078)

	def cinema_roof(self):
		base = self.h + .09
		self.arch('Vaulted cinema roof', 0, 0, base, self.w+.32, .19, .94, self.d+.42, self.roof, .079)
		for i in range(6):
			self.arch('Vault seam', 0, (i-2.5)*self.d/5.8, base+.075, self.w+.332, .20, .937,
				.069, self.detail, .021)
		y = self.front - .55
		self.arch('Marquee curved canopy', 0, y, 2.54, 2.89, .14, .31, 1.22, self.roof, .073)
		self.block('Marquee fascia', (2.92, .20, .20), (0, y-.574, 2.59), self.detail)
		for x in (-1.19,-.89,-.59,-.30,0,.30,.59,.89,1.19):
			self.globe('Marquee pearl', (x, y-.689, 2.60), (.067, .044, .063), self.light)

	def shop_awning(self):
		y = self.front - .48
		for i in range(9):
			x = (i-4)*.418
			mat = self.detail if i%2 else toy.material('Shop canvas highlight', (.71, .79, .64))
			self.block('Canvas fold', (.446, .99, .13), (x, y, 2.75), mat, .061, (DEG(17), 0, 0))
			self.globe('Scalloped edge', (x, y-.467, 2.588), (.218,.082,.13), mat)

	def build(self):
		w, d, h, front = self.w, self.d, self.h, self.front
		self.block('Plaster envelope', (w, d+.03, h), (0, -.012, h/2), self.wall, .32)
		shell = self.parts[0]
		self.block('Raised foundation', (w+.15, d+.09, .29), (0, 0, .15), self.stone, .11)
		self.block('String course', (w+.15, d+.08, .14), (0, 0, h*.60), self.stone, .059)
		self.block('Cornice', (w+.37, d+.34, .26), (0, 0, h-.035), self.stone, .104)
		self.door()
		for sign in (-1, 1):
			x = (w/2-.33)*sign
			self.block('Corner plaster pilaster', (.26, .29, h-.56), (x, front-.012, h/2), self.stone, .104)
			for z in (.33,h-.30):
				self.block('Carved pilaster capital',(.397,.376,.175),(x,front-.065,z),self.stone,.069)
			self.lantern(sign*(.98 if self.name == 'MyHouse' else 1.085), front-.173, 1.86)
			if w >= 5:
				self.window(sign*(w*.312), .48, w*.228, 1.01 if self.name != 'Cinema' else 1.43,
					projection=.20 if self.name == 'Games' else .08)
			if h >= 4.25 and self.name not in ('Cinema', 'Games'):
				self.window(sign*w*.26, h*.64, .92, .47)
				self.planter(sign*w*.26, front-.285, h*.64+.035, 1.05)
			if self.name in ('Shop', 'Lounge', 'MyHouse'):
				self.planter(sign*w*.36, front-.23, .18, .79)


		for sign in (-1,1):
			start, cuts = len(self.parts), len(self.recesses)
			self.window(.34, .82, 1.10, 1.03)
			if h > 4.2:
				self.window(-.53, h*.64, .79, .44)
			transform = Matrix.Translation(Vector((sign*(w-d)/2,0,0))) @ Matrix.Rotation(sign*math.pi/2,4,'Z')
			bpy.context.view_layer.update()
			for part in self.parts[start:] + self.recesses[cuts:]:
				part.matrix_world = transform @ part.matrix_world

		if self.name == 'Cinema':
			self.cinema_roof()
			self.window(0, 3.04, 1.39, .72)
			sign_z = 3.025
		elif self.name == 'Shop':
			self.hip_roof(.88)
			self.shop_awning()
			sign_z = 3.08
		elif self.name == 'Games':
			self.hip_roof(1.03)
			self.block('Curved arcade balcony',(2.45,.64,.21),(0,front-.21,2.68),self.detail,.096)
			self.window(0, 2.91, 1.48, .59, projection=.19)
			sign_z = 2.48
		else:
			self.hip_roof(.94, shingles=True)
			if self.name == 'MyHouse':
				self.window(1.40, .53, .78, .69)
			sign_z = 2.57

		panel = toy.material('Town sign lettering', (.98, .88, .66), emission=.15)
		self.block('Signboard', (max(1.49,len(self.sign)*.25), .16, .36),
			(0, front-(1.165 if self.name == 'Cinema' else .299), sign_z+.075), self.shadow, .072)
		for cutter in self.recesses:
			opening = shell.modifiers.new('Carved recess','BOOLEAN')
			opening.operation = 'DIFFERENCE'
			opening.object = cutter
			toy.apply_modifiers(shell)
			bpy.data.objects.remove(cutter,do_unlink=True)
		for part in self.parts:
			toy.apply_transforms(part)
		building = toy.join(self.parts, self.name)
		letters = shop.text_mesh(self.name+' sign', self.sign, .29, (0, front-(1.255 if self.name == 'Cinema' else .389), sign_z+.075),
			panel, extrude=.010, rot=(DEG(90),0,0))
		letters.parent = building
		return building


def garden_bed(x, y, width, depth):
	stone = toy.material('Warm limestone', (.94, .826, .711), roughness=.71)
	soil = toy.material('Garden earth', (.37, .34, .27))
	leaves = [toy.material('Garden foliage ' + str(i), color) for i, color in enumerate(
		((.42,.54,.34),(.54,.63,.39),(.35,.49,.34)))]
	blush = toy.material('Garden petals', (.88,.62,.70))
	bits = [
		toy.rounded_box('Low raised garden', (width,depth,.28),(x,y,.14),radius=.13,mat=stone),
		toy.rounded_box('Garden soil', (width-.17,depth-.17,.075),(x,y,.27),radius=.035,mat=soil),
	]
	for i in range(5):
		dx = width * (i-2) / 5.7
		dy = .11 if i%2 else -.10
		z = .34 + .04*(i%3)
		bits.append(toy.sphere('Mounded foliage',radius=1,scale=(width*.18,depth*.38,.21),
			loc=(x+dx,y+dy,z),mat=leaves[i%3],segments=13,rings=9))
		if i%2 == 0:
			for j in (-1,0,1):
				bits.append(toy.sphere('Blossom',radius=1,scale=(.093,.088,.068),
					loc=(x+dx+.085*j,y+dy-.085*j,z+.178+.012*j),mat=blush,segments=11,rings=8))
	for part in bits:
		toy.apply_transforms(part)
	return toy.join(bits,'Plaza garden')
