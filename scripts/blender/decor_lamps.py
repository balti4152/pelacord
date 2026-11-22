"""Decorative lamps with modeled shades, brasswork and local light markers."""

import math

from decor_mesh import Model, TAU


def lily_lamp():
	g=Model()
	g.lathe('walnut',[(0,.22),(.028,.284),(.065,.271),(.082,.210)],ratio=.85,divisions=2)
	g.lathe('brass',[(.076,.092),(.112,.12),(.14,.079),(.178,.05)],count=36)
	bulbs=[(-.236,-.084,1.104),(.206,-.161,1.265),(.062,.103,1.403)]
	for i,(x,y,z) in enumerate(bulbs):
		g.tube('brass',[(0,0,.108,.032),(x*.3,y*.24,.659,.025),(x*.77,y*.64,z+.039,.020),
			(x-.057,y-.035,z+.143,.013),(x,y,z+.124,.017)],.024,count=13,divisions=5)
		g.lathe('teal',[(0,.048),(.038,.063),(.068,.053)],(x,y,z+.061),count=22)
		for j in range(6):
			a=TAU*j/6+.23*i
			g.leaf(('cream','sage','porcelain')[i],(x+.032*math.cos(a),y+.032*math.sin(a),z+.102),
				(x+.137*math.cos(a),y+.137*math.sin(a),z-.062),.061,curl=.042)
		g.ellipsoid('opal',(x,y,z-.005),(.054,.053,.093),rings=11)
		g.glow((x,y,z-.090),energy=14)
	g.leaf('sage',(.04,-.024,.385),(.271,-.168,.679),.056,curl=.037,vein='brass')
	g.leaf('leaf',(-.068,.016,.531),(-.302,.114,.802),.056,curl=.045)
	return g


def harbor_lamp():
	g=Model()
	g.lathe('teal',[(0,.185),(.026,.23),(.063,.224),(.085,.188),(.101,.182)],count=40,divisions=2)
	g.lathe('brass',[(.09,.171),(.111,.192),(.14,.178),(.172,.143)],count=44,divisions=2)
	g.lathe('opal',[(.153,.111),(.191,.129),(.367,.131),(.411,.110),(.427,.081)],count=36,divisions=2)
	for i in range(6):
		a=TAU*i/6
		pts=[(r*math.cos(a),r*math.sin(a),z) for r,z in ((.155,.141),(.158,.264),(.141,.385),(.104,.443))]
		g.tube('teal',pts,.012,count=9)
	g.hoop('brass',(0,0,.225),.310,.310,.008)
	g.lathe('teal',[(.399,.106),(.426,.163),(.449,.159),(.470,.114),(.509,.071),(.531,.063)],count=36,divisions=3)
	g.hoop('brass',(0,0,.613),.167,.207,.014,front=True)
	g.lathe('brass',[(.522,.044),(.551,.055),(.565,.041)],count=22)
	g.soft('walnut',(0,-.181,.108),.126,.054,.029,.025,front=True)
	for x in (-.042,.042):
		g.ellipsoid('honey',(x,-.203,.109),(.009,.005,.009),rings=5,count=10)
	g.glow((0,0,.294),energy=21)
	return g


def paper_lamp():
	g=Model()
	for x in (-.18,.18):
		g.soft('walnut',(x,0,.044),.14,.442,.083,.048)
	g.soft('walnut',(0,0,.128),.493,.445,.129,.086)
	g.lathe('lavender_light',[(.186,.199),(.249,.207),(.73,.197),(.902,.165),(.992,.080),(.997,.015)],
		ratio=.89,ribs=4,ripple=.13,count=48,divisions=4)
	for s in (-1,1):
		for a in (-1,1):
			g.tube('oak',[(s*.20,a*.185,.18,.025),(s*.204,a*.187,.42,.020),(s*.187,a*.166,.749,.020),
				(s*.120,a*.115,.934,.023),(s*.052,a*.058,1.013,.023)],.022,count=11)
	for h,rx,ry in ((.242,.210,.197),(.441,.21,.197),(.633,.207,.192),(.812,.181,.166),(.938,.128,.116)):
		g.hoop('oak',(0,0,h),rx*2,ry*2,.009,count=36)
	for i in range(4):
		x=(i-1.5)*.071
		g.tube('woodcut',[(x,-.183,.204),(x,-.188,.413),(x,-.173,.666),(x*.73,-.114,.915)],
			.008,count=7,divisions=3)
	g.lathe('brass',[(.994,.060),(1.027,.074),(1.051,.038),(1.078,.027)],count=24)
	g.glow((0,0,.674),color=(.82,.64,1),energy=25)
	return g


def scallop_lamp():
	g=Model()
	g.lathe('blush',[(0,.157),(.023,.196),(.078,.182),(.128,.140),(.245,.121),(.335,.078),(.375,.071)],
		ribs=14,ripple=.034,count=56,divisions=2)
	g.lathe('brass',[(.365,.057),(.39,.074),(.414,.049),(.499,.023)],count=22)
	g.lathe('opal',[(.431,.104),(.485,.118),(.59,.119),(.634,.074)],count=30,divisions=2)
	g.lathe('cream',[(.49,.233),(.507,.249),(.555,.237),(.765,.167),(.812,.157),(.822,.149),
		(.805,.144),(.759,.149),(.556,.222),(.514,.233)],ratio=.94,ribs=14,ripple=.048,count=56,divisions=2)
	for j in range(14):
		a=TAU*j/14
		g.tube('clay',[(.259*math.cos(a),.243*math.sin(a),.515),(.206*math.cos(a),.191*math.sin(a),.64),
			(.164*math.cos(a),.153*math.sin(a),.80)],.0034,count=5)
	g.hoop('brass',(0,0,.802),.311,.291,.007,count=37)
	g.hoop('walnut',(0,0,.055),.360,.360,.009)
	g.lathe('brass',[(.796,.038),(.834,.062),(.851,.042),(.880,.027)],count=22)
	g.glow((0,0,.456),energy=20)
	return g

