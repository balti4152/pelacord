"""Collectibles, ceramic pieces and freestanding ornaments."""

import math
from decor_mesh import Model, TAU, arch, oval


def feet(g, width, depth, height, color='walnut'):
	for x in (-width/2,width/2):
		for y in (-depth/2,depth/2):
			g.tube(color,[(x*1.105,y*1.1,.037,.039),(x*1.075,y*1.07,height*.52,.037),(x,y,height,.060)],.05,count=12)
			g.lathe('brass',[(.008,.038),(.038,.043),(.055,.04)],(x*1.10,y*1.10,0),count=16)


def turntable(g, x, y, z, radius):
	g.lathe('ink',[(0,radius*.98),(.013,radius),(.026,radius*.98)],(x,y,z),count=48)
	for fraction in (.60,.76,.88,.95):
		g.hoop('iron',(x,y,z+.026),radius*2*fraction,radius*2*fraction,.0018,count=44)
	g.lathe('clay',[(.024,radius*.33),(.029,radius*.31)],(x,y,z))
	g.lathe('brass',[(.028,.019),(.049,.011)],(x,y,z),count=16)
	g.tube('brass',[(x+radius*.89,y+radius*.76,z+.038),(x+radius*.83,y+radius*.72,z+.125),
		(x+radius*.64,y-radius*.03,z+.090),(x+radius*.47,y-radius*.17,z+.053)],.015,count=8)


def gramophone():
	g=Model()
	feet(g,.53,.43,.23)
	g.soft('walnut',(0,0,.34),.83,.68,.30,.137)
	g.soft('oak',(0,0,.505),.82,.66,.073,.134)
	g.soft('maple',(0,-.343,.347),.55,.175,.042,.067,front=True)
	g.soft('woodcut',(0,-.366,.348),.48,.115,.027,.05,front=True)
	g.hoop('brass',(0,-.388,.341),.105,.053,.012,front=True,count=20)
	for s in (-1,1):
		for j in range(4):
			g.tube('oak',[(s*(.239+j*.022),-.313+j*.010,.297),(s*(.239+j*.022),-.313+j*.010,.396)],.008,divisions=1)
	turntable(g,-.047,-.021,.549,.231)
	trumpet=[(.279,.224,.545,.028),(.279,.200,.686,.034),(.244,.117,.826,.048),
		(.166,-.046,.927,.081),(.068,-.205,.99,.151),(-.018,-.371,1.02,.255)]
	g.tube('brass',trumpet,.05,divisions=5,count=40,caps=False)
	interior=[(x,y+.008,z,max(.01,r-.012)) for x,y,z,r in trumpet]
	g.tube('oak',interior,.05,divisions=5,count=40,caps=False,flip=True)
	g.hoop('brass',(-.018,-.371,1.02),.51,.51,.018,front=True,yaw=-.49)
	return g


def radio():
	g=Model()
	for x in (-.237,.237):
		g.soft('walnut',(x,.012,.051),.23,.305,.102,.045)
	mid=(0,.005,.0)
	g.plate('oak',arch(.80,.075,.445,.294),mid,.37,.068,front=True)
	g.plate('walnut',arch(.70,.118,.438,.240),(0,-.191,0),.061,.04,front=True)
	g.plate('cream',arch(.615,.167,.432,.192),(0,-.222,0),.024,.026,front=True)
	g.soft('ink',(0,-.24,.277),.530,.110,.029,.046,front=True)
	for i in range(15):
		x=(i-7)*.030
		g.tube('brass',[(x,-.258,.256),(x,-.258,.281+(i%5==0)*.026)],.0028,count=5,divisions=1)
	for s in (-1,1):
		for k in range(6):
			x=s*(.039+k*.031)
			g.tube('oak',[(x,-.246,.369),(x,-.257,.491+.087*math.cos(k/7*1.57))],.008,divisions=1)
		g.ellipsoid('brass',(s*.244,-.255,.191),(.044,.029,.044),rings=7,count=14)
	g.ellipsoid('opal',(.112,-.264,.278),(.014,.009,.023),rings=6,count=12)
	return g


def clock():
	g=Model()
	feet(g,.395,.272,.13)
	g.soft('walnut',(0,0,.17),.71,.51,.16,.077)
	g.plate('walnut',arch(.56,.215,1.35,.226),(0,.014,0),.33,.057,front=True)
	g.plate('oak',arch(.516,.255,1.331,.206),(0,-.168,0),.054,.040,front=True)
	g.plate('woodcut',arch(.345,.381,.847,.136),(0,-.207,0),.03,.026,front=True)
	g.tube('brass',[(0,-.228,.889),(0,-.229,.52)],.012,divisions=1)
	g.plate('brass',oval(.098,.103),(0,-.244,.55),.022,.010,front=True)
	g.hoop('honey',(0,-.257,.550),.166,.176,.005,front=True)
	g.plate('cream',oval(.165,.17),(0,-.212,1.288),.034,.016,front=True)
	g.hoop('brass',(0,-.233,1.289),.345,.350,.014,front=True)
	for i in range(12):
		a=TAU*i/12
		r=.131
		g.tube('walnut',[(r*math.sin(a),-.238,1.288+r*math.cos(a)),
			((r-.027)*math.sin(a),-.238,1.288+(r-.027)*math.cos(a))],.0039,count=6,divisions=1)
	g.tube('ink',[(.069,-.245,1.322),(0,-.252,1.285),(-.073,-.245,1.374)],.0075,count=7,divisions=1)
	g.ellipsoid('brass',(0,-.254,1.288),(.014,.007,.014),rings=6,count=10)
	return g


def ceramic_cat():
	g=Model()
	g.lathe('maple',[(0,.26),(.03,.303),(.075,.297),(.105,.248)],ratio=.82,count=36)
	g.lathe('porcelain',[(.097,.121),(.144,.164),(.255,.176),(.388,.147),(.472,.112)],ratio=.81,divisions=3)
	g.ellipsoid('porcelain',(0,-.012,.523),(.177,.138,.145),rings=11,count=24)
	for s in (-1,1):
		outline=[(s*.083,.597),(s*.170,.723),(s*.193,.572)]
		if s==-1: outline.reverse()
		g.plate('porcelain',outline,(0,-.015,0),.095,.035,front=True)
		outline=[(s*.110,.600),(s*.161,.681),(s*.172,.59)]
		if s==-1: outline.reverse()
		g.plate('blush',outline,(0,-.066,0),.017,.011,front=True)
		g.tube('walnut',[(s*.062,-.139,.548),(s*.087,-.149,.562),(s*.112,-.136,.545)],.009,count=7)
		g.ellipsoid('blush',(s*.113,-.134,.499),(.021,.011,.013),rings=7,count=12)
	g.ellipsoid('rose',(0,-.150,.511),(.019,.013,.013),rings=6,count=10)
	g.tube('ink',[(-.030,-.146,.485),(0,-.152,.476),(.030,-.148,.485)],.0065,count=7)
	g.tube('porcelain',[(.074,.089,.177,.050),(.226,.097,.149,.044),(.293,-.006,.226,.037),
		(.265,-.098,.325,.028),(.220,-.092,.369,.016)],.05,count=16)
	g.hoop('brass',(0,-.013,.392),.279,.23,.017)
	g.ellipsoid('honey',(0,-.141,.367),(.039,.025,.047),rings=8,count=16)
	return g


def coral():
	g=Model()
	g.lathe('teal',[(0,.21),(.035,.287),(.084,.29),(.112,.25),(.145,.22)],ratio=.69,divisions=2)
	g.lathe('stone',[(.13,.20),(.17,.195),(.208,.13)],ratio=.76,count=28)
	for x,z,color in ((-.123,.313,'rose'),(.02,.38,'clay'),(.133,.285,'lilac')):
		trunk=[(x,0,.17,.050),(x+.021,-.003,z,.039),(x+.03,.006,z+.16,.023),(x-.001,.01,z+.22,.014)]
		g.tube(color,trunk,.039,count=10)
		for s in (-1,1):
			for j in range(2):
				h=z-.06+j*.09
				g.tube(color,[(x+s*.007,.003,h,.035),(x+s*.076,-.025*s,h+.048,.023),
					(x+s*.102,-.036*s,h+.142,.012)],.028,count=9)
	for i,(x,y) in enumerate(((-.17,-.077),(.12,-.09),(.18,.037),(-.092,-.14))):
		g.ellipsoid(('porcelain','white','indigo')[i%3],(x,y,.161),(.055,.032,.026),yaw=i*.6,count=14)
	return g


def sailing_boat():
	g=Model()
	g.lathe('walnut',[(0,.216),(.03,.265),(.068,.250),(.087,.239)],ratio=.57)
	for x in (-.13,.13):
		g.tube('brass',[(x,.01,.078),(x,.02,.14),(x,.02,.164)],.023,divisions=2)
	for i,(z,w,d) in enumerate(((.136,.80,.252),(.176,.86,.278),(.235,.92,.285))):
		shape=[(w*.5*math.cos(TAU*j/36),d*.54*math.sin(TAU*j/36)*(abs(math.sin(TAU*j/36))**.35)) for j in range(36)]
		g.plate(('walnut','teal','cream')[i],shape,(0,0,z),.068,.023)
	g.tube('oak',[(.03,0,.254),(.03,0,.748)],.015,divisions=1)
	g.tube('brass',[(-.297,0,.39),(.031,0,.40),(.281,0,.372)],.010,divisions=2)
	g.plate('porcelain',[(-.286,.40),(.017,.39),(.017,.725),(-.07,.680),(-.163,.571)],(0,-.021,0),.031,.033,front=True)
	g.plate('blue',[(.047,.415),(.291,.386),(.216,.535),(.047,.67)],(0,-.03,0),.030,.028,front=True)
	g.plate('rose',[(.025,.702),(.159,.728),(.025,.771)],(0,0,0),.022,.012,front=True)
	return g


def hourglass():
	g=Model()
	for z in (0,.665):
		g.lathe('walnut',[(0,.18),(.018,.239),(.058,.252),(.079,.210)],(0,0,z),count=38)
		g.hoop('brass',(0,0,z+.049),.463,.463,.010)
	for i in range(3):
		t=TAU*i/3+.6
		x,y=.173*math.cos(t),.173*math.sin(t)
		g.tube('brass',[(x,y,.072,.026),(x*1.19,y*1.19,.247,.015),
			(x*1.18,y*1.18,.469,.016),(x,y,.692,.024)],.02,count=12)
		# Blown glass is represented by the highlights on the open brass silhouette.
		g.tube('silver',[(x*.76,y*.76,.122,.011),(x*.88,y*.88,.238,.008),
			(x*.20,y*.20,.364,.006),(x*.89,y*.89,.531,.008),(x*.79,y*.79,.61,.011)],.009,count=7)
	g.lathe('honey',[(.106,.138),(.144,.133),(.168,.107),(.198,.063),(.221,.017)],count=32,divisions=2)
	g.lathe('honey',[(.377,.010),(.436,.052),(.485,.091),(.517,.125),(.545,.120)],count=32,divisions=2)
	g.tube('honey',[(0,0,.226),(0,0,.377)],.005,count=6,divisions=1)
	return g


def atlas():
	g=Model()
	g.lathe('walnut',[(0,.193),(.036,.232),(.076,.194),(.103,.122),(.190,.067),(.251,.12),(.271,.092)],count=36,divisions=2)
	at=(0,0,.532)
	g.ellipsoid('blue',at,(.24,.24,.24),rings=18,count=36)
	for yaw in (-.7,.64):
		g.hoop('brass',at,.555,.555,.013,front=True,yaw=yaw)
	g.hoop('brass',at,.50,.50,.007)
	for c,lat,lon,span in (('sage',.36,.2,.56),('sprout',-.09,1.8,.36),('leaf',.09,3.0,.49),
		('sage',-.33,4.9,.63),('leaf',.46,5.2,.35)):
		def xyz(b,a):
			return (math.cos(a)*math.cos(b)*.242,math.sin(a)*math.cos(b)*.242,.532+math.sin(b)*.242)
		patch=[xyz(lat,lon)]
		for i in range(13):
			t=TAU*i/13
			w=1+.19*math.sin(i*2.1)
			patch.append(xyz(lat+.27*w*math.sin(t),lon+span*w*math.cos(t)))
		g.geometry(patch,[(0,(i+1)%13+1,i+1) for i in range(13)],c)
	g.lathe('brass',[(.773,.013),(.797,.029),(.824,.020)],count=18)
	return g


def bird_mobile():
	g=Model()
	g.lathe('walnut',[(0,.20),(.035,.245),(.069,.232),(.084,.187)],ratio=.80)
	g.tube('brass',[(.11,.04,.069,.024),(.23,.06,.434,.018),(.195,.05,.762,.014),
		(.045,.015,.847,.014),(-.073,-.016,.797,.015)],.02,count=12)
	g.tube('brass',[(-.073,-.016,.797),(-.073,-.016,.595)],.0049,divisions=1,count=8)
	g.ellipsoid('teal',(-.067,-.012,.523),(.145,.067,.075),tilt=-.18,rings=11,count=24)
	g.ellipsoid('sage',(0,-.023,.573),(.071,.053,.065),rings=9,count=18)
	for s in (-1,1):
		g.leaf('aqua',(-.054,-.014,.553),(-.224,s*.151,.614),.059,curl=.032)
	g.leaf('indigo',(-.12,0,.525),(-.245,0,.49),.042,curl=.018)
	g.ellipsoid('honey',(.067,-.024,.56),(.048,.026,.020),rings=7,count=14)
	g.ellipsoid('ink',(.022,-.076,.591),(.013,.007,.013),rings=6,count=10)
	g.hoop('brass',(-.073,-.012,.489),.465,.464,.008,front=True)
	return g

