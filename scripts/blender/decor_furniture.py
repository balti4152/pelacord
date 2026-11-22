"""Upholstery, casework and accent tables."""

import math
import random

from decor_mesh import Model, TAU, arch, oval, soft_rectangle
from decor_objects import feet


def piping(g,color,width,depth,z,*,radius=.17):
	g.tube(color,[(x,y,z) for x,y in soft_rectangle(width,depth,radius)],.012,closed=True,divisions=1,count=9)


def shell_chair():
	g=Model()
	feet(g,.54,.40,.385,'oak')
	g.lathe('berry',[(.374,.293),(.403,.435),(.475,.458),(.536,.422)],ratio=.82,divisions=2)
	g.ellipsoid('blush',(0,-.066,.521),(.396,.315,.093),rings=11,count=32)
	profile=[(-.287,.458),(.287,.458)]
	for i in range(51):
		t=math.pi*i/50
		f=1+.028*math.cos(t*16)
		profile.append((.544*math.cos(t)*f,.589+.619*math.sin(t)*f))
	g.plate('berry',profile,(0,.275,0),.139,.077,front=True)
	for i in range(9):
		t=(i+1)*math.pi/10
		dx=.497*math.cos(t)
		z=.585+.582*math.sin(t)
		g.tube('rose',[(dx*.22,.190,.49,.042),(dx*.61,.178,.65+(z-.66)*.28,.064),
			(dx*.89,.185,.70+(z-.70)*.68,.073),(dx,.214,z,.049)],.06,count=14)
	g.hoop('cream',(0,-.066,.546),.775,.623,.011)
	g.seat('Concha',(0,-.064,.61))
	return g


def reading_chair():
	g=Model()
	feet(g,.625,.46,.349,'walnut')
	g.soft('plum',(0,0,.377),.91,.714,.182,.206)
	g.ellipsoid('lilac',(0,-.071,.464),(.384,.304,.093),rings=12,count=32)
	piping(g,'cream',.745,.557,.47,radius=.23)
	g.plate('plum',arch(.714,.373,.927,.23),(0,.253,0),.211,.075,front=True)
	g.plate('lilac',arch(.602,.493,.928,.167),(0,.137,0),.121,.068,front=True)
	for s in (-1,1):
		g.tube('plum',[(s*.323,.252,1.051,.072),(s*.363,.252,.779,.095),(s*.439,.052,.642,.086),
			(s*.427,-.293,.655,.073),(s*.368,-.338,.598,.058)],.09,divisions=5,count=20,ratio=.94)
		g.tube('brass',[(s*.421,-.315,.582),(s*.443,-.145,.570),(s*.404,.095,.622),(s*.374,.19,.86)],.008,count=8)
	g.ellipsoid('blush',(.125,.044,.652),(.148,.085,.129),tilt=-.37,rings=12,count=24)
	for i,z in enumerate((.70,.82,.94)):
		for x in (-.10,.09):
			g.ellipsoid('plum',(x,.065,z),(.013,.006,.013),rings=5,count=10)
	g.seat('Lectura',(0,-.05,.56))
	return g


def window_bench():
	g=Model()
	feet(g,1.31,.43,.39,'walnut')
	g.soft('oak',(0,0,.414),1.68,.65,.153,.179)
	g.soft('sage',(0,-.025,.501),1.56,.55,.127,.195)
	piping(g,'cream',1.50,.50,.499)
	for s in (-1,1):
		g.tube('oak',[(s*.66,.205,.407,.044),(s*.72,.196,.63,.046),(s*.733,.213,.799,.052),
			(s*.680,.218,.903,.046)],.046,count=14)
		g.tube('oak',[(s*.716,.20,.74,.046),(s*.768,-.05,.659,.05),(s*.755,-.275,.633,.043),
			(s*.69,-.31,.581,.044)],.046,count=13)
	g.tube('oak',[(-.70,.215,.865),(-.43,.235,.933),(0,.241,.972),(.43,.235,.933),(.70,.215,.865)],
		.045,count=16,divisions=4)
	for i in range(12):
		x=(i-5.5)*.111
		z=.939-.14*(x/.83)**2
		g.tube('maple',[(x,.207,.51),(x,.22,.69),(x,.238,z)],.018,count=8)
	for x,c in ((-.44,'indigo'),(.44,'blue')):
		g.ellipsoid(c,(x,.111,.684),(.157,.091,.139),tilt=x*.6,rings=11,count=24)
	g.seat('Banco_Izquierda',(-.393,-.045,.572))
	g.seat('Banco_Derecha',(.393,-.045,.572))
	return g


def wicker_chair():
	g=Model()
	g.lathe('walnut',[(0,.286),(.034,.344),(.071,.333),(.085,.296)],ratio=.81)
	g.tube('iron',[(.073,.139,.08,.035),(.282,.18,.410,.031),(.415,.204,.910,.026),
		(.29,.146,1.563,.025),(0,.049,1.709,.027)],.028,divisions=5,count=14)
	g.tube('brass',[(0,.05,1.715),(0,.012,1.567)],.017,count=8,divisions=1)
	# Open wicker sides curve around the seat, allowing the cushion to show.
	for j in range(16):
		t=-.15+(math.pi+.3)*j/15
		s,c=math.sin(t),math.cos(t)
		g.tube('oak' if j%3 else 'maple',[(c*.22,.019+s*.161,.471,.018),
			(c*.376,.043+s*.309,.743,.017),(c*.351,.075+s*.299,1.223,.017),
			(c*.088,.033+s*.058,1.516,.016),(0,.030,1.558,.013)],.018,count=8,divisions=4)
	for h,w,d in ((.49,.529,.47),(.597,.679,.558),(.711,.737,.582),(.85,.754,.594)):
		g.hoop('maple',(0,.057,h),w,d,.021,count=38)
	for h,r in ((.98,.36),(1.107,.346),(1.234,.309),(1.358,.25),(1.438,.169),(1.508,.097)):
		points=[(r*math.cos(t),.048+.83*r*math.sin(t),h) for t in [-.16+(math.pi+.32)*j/20 for j in range(21)]]
		g.tube('maple',points,.014,count=7,divisions=1)
	g.ellipsoid('teal',(0,-.048,.516),(.295,.221,.105),rings=11,count=28)
	g.ellipsoid('aqua',(0,.129,.700),(.205,.083,.154),rings=10,count=23)
	g.seat('Mimbre',(0,-.18,.615))
	return g


def linen_daybed():
	g=Model()
	feet(g,1.39,.48,.338,'oak')
	g.soft('walnut',(0,0,.395),1.82,.751,.166,.168)
	g.soft('cream',(0,-.003,.516),1.75,.708,.16,.157)
	piping(g,'clay',1.69,.65,.498,radius=.16)
	g.tube('oak',[(-.83,.232,.41),(-.85,.255,.652),(-.77,.251,.808),(-.25,.241,.829),(.374,.245,.800),
		(.81,.231,.749),(.837,.21,.473)],.038,divisions=4,count=14)
	for j in range(10):
		x=(j-4.5)*.171
		g.tube('oak',[(x,.222,.482),(x,.235,.662),(x,.246,.80-.045*(x+.20)**2)],.017,count=8)
	g.ellipsoid('aqua',(-.59,.111,.670),(.226,.119,.143),tilt=.09,rings=12,count=25)
	g.ellipsoid('rose',(-.337,.109,.634),(.153,.095,.115),tilt=.41,rings=12,count=24)
	sash=soft_rectangle(.439,.661,.079)
	g.plate('blue',sash,(.462,-.017,.601),.027,.023,yaw=-.064)
	g.plate('blue',soft_rectangle(.439,.184,.04),(.473,-.356,.519),.022,.018,front=True,yaw=-.064)
	for j in range(12):
		x=.26+j*.036
		g.tube('cream',[(x,-.38,.487),(x-.01,-.385,.428)],.0055,count=6,divisions=1)
	g.seat('Divan_Izquierda',(-.40,-.083,.605))
	g.seat('Divan_Derecha',(.38,-.083,.605))
	return g


def cabinet():
	g=Model()
	feet(g,.73,.40,.207)
	g.soft('walnut',(0,0,.478),1.13,.54,.598,.162)
	g.soft('oak',(0,0,.793),1.19,.574,.075,.171)
	for s in (-1,1):
		g.soft('woodcut',(s*.235,-.271,.458),.441,.489,.056,.119,front=True)
		for i in range(9):
			x=s*.235+(i-4)*.043
			y=-.306+.009*(abs(i-4)/4)**2
			r=.014 if 0<i<8 else .011
			g.tube('maple',[(x,y,.265),(x,y-.008,.452),(x,y,.650)],r,count=8,divisions=1)
		g.tube('brass',[(s*.07,-.324,.480),(s*.08,-.352,.527),(s*.113,-.327,.564)],.013,count=10)
	g.lathe('teal',[(.832,.087),(.857,.138),(.975,.132),(1.037,.096),(1.06,.058),(1.075,.071),
		(1.085,.063),(1.042,.052)],(.295,.057,0),ratio=.87,divisions=2)
	g.soft('sage',(-.229,.027,.846),.303,.195,.044,.022,yaw=.19,bevel=.009)
	g.soft('clay',(-.251,.017,.895),.277,.175,.043,.025,yaw=-.14,bevel=.009)
	return g


def books(g,left,front,z,n,seed):
	rng=random.Random(seed)
	x=left
	for i in range(n):
		w=rng.uniform(.060,.105)
		h=rng.uniform(.132,.247)
		color=('plum','blue','sage','clay','teal','honey')[i%6]
		g.soft(color,(x+w/2,front+.065,z+h*.50),w,.16,h,.016,bevel=.011)
		g.soft('porcelain',(x+w*.50,front+.069,z+h-.012),w*.76,.113,.008,.008,bevel=.004)
		for hh in (.027,h-.026):
			g.tube('brass',[(x+.012,front-.02,z+hh),(x+w-.012,front-.02,z+hh)],.0035,count=6,divisions=1)
		x+=w+.017


def arched_shelf():
	g=Model()
	feet(g,.57,.264,.16,'walnut')
	g.plate('woodcut',arch(.96,.13,1.28,.355),(0,.14,0),.133,.073,front=True)
	g.plate('teal',arch(.835,.24,1.265,.275),(0,.065,0),.043,.032,front=True)
	for x in (-.444,.444):
		g.tube('oak',[(x,-.192,.14,.048),(x,-.194,.725,.043),(x,-.194,1.287,.042)],.044,count=14,divisions=1)
	points=[(.443*math.cos(math.pi*i/32),-.196,1.282+.352*math.sin(math.pi*i/32)) for i in range(33)]
	g.tube('oak',points,.049,count=10,divisions=1)
	for row,z in enumerate((.263,.551,.853,1.156)):
		g.soft('oak',(0,-.027,z),.87,.34,.069,.068)
		books(g,-.374,-.157,z+.035,(6,4,5,3)[row],row+31)
		if row in (1,3):
			g.lathe('blush',[(0,.043),(.022,.074),(.120,.083),(.151,.056),(.162,.058),(.163,.040),(.128,.032)],
				(.263,-.05,z+.036),ratio=.90,divisions=2)
	return g


def wooden_table():
	g=Model()
	g.lathe('walnut',[(0,.199),(.032,.246),(.080,.231),(.113,.171),(.17,.109),
		(.298,.084),(.377,.105),(.457,.15),(.49,.177)],count=44,divisions=3)
	g.lathe('woodcut',[(.441,.145),(.453,.162),(.467,.161),(.475,.174)],count=44)
	g.lathe('oak',[(.475,.405),(.491,.439),(.515,.47),(.55,.47),(.58,.452),(.598,.428),(.60,.409)],count=64)
	return g


def tea_cart():
	g=Model()
	for s in (-1,1):
		for y in (-.222,.222):
			g.hoop('walnut',(s*.376,y,.125),.229,.243,.023,front=True,yaw=math.pi/2,count=28)
			g.ellipsoid('brass',(s*.398,y,.126),(.031,.034,.036),rings=8,count=14)
			for j in range(6):
				a=j*TAU/6
				g.tube('brass',[(s*.39,y,.125),(s*.39,y+.09*math.cos(a),.125+.095*math.sin(a))],
					.007,count=6,divisions=1)
			g.tube('brass',[(s*.343,y,.116),(s*.344,y,.385),(s*.322,y,.726)],.020,count=10)
	g.soft('teal',(0,0,.292),.787,.535,.083,.117)
	g.soft('sage',(0,0,.684),.810,.554,.103,.135)
	for z in (.332,.742):
		piping(g,'brass',.75,.491,z,radius=.12)
	g.tube('brass',[(.33,-.206,.691),(.459,-.208,.819),(.459,.213,.819),(.339,.216,.696)],.022,count=12)
	g.lathe('porcelain',[(.733,.107),(.756,.133),(.813,.143),(.864,.122),(.908,.088)],(-.16,-.01,0),ratio=.93,divisions=3)
	g.lathe('teal',[(.905,.098),(.931,.060),(.938,.041),(.967,.027)],(-.16,-.01,0),count=24,divisions=2)
	g.tube('porcelain',[(-.279,-.01,.808,.043),(-.35,-.018,.812,.036),
		(-.391,-.020,.881,.021),(-.401,-.018,.910,.015)],.035,count=11)
	g.tube('teal',[(-.052,-.011,.864),(.011,.010,.865),(.020,.019,.814),(-.038,.012,.784)],.017,count=9)
	for x,y in ((.120,-.083),(.248,.083)):
		g.lathe('porcelain',[(.734,.064),(.749,.095),(.768,.095),(.776,.071),(.803,.069),(.866,.079),(.871,.066),(.803,.055)],
			(x,y,0),count=28,divisions=2)
		g.tube('teal',[(x+.064,y,.846),(x+.103,y,.846),(x+.108,y,.808),(x+.063,y,.810)],.009,count=8)
	for i in range(4):
		g.lathe('aqua' if i%2 else 'porcelain',[(.346+i*.019,.117),(.359+i*.019,.129),(.369+i*.019,.111)],(.11,.0,0),count=26)
	return g


def upright_piano():
	g=Model()
	feet(g,.985,.315,.178,'walnut')
	g.plate('walnut',arch(1.38,.176,.958,.227),(0,.126,0),.455,.073,front=True)
	g.plate('woodcut',arch(1.24,.704,.962,.168),(0,-.115,0),.059,.048,front=True)
	g.plate('oak',arch(1.14,.746,.955,.137),(0,-.152,0),.029,.027,front=True)
	g.soft('walnut',(0,-.260,.660),1.335,.378,.124,.126)
	for i in range(19):
		x=(i-9)*.061
		g.soft('cream',(x,-.315,.733),.056,.219,.032,.012,bevel=.009)
		if i<18 and i%7 not in (2,6):
			g.soft('ink',(x+.027,-.259,.757),.035,.135,.036,.009,bevel=.008)
	for x in (-.61,.61):
		g.tube('walnut',[(x,-.334,.081,.051),(x,-.324,.354,.044),(x,-.31,.598,.061)],.047,count=11)
		g.ellipsoid('brass',(x,-.336,.058),(.066,.076,.045),rings=7,count=16)
	g.tube('brass',[(-.43,-.179,.821),(-.27,-.187,.841),(.27,-.187,.841),(.43,-.179,.821)],.0065,count=8)
	for x in (-.093,.002,.095):
		g.tube('brass',[(x,-.073,.186),(x,-.208,.104),(x,-.273,.101)],.022,count=9)
	return g


def floor_mirror():
	g=Model()
	for side in (-1,1):
		g.tube('oak',[(side*.258,-.176,.032,.039),(side*.292,.086,.102,.045),
			(side*.245,.205,.439,.039),(side*.229,.155,.636,.036)],.041,count=13)
	g.plate('walnut',oval(.335,.507),(0,.120,1.012),.11,.047,front=True)
	g.plate('silver',oval(.279,.455),(0,.050,1.012),.029,.024,front=True)
	g.hoop('brass',(0,.020,1.012),.601,.954,.024,front=True,count=52)
	for x,z in ((-.122,1.182),(.071,1.338)):
		g.tube('porcelain',[(x-.09,.030,z-.088),(x-.059,.024,z-.048),(x+.055,.025,z+.087)],.012,count=6)
	g.tube('oak',[(-.247,.155,.616),(.00,.166,.566),(.247,.155,.615)],.031,count=11)
	g.ellipsoid('woodcut',(0,.174,.46),(.13,.094,.09),rings=8,count=16)
	return g

