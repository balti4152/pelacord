"""Botanical furniture with sculpted foliage, planters and stands."""

import math
import random

from decor_mesh import Model, TAU, oval


def ceramic(g, color, size=.25, h=.36, at=(0,0,0), style='taper'):
	profiles={
		'taper':[(0,.63),(.06,.72),(.83,1),(.91,1.04),(1,1.02),(1.013,.93),(.87,.86)],
		'urn':[(0,.63),(.06,.67),(.26,.95),(.64,1),(.84,.82),(.94,.77),(1,.82),(1.018,.72),(.90,.66)],
		'bowl':[(0,.52),(.09,.62),(.42,.87),(.76,1),(.95,1.015),(1,.965),(.87,.90)],
		'square':[(0,.80),(.08,.83),(.85,1),(1,1),(1.011,.91),(.91,.83)],
	}
	g.lathe(color,[(z*h,r*size) for z,r in profiles[style]],at,ribs=12 if style=='taper' else 0,ripple=.028,count=48,divisions=2)
	x,y,z=at
	g.lathe('soil',[(h*.88,size*.68),(h*.92,size*(.71 if style=='urn' else .85))],at,count=36)
	if style in ('urn','bowl'):
		r=size*(.80 if style=='urn' else 1.01)
		g.hoop('porcelain',(x,y,z+h*.95),r*2,r*2,.008,count=40)


def blossom(g, center, colors, radius, *, shape=5, heading=0, tall=False):
	x,y,z=center
	for i in range(shape):
		a=TAU*i/shape+heading
		g.leaf(colors[i%len(colors)],(x-radius*.19*math.cos(a),y-radius*.19*math.sin(a),z),
			(x+radius*math.cos(a),y+radius*math.sin(a),z+radius*(.55 if tall else .27)),radius*.32,curl=radius*.20)
	g.ellipsoid('honey',(x,y,z+.023),(.25*radius,.25*radius,.19*radius),rings=6,count=12)


def monstera():
	g=Model()
	ceramic(g,'clay',.255,.34)
	for i,(angle,height,length) in enumerate(((.22,.80,.37),(1.72,.94,.34),(2.48,.84,.39),(3.68,.73,.31),(4.35,.95,.36),(5.45,.70,.38),(5.85,1.025,.31))):
		dx,dy=math.cos(angle),math.sin(angle)
		base=(dx*.125,dy*.128,height-.10)
		g.tube('darkleaf',[(dx*.07,dy*.07,.30,.014),(dx*.052,dy*.057,.47,.016),(*base,.012)],.012,count=8)
		tip=(base[0]+dx*length,base[1]+dy*length,height+.012)
		slots=lambda row,col: row>=4 and row<=14 and ((col==0 and row%4==0) or (col==3 and row%4==2))
		g.leaf(('darkleaf','leaf','sage')[i%3],base,tip,.143,curl=.07,lobes=2.15,split=slots,vein='sprout')
	return g


def bonsai():
	g=Model()
	for x in (-.188,.188):
		g.soft('walnut',(x,0,.04),.19,.27,.08,.061)
	g.plate('teal',oval(.335,.243), (0,0,.15), .16,.057)
	g.plate('sage',oval(.326,.234),(0,0,.22),.03,.024)
	g.plate('soil',oval(.296,.21),(0,0,.237),.022,.014)
	trunk=[(.037,-.011,.235,.072),(-.083,.012,.367,.063),(-.12,.041,.506,.048),
		(-.019,.072,.659,.037),(.109,.058,.769,.022),(.155,.023,.839,.011)]
	g.tube('walnut',trunk,.052,divisions=5,count=15)
	g.tube('woodcut',[(.074,-.064,.255,.010),(-.06,-.044,.366,.014),(-.099,.004,.498,.010),(-.013,.047,.63,.004)],.012,count=8)
	rng=random.Random(18)
	for i,(x,y,z) in enumerate(((-.316,.020,.562),(.257,.022,.688),(-.18,.126,.719),(.14,.031,.831))):
		parent=trunk[2 if i<2 else 3]
		g.tube('walnut',[parent,((parent[0]+x)/2,y-.04,z-.08,.021),(x,y,z,.010)],.028,count=10)
		for j in range(17):
			a=TAU*j/17
			r=.07+rng.random()*.133
			start=(x+math.cos(a)*r*.35,y+math.sin(a)*r*.35,z+rng.uniform(-.035,.051))
			g.leaf(('darkleaf','leaf','sprout','sage')[j%4],start,(x+r*math.cos(a),y+r*math.sin(a),start[2]+.013),.045,curl=.026)
		for j in range(4):
			g.ellipsoid('rose',(x+(j-1.5)*.062,y-.056,z+.045+j*.01),(.018,.018,.013),rings=5,count=10)
	for j in range(5):
		a=j*TAU/5
		g.ellipsoid('stone',(.212*math.cos(a),.14*math.sin(a),.247),(.055,.04,.022),yaw=a,rings=6,count=14)
	return g


def hydrangea():
	g=Model()
	ceramic(g,'porcelain',.224,.326,style='urn')
	rng=random.Random(9)
	for i,(x,y,z) in enumerate(((-.15,-.04,.680),(.15,.01,.766),(.052,.14,.832),(-.19,.125,.781))):
		g.tube('darkleaf',[(0,0,.30),(x*.45,y*.45,.47),(x,y,z)],.013,count=8)
		g.leaf('sage',(x*.48,y*.44,.486),(x*1.63,y-.116,.57),.084,curl=.047,vein='sprout')
		for j in range(10):
			t=j*2.39996
			r=.111*math.sqrt(j/10)
			c=(x+math.cos(t)*r,y+math.sin(t)*r,z+.075*(1-r/.115))
			blossom(g,c,('lilac','blue','lavender_light') if i%2 else ('blush','rose','porcelain'),rng.uniform(.045,.056),shape=4,heading=t)
	return g


def olive():
	g=Model()
	ceramic(g,'sage',.263,.343,style='urn')
	trunk=[(0,0,.295,.046),(-.029,.012,.53,.037),(.036,.028,.812,.022),(.014,.073,1.27,.008)]
	g.tube('woodcut',trunk,.038,count=13)
	for j in range(7):
		a=j*2.39996
		dx,dy=math.cos(a),math.sin(a)
		z=.68+.079*j
		x,y=.35*dx,.35*dy
		g.tube('walnut',[(0,.023,z,.016),(x*.64,y*.64,z+.115,.012),(x,y,z+.167,.004)],.015,count=8)
		for k in range(7):
			t=(k+2)/9
			s=(-1)**k
			u,v=x*t,y*t
			g.leaf(('leaf','sage','darkleaf')[k%3],(u,v,z+.145*t),(u+s*.111*dy+.059*dx,v-s*.111*dx+.059*dy,z+.108+.146*t),.026,curl=.019)
			if k%3==0:
				g.ellipsoid('plum',(u+.035*dx,v+.035*dy,z+.135*t),(.018,.018,.034),tilt=.29,rings=6,count=12)
	return g


def orchid():
	g=Model()
	ceramic(g,'lilac',.194,.284,style='urn')
	for j in range(6):
		a=j*TAU/6
		g.leaf('darkleaf',(.024*math.cos(a),.024*math.sin(a),.269),
			(.30*math.cos(a),.24*math.sin(a),.354+(j%3)*.065),.068,curl=.061,vein='leaf')
	for side,height in ((-1,.92),(1,.80)):
		g.tube('darkleaf',[(0,.018,.279),(side*.052,.039,.473),(side*.11,.016,height-.10),
			(side*.212,-.045,height),(side*.293,-.026,height-.13)],.010,count=8)
		for j in range(4):
			x=side*(.13+j*.054)
			y=-.032-j*.038
			z=height-((j-1.1)**2)*.041
			# Wide petals wrapping a small raised lip.
			for k in range(5):
				a=k*TAU/5
				g.leaf('white' if k<3 else 'blush',(x,y,z),(x+.062*math.cos(a),y-.04,z+.065*math.sin(a)),
					.031,curl=.026)
			g.ellipsoid('rose',(x,y-.029,z-.015),(.024,.023,.029),rings=7,count=14)
			g.ellipsoid('honey',(x,y-.048,z-.010),(.011,.009,.016),rings=5,count=10)
	return g


def succulent():
	g=Model()
	g.lathe('stone',[(0,.31),(.036,.344),(.072,.341),(.092,.316)],ratio=.76)
	for x,y,r in ((-.16,.031,.147),(.12,.074,.137),(.064,-.095,.115)):
		ceramic(g,('indigo' if x<0 else 'clay' if y<0 else 'aqua'),r,.135,(x,y,.09),style='bowl')
		for j in range(20):
			a=j*2.39996
			t=j/21
			length=r*(1.15-.65*t)
			b=(x+.012*math.cos(a),y+.012*math.sin(a),.216+t*.057)
			g.leaf(('sage','sprout','teal','leaf')[j%4],b,(x+length*math.cos(a),y+length*math.sin(a),b[2]+.026+t*.079),
				.032-.013*t,curl=.042)
	return g


def ivy_stand():
	g=Model()
	g.lathe('walnut',[(0,.22),(.026,.286),(.062,.277),(.083,.20)],ratio=.77)
	g.tube('brass',[(.133,.11,.065,.027),(.236,.137,.52,.020),(.255,.135,1.13,.017),
		(.138,.056,1.42,.018),(-.113,-.062,1.375,.022)],.019,count=12)
	for i in range(3):
		t=TAU*i/3
		g.tube('cream',[(-.113,-.062,1.377),(-.113+.162*math.cos(t),-.062+.162*math.sin(t),1.054)],.008,count=7,divisions=1)
	ceramic(g,'clay',.193,.20,(-.113,-.062,.878),'bowl')
	for i in range(5):
		t=TAU*i/5
		dx,dy=math.cos(t),math.sin(t)
		x,y=-.113+.25*dx,-.062+.25*dy
		g.tube('leaf',[(-.113,-.062,1.083),(x,y,1.025),(x+.055*dx,y+.055*dy,.69),
			(x+.092*dx,y+.092*dy,.39+(i%3)*.096)],.009,count=7)
		for j in range(6):
			f=(j+1)/7
			s=(-1)**j
			z=1.012-f*(.56-(i%3)*.103)
			u,v=x+f*.062*dx,y+f*.062*dy
			g.leaf(('sage','leaf','darkleaf')[(i+j)%3],(u,v,z),(u+dx*.067+s*dy*.083,v+dy*.067-s*dx*.083,z-.067),
				.045,curl=.035,lobes=1.23,vein='sprout')
	return g


def cactus():
	g=Model()
	ceramic(g,'blue',.231,.32,style='taper')
	g.lathe('teal',[(.28,.127),(.35,.166),(.66,.164),(.93,.137),(1.008,.112),(1.04,.052),(1.045,.001)],ribs=9,
		ripple=.104,count=54,divisions=3)
	for side,h in ((-1,.78),(1,.89)):
		g.tube('leaf',[(0,.015,.52,.064),(side*.186,.02,.536,.064),(side*.248,.027,.636,.059),
			(side*.253,.027,h,.039),(side*.253,.027,h+.028,.013)],.061,count=16,divisions=5)
		for i in range(3):
			blossom(g,(side*.253+(i-1)*.040,.022+(i%2)*.029,h+.027),
				('rose','blush','white'),.052,shape=6,heading=i*.6,tall=True)
	for j in range(12):
		a=j*2.39996
		z=.40+(j%8)*.074
		g.tube('porcelain',[(.142*math.cos(a),.142*math.sin(a),z),
			(.179*math.cos(a),.179*math.sin(a),z+.029)],.004,count=5,divisions=1)
	return g

