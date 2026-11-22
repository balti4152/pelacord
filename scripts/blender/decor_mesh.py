"""Small mesh builder for the handcrafted furniture. Blender front is -Y."""

import math
import bpy
from mathutils import Vector

import toy

TAU = math.tau
PALETTE = {
	'walnut': (.39, .23, .18), 'oak': (.72, .48, .31), 'woodcut': (.50, .31, .22),
	'maple': (.88, .64, .42), 'brass': (.93, .70, .35), 'iron': (.29, .29, .35),
	'ink': (.22, .17, .24), 'cream': (.98, .87, .71), 'porcelain': (.92, .94, .84),
	'rose': (.86, .43, .49), 'blush': (.98, .67, .67), 'berry': (.59, .27, .39),
	'plum': (.46, .30, .46), 'lilac': (.73, .59, .83), 'blue': (.45, .67, .86),
	'indigo': (.32, .42, .68), 'aqua': (.50, .81, .78), 'teal': (.27, .54, .56),
	'leaf': (.42, .62, .34), 'darkleaf': (.26, .48, .32), 'sprout': (.68, .80, .40),
	'sage': (.65, .75, .54), 'soil': (.37, .26, .22), 'stone': (.68, .62, .56),
	'clay': (.81, .48, .37), 'honey': (.97, .74, .33), 'white': (.99, .96, .84),
	'opal': (.99, .84, .53), 'lavender_light': (.82, .70, 1), 'silver': (.61, .74, .78),
}


def color_material(key):
	color = PALETTE[key]
	light = key in ('opal', 'lavender_light')
	paint = toy.material('Atelier · ' + key, color, .39 if key in ('brass', 'silver', 'opal') else .67,
		emission=.46 if light else 0)
	if key in ('brass', 'silver'):
		next(node for node in paint.node_tree.nodes if node.type == 'BSDF_PRINCIPLED').inputs['Metallic'].default_value = .28
	return paint


def interpolate(points, divisions):
	for i in range(len(points) - 1):
		a, b, c, d = (points[max(0, i - 1)], points[i], points[i + 1], points[min(i + 2, len(points) - 1)])
		for sample in range(divisions):
			t = sample / divisions
			yield tuple(.5 * (2*y + (-x+z)*t + (2*x-5*y+4*z-w)*t*t + (-x+3*y-3*z+w)*t*t*t) for x,y,z,w in zip(a,b,c,d))
	yield points[-1]


def oval(rx, ry, count=36):
	return [(rx * math.cos(TAU*i/count), ry * math.sin(TAU*i/count)) for i in range(count)]


def soft_rectangle(width, height, radius, steps=5):
	r = min(radius,width/2,height/2)
	points = []
	for cx,cy,start in ((width/2-r,height/2-r,0),(-width/2+r,height/2-r,90),(-width/2+r,-height/2+r,180),(width/2-r,-height/2+r,270)):
		for i in range(steps):
			t = math.radians(start + 90*i/(steps-1))
			points.append((cx+r*math.cos(t),cy+r*math.sin(t)))
	return points


def arch(width, bottom, spring, crown):
	r = width/2
	return [(-r,bottom),(r,bottom),(r,spring)] + [
		(r*math.cos(math.pi*i/20),spring+crown*math.sin(math.pi*i/20)) for i in range(1,21)
	]


class Model:
	def __init__(self):
		self.points = []
		self.faces = []
		self.surfaces = []
		self.seats = []
		self.lights = []

	def geometry(self, points, faces, color, smooth=True):
		offset = len(self.points)
		self.points.extend(points)
		self.faces.extend(tuple(offset + i for i in face) for face in faces)
		self.surfaces.extend((color,smooth) for _ in faces)

	def rings(self, rings, color, closed=False, flip=False, caps=True):
		rings = list(rings)
		n = len(rings[0])
		faces = []
		for row in range(len(rings) if closed else len(rings)-1):
			lo, hi = row*n, ((row+1) % len(rings))*n
			for i in range(n):
				j=(i+1)%n
				faces.append((lo+i,lo+j,hi+j,hi+i))
		if caps and not closed:
			faces.extend((tuple(reversed(range(n))), tuple(range((len(rings)-1)*n,len(rings)*n))))
		if flip:
			faces = [tuple(reversed(indices)) for indices in faces]
		self.geometry([p for ring in rings for p in ring], faces, color)
		if caps and not closed:
			self.surfaces[-2:] = [(color,False),(color,False)]

	def lathe(self, color, profile, at=(0,0,0), *, ratio=1, ribs=0, ripple=.05, count=36, divisions=1):
		x,y,z=at
		rings=[]
		for height,radius in interpolate(profile,divisions):
			ring=[]
			for i in range(count):
				a=TAU*i/count
				r=max(.001,radius)*(1+ripple*math.cos(ribs*a) if ribs else 1)
				ring.append((x+r*math.cos(a),y+r*math.sin(a)*ratio,z+height))
			rings.append(ring)
		self.rings(rings,color)

	def ellipsoid(self, color, at, radii, yaw=0, tilt=0, rings=10, count=20):
		x,y,z=at
		rx,ry,rz=radii
		ring_list=[]
		for j in range(rings+1):
			a=math.pi*(j/rings-.5)
			section=max(.001,math.cos(a))
			ring=[]
			for px,py in oval(rx*section,ry*section,count):
				pz=rz*math.sin(a)
				px,pz=px*math.cos(tilt)+pz*math.sin(tilt),-px*math.sin(tilt)+pz*math.cos(tilt)
				ring.append((x+px*math.cos(yaw)-py*math.sin(yaw),y+px*math.sin(yaw)+py*math.cos(yaw),z+pz))
			ring_list.append(ring)
		self.rings(ring_list,color)

	def plate(self, color, shape, at, thickness, bevel=.025, *, front=False, yaw=0):
		x,y,z=at
		if sum(a[0]*b[1]-b[0]*a[1] for a,b in zip(shape,shape[1:]+shape[:1])) < 0:
			shape=list(reversed(shape))
		n=len(shape)
		mid_x=sum(p[0] for p in shape)/n
		mid_y=sum(p[1] for p in shape)/n
		width=max(p[0] for p in shape)-min(p[0] for p in shape)
		height=max(p[1] for p in shape)-min(p[1] for p in shape)
		d=min(thickness*.47,bevel)
		sx=max(.2,1-min(.25,2*bevel/width))
		sy=max(.2,1-min(.25,2*bevel/height))
		rings=[]
		for t,tx,ty in ((-thickness/2,sx,sy),(-thickness/2+d*.34,1-(1-sx)*.19,1-(1-sy)*.19),
			(-thickness/2+d,1,1),(thickness/2-d,1,1),(thickness/2-d*.34,1-(1-sx)*.19,1-(1-sy)*.19),(thickness/2,sx,sy)):
			ring=[]
			for u,v in shape:
				px,pv=mid_x+(u-mid_x)*tx,mid_y+(v-mid_y)*ty
				py,pz=(-t,pv) if front else (pv,t)
				ring.append((x+px*math.cos(yaw)-py*math.sin(yaw),y+px*math.sin(yaw)+py*math.cos(yaw),z+pz))
			rings.append(ring)
		self.rings(rings,color)

	def soft(self, color, at, width, height, thickness, radius=.08, *, front=False, yaw=0, bevel=.036):
		self.plate(color,soft_rectangle(width,height,radius),at,thickness,bevel,front=front,yaw=yaw)

	def tube(self, color, points, radius, *, divisions=3, count=9, closed=False, ratio=1, caps=True, flip=False):
		guides=[(*p,radius) if len(p)==3 else p for p in points]
		samples=list(interpolate(guides,divisions)) if divisions>1 else guides
		coords=[Vector(p[:3]) for p in samples]
		rings=[]
		for i,p in enumerate(coords):
			lo=(i-1)%len(coords) if closed else max(0,i-1)
			hi=(i+1)%len(coords) if closed else min(len(coords)-1,i+1)
			tangent=(coords[hi]-coords[lo]).normalized()
			ref=Vector((0,0,1)) if abs(tangent.z)<.95 else Vector((0,1,0))
			side=tangent.cross(ref).normalized()
			up=tangent.cross(side).normalized()
			r=max(.001,samples[i][3])
			rings.append([tuple(p+side*u+up*v) for u,v in oval(r,r*ratio,count)])
		self.rings(rings,color,closed=closed,caps=caps and not closed,flip=flip)

	def hoop(self, color, at, width, height, thickness, *, front=False, yaw=0, count=44):
		x,y,z=at
		points=[]
		for u,v in oval(width/2,height/2,count):
			px,py,pz=(u,0,v) if front else (u,v,0)
			points.append((x+px*math.cos(yaw)-py*math.sin(yaw),y+px*math.sin(yaw)+py*math.cos(yaw),z+pz))
		self.tube(color,points,thickness,divisions=1,closed=True)

	def leaf(self, color, base, tip, width, *, curl=.04, lobes=0, split=None, vein=None):
		a,b=Vector(base),Vector(tip)
		axis=b-a
		side=axis.cross(Vector((0,0,1))).normalized()
		if side.length<.1: side=Vector((1,0,0))
		normal=side.cross(axis).normalized()
		rows=18 if lobes else 10
		points=[]
		for i in range(rows+1):
			t=i/rows
			mid=a+axis*t
			w=max(.003,math.sin(math.pi*t)**.78*width)
			for cross in (-1,-.5,0,.5,1):
				f=math.sin(lobes*TAU*t+.30*cross) if lobes else 1
				displacement=w*cross*(.26+.74*abs(f)) if abs(cross)==1 and lobes else w*cross
				points.append(tuple(mid+side*displacement+normal*(curl*math.sin(math.pi*t)*(1-.48*cross*cross))))
		faces=[(i*5+j,i*5+j+1,i*5+j+6,i*5+j+5) for i in range(rows) for j in range(4) if not split or not split(i,j)]
		offset=len(points)
		back=[tuple(Vector(p)-normal*.0038) for p in points]
		rim={}
		for face in faces:
			for i,j in zip(face,face[1:]+face[:1]):
				reverse=(j,i)
				if reverse in rim:
					del rim[reverse]
				else:
					rim[(i,j)]=None
		faces+= [tuple(offset+i for i in reversed(face)) for face in faces]+[(j,i,i+offset,j+offset) for i,j in rim]
		self.geometry(points+back,faces,color)
		if vein:
			mid=a+axis*.44+normal*(curl+.004)
			self.tube(vein,[(*a,.006),(*mid,.005),(*b,.002)],.005,count=6)

	def seat(self, name, at, facing=0):
		self.seats.append((name,at,facing))

	def glow(self, at, color=(1,.77,.54), energy=28):
		self.lights.append((at,color,energy))

	def build(self,name,collection):
		floor=min(p[2] for p in self.points)
		if abs(floor)>1e-6:
			self.points=[(x,y,z-floor) for x,y,z in self.points]
		mesh=bpy.data.meshes.new(name)
		mesh.from_pydata(self.points,[],self.faces)
		keys=list(dict.fromkeys(key for key,_ in self.surfaces))
		for key in keys:
			mesh.materials.append(color_material(key))
		index={key:i for i,key in enumerate(keys)}
		for face,(key,smooth) in zip(mesh.polygons,self.surfaces):
			face.material_index=index[key]
			face.use_smooth=smooth
		mesh.update()
		obj=bpy.data.objects.new(name,mesh)
		collection.objects.link(obj)
		for label,(x,y,z),facing in self.seats:
			toy.mark_seat(label,(x,y,z-floor),facing_deg=facing,parent=obj,col=collection)
		for i,((x,y,z),color,energy) in enumerate(self.lights):
			light=toy.point_light(name+' luz '+str(i),(x,y,z-floor),color,energy,radius=.22,col=collection)
			light.parent=obj
		return obj

