"""Original modular PelaCord clothing, authored in Blender for the chibi rig."""
import math

from mathutils import Vector

from organic import ellipsoid, line, loft
import toy


ITEMS = {
	'top_bomber': ('Campera bomber', 160),
	'top_varsity': ('Campera universitaria', 180),
	'top_raincoat': ('Piloto de lluvia', 200),
	'top_sailor': ('Remera marinera', 125),
	'top_puffer': ('Campera inflable', 220),
	'top_kimono': ('Chaqueta cruzada', 165),
	'top_pinafore': ('Vestido jardinero', 210),
	'bottom_cargo': ('Pantalón cargo', 160),
	'bottom_jogger': ('Jogger deportivo', 130),
	'bottom_flare': ('Pantalón oxford', 155),
	'bottom_culotte': ('Pantalón culotte', 145),
	'bottom_pleats': ('Pollera tableada', 145),
	'bottom_runner': ('Short de running', 100),
	'shoes_skate': ('Zapatillas de skate', 125),
	'shoes_high': ('Zapatillas de caña alta', 155),
	'shoes_runner': ('Zapatillas de running', 150),
	'shoes_hiker': ('Botas de montaña', 180),
	'shoes_rain': ('Botas de lluvia', 135),
	'shoes_maryjane': ('Merceditas', 135),
	'shoes_sandals': ('Sandalias', 110),
	'hat_knit': ('Gorro tejido con pompón', 140),
	'hat_cap': ('Gorra con visera', 125),
	'hat_bucket': ('Piluso', 150),
	'hat_beret': ('Boina', 145),
	'hat_sun': ('Sombrero de verano', 185),
	'hat_cat': ('Gorrito con orejas', 170),
	'facewear_round': ('Anteojos redondos', 100),
	'facewear_stars': ('Lentes de estrella', 150),
	'facewear_sun': ('Lentes de sol', 140),
	'facewear_goggles': ('Antiparras retro', 175),
	'facewear_bandage': ('Curita de corazón', 65),
	'back_daypack': ('Mochila de excursión', 185),
	'back_sling': ('Riñonera cruzada', 125),
	'back_satchel': ('Bolso de cartero', 165),
	'back_wings': ('Alitas de mariposa', 240),
}


def fabrics():
	return {
		'cream': toy.material('Ropa | Lona cruda', (.98, .89, .75), roughness=.89),
		'ink': toy.material('Ropa | Grafito', (.16, .17, .24), roughness=.78),
		'coral': toy.material('Ropa | Arcilla', (.86, .36, .32), roughness=.80),
		'mint': toy.material('Ropa | Verde salvia', (.42, .72, .63), roughness=.85),
		'gold': toy.material('Ropa | Latón', (.92, .68, .28), roughness=.45),
		'orange': toy.material('Ropa | Mandarina', (.99, .55, .25), roughness=.57),
		'suede': toy.material('Ropa | Cuero castaño', (.54, .31, .20), roughness=.91),
		'blue': toy.material('Ropa | Azul lago', (.25, .49, .65), roughness=.76),
		'lilac': toy.material('Ropa | Lavanda', (.68, .56, .83), roughness=.73),
		'rose': toy.material('Ropa | Rosa viejo', (.94, .63, .63), roughness=.75),
		'berry': toy.material('Ropa | Ciruela', (.47, .24, .39), roughness=.77),
	}


def box(name, center, size, color, radius=.016, angle=0):
	return toy.rounded_box(name, size=size, loc=center, rot=(0, math.radians(angle), 0),
		radius=radius, mat=color, segments=3)


def loop(name, center, width, height, thickness, color, sides=30):
	obj = toy.torus(name, 1, thickness / min(width, height), loc=center,
		rot=(math.pi / 2, 0, 0), mat=color, major_seg=sides, minor_seg=7)
	obj.scale = (width, height, min(width, height))
	return obj


def stitch_front(base, name, xz, color, radius=.008, gap=.033):
	def point(x, z):
		return x, base.front_y(x, z, -.128) - gap, z
	return line(name, [point(x, z) for x, z in xz], radius, color)


def torso_cuts(hem, sleeve, neck):
	return (
		lambda p: p.z - hem,
		lambda p: neck + min(.031, abs(p.x) * .25) - p.z,
		lambda p: sleeve - abs(p.x),
	)


def show_sleeves(mesh, accent, threshold=.48):
	index = len(mesh.data.materials)
	mesh.data.materials.append(accent)
	arms = {g.index for g in mesh.vertex_groups if g.name.startswith(('arm_', 'elbow_'))}
	weights = [sum(g.weight for g in v.groups if g.group in arms) for v in mesh.data.vertices]
	for face in mesh.data.polygons:
		if sum(weights[i] for i in face.vertices) / len(face.vertices) >= threshold:
			face.material_index = index


def tops(base, rig, kind, m, prefix, part, sewn, folded_skirt, accent):
	cream, gold, ink = (accent[key] for key in ('cream', 'gold', 'ink'))
	styles = (
		('bomber', .098, .162, .184, .041),
		('varsity', .097, .157, .190, .040),
		('raincoat', .080, .167, .191, .045),
		('sailor', .103, .098, .194, .027),
		('puffer', .095, .161, .192, .057),
		('kimono', .100, .138, .189, .042),
		('pinafore', .093, .096, .190, .030),
	)
	for key, hem, sleeve, neck, ease in styles:
		shell = sewn(base, key, kind, m['Top'], torso_cuts(hem, sleeve, neck), ease)
		pieces = [shell]

		def trim(name, points, color, radius=.008, gap=None, bone='spine'):
			pieces.append((stitch_front(base, name, points, color, radius, gap or ease + .003), bone))

		def pin(name, x, z, color, radius=.013):
			y = base.front_y(x, z, -.137) - ease - .009
			pieces.append((ellipsoid(name, (x, y, z), (radius, .008, radius), color, segments=12, rings=8), 'spine'))

		hides = None
		if key == 'bomber':
			trim('Metal zipper', [(0, .451), (0, .51), (0, .61), (0, .714)], gold, .011)
			trim('Rib knit collar', [(-.091, .714), (-.055, .693), (0, .681), (.055, .693), (.091, .714)], ink, .015)
			for s in (-1, 1):
				trim('Angled welt pocket', [(s*.060, .476), (s*.092, .494), (s*.120, .515)], ink, .012)
		elif key == 'varsity':
			show_sleeves(shell[0], cream)
			trim('Contrast placket', [(0, .447), (0, .51), (0, .62), (0, .703)], accent['coral'], .014)
			for z in (.49, .555, .62, .68):
				pin('Press stud', 0, z, cream, .010)
			trim('Letter patch', [(.041, .588), (.041, .649), (.079, .649), (.081, .621), (.044, .621)], cream, .009)
		elif key == 'raincoat':
			trim('Storm flap', [(-.024, .395), (-.039, .49), (-.039, .60), (-.024, .706)], accent['orange'], .022)
			for z in (.447, .514, .581, .648):
				pin('Raincoat snap', -.039, z, ink)
			for s in (-1, 1):
				trim('Rain pocket flap', [(s*.047, .467), (s*.079, .472), (s*.122, .482)], gold, .014)
			pieces.append((loft('Rain hood folded', [(.608, 0, .089, .11, .062), (.692, 0, .119, .164, .099),
				(.756, 0, .138, .139, .082), (.776, 0, .133, .058, .039)], accent['orange']), 'spine'))
		elif key == 'sailor':
			for z in (.478, .537, .594):
				trim('Nautical stripe', [(-.123, z+.012), (-.074, z), (0, z-.005), (.074, z), (.123, z+.012)], cream, .014)
			for s in (-1, 1):
				trim('Sailor collar', [(s*.096, .722), (s*.067, .68), (0, .626)], accent['blue'], .021)
		elif key == 'puffer':
			for z in (.473, .535, .594, .652):
				for s in (-1, 1):
					xs = (s * x for x in (.017, .042, .070, .099, .124))
					trim('Quilted seam', [(x, z + .57*x*x) for x in xs], accent['lilac'], .009, ease + .006)
			trim('Oversized zipper', [(0, .445), (0, .54), (0, .63), (0, .715)], cream, .010)
		elif key == 'kimono':
			trim('Wrap collar', [(-.094, .716), (-.048, .661), (.040, .585), (.100, .512)], cream, .020)
			trim('Under lapel', [(.092, .714), (.066, .672), (.009, .616)], cream, .018)
			trim('Woven sash', [(-.139, .487), (-.086, .477), (0, .477), (.093, .480), (.140, .495)], accent['berry'], .027)
			pieces.append((box('Sash knot', (.074, -.203, .483), (.062, .035, .041), accent['coral'], angle=-14), 'spine'))
		elif key == 'pinafore':
			hides = 'bottom'
			show_sleeves(shell[0], cream, threshold=.27)
			pieces.append((folded_skirt('Pinafore skirt', kind, m['Top'], lower=.179, upper=.483), 'hips'))
			for s in (-1, 1):
				trim('Bib strap', [(s*.054, .716), (s*.060, .644), (s*.058, .589)], accent['mint'], .021)
				pin('Overall buckle', s*.057, .598, gold, .015)
			pieces.append((box('Bib pocket', (0, -.215, .531), (.133, .035, .084), accent['mint'], .023), 'spine'))
		yield part(pieces, f'{prefix}Top_{key.title()}_{kind}', rig, 'top', kind, 'top_' + key, hides=hides)


def bottoms(base, rig, kind, m, prefix, part, sewn, accent):
	for key in ('cargo', 'jogger', 'flare', 'culotte', 'pleats', 'runner'):
		pieces = []
		if key == 'pleats':
			width = .285 if kind == 'F' else .27
			profile = [(.229, 0, -.005, width, .234), (.259, 0, -.012, width*1.01, .237),
				(.362, 0, -.012, .241, .221), (.469, 0, -.010, .211, .217)]
			pieces.append((loft('Deep pleated skirt', profile, m['Bottom'], segments=48, flutes=.128), 'hips'))
			pieces.append((loft('Contrast waistband', [(.441, 0, -.012, .225, .223),
				(.457, 0, -.012, .228, .226), (.474, 0, -.012, .220, .221)], accent['cream'], segments=32), 'hips'))
		else:
			cuff = {'cargo': .019, 'jogger': .026, 'flare': .014, 'culotte': .035, 'runner': .047}[key]

			def ease(p):
				if key == 'flare':
					return .024 + .059 * max(0, 1 - abs(p.z - .014) / .040) ** 2
				if key == 'culotte':
					return .029 + .043 * max(0, 1 - abs(p.z - .035) / .036)
				ease = {'cargo': .034, 'jogger': .025, 'runner': .032}[key]
				return .020 + (ease - .020) * min(1, max(0, (.115 - p.z) / .031))

			def hem(p):
				return p.z - cuff - (.011 * min(1, abs(p.x) / .072) if key == 'runner' else 0)

			pieces.append(sewn(base, key, kind, m['Bottom'], (hem, lambda p: .115 - p.z), ease))
			for s, side in ((-1, 'R'), (1, 'L')):
				if key == 'cargo':
					for name, center, size, color, radius in (
						('Cargo pouch', (s*.160, -.100, .292), (.083, .066, .093), accent['mint'], .019),
						('Cargo flap', (s*.164, -.136, .326), (.089, .022, .034), accent['ink'], .010),
						('Cargo snap', (s*.165, -.151, .321), (.019, .011, .018), accent['gold'], .005),
					):
						pieces.append((box(name, center, size, color, radius, s*8), 'leg_' + side))
				elif key in ('jogger', 'runner'):
					paths = [(s*.105, -.110, .32), (s*.119, -.128, .383), (s*.132, -.160, .431)]
					pieces.append((line('Sport piping', paths, .011, accent['cream']), 'leg_' + side))
					if key == 'jogger':
						x = s*.102
						pieces.append((loft('Ribbed ankle cuff', [(.128, x, .009, .075, .083),
							(.153, x, .009, .084, .089), (.168, x, .007, .077, .082)],
							accent['ink'], segments=20, flutes=.035), 'knee_' + side))
				elif key == 'culotte':
					pieces.append((line('Pressed pleat', [(s*.098, -.154, .249), (s*.102, -.176, .324),
						(s*.098, -.190, .403)], .007, accent['cream']), 'leg_' + side))
			if key in ('jogger', 'runner'):
				for s in (-1, 1):
					pieces.append((line('Waist drawcord', [(s*.017, -.224, .481), (s*.026, -.240, .448),
						(s*.046, -.230, .426)], .006, accent['cream']), 'hips'))
			elif key in ('flare', 'culotte'):
				pieces.append((box('Waist buckle', (0, -.220, .477), (.048, .021, .034), accent['gold'], .008), 'hips'))
		yield part(pieces, f'{prefix}Bottom_{key.title()}_{kind}', rig, 'bottom', kind, 'bottom_' + key)


def footwear(rig, m, prefix, part, accent):
	for key, heel, toe, height, sole in (
		('skate', .091, .138, .115, .033), ('high', .095, .133, .192, .039),
		('runner', .085, .144, .129, .053), ('hiker', .107, .128, .177, .060),
		('rain', .099, .123, .214, .041), ('maryjane', .087, .117, .124, .026),
		('sandals', .086, .112, .105, .030),
	):
		pieces = []
		for s, bone in ((-1, 'knee_R'), (1, 'knee_L')):
			x = s * .111

			def shoe(name, rows, color):
				pieces.append((loft(name, [(z, x, y, w, d) for z, y, w, d in rows], color, segments=24, detail=2), bone))

			def detail(name, loc, size, color, radius=.010, angle=0):
				pieces.append((box(name, (x+loc[0], loc[1], loc[2]), size, color, radius, angle), bone))

			sole_color = accent['ink'] if key in ('hiker', 'maryjane') else m['Sole']
			shoe('Outsole', [(.005, -.025, heel*.88, toe*.93), (.014, -.028, heel, toe),
				(sole, -.029, heel, toe), (sole+.007, -.029, heel*.90, toe*.96)], sole_color)
			if key == 'sandals':
				shoe('Cork footbed', [(sole, -.026, heel*.94, toe*.96), (sole+.010, -.026, heel, toe*.96),
					(sole+.018, -.026, heel*.94, toe*.91)], accent['suede'])
				for y, z in ((-.097, .065), (-.044, .098)):
					pieces.append((line('Cross straps', [(x-.073, y+.015, .039), (x-.035, y, z),
						(x+.022, y-.017, z+.020), (x+.072, y-.029, .042)], .019, m['Shoes']), bone))
				detail('Buckle', (s*.059, -.051, .081), (.026, .028, .025), accent['gold'])
				continue
			upper = accent['orange'] if key == 'rain' else m['Shoes']
			shoe('Shaped upper', [(sole-.005, -.029, heel*.91, toe*.94), (sole+.027, -.034, heel*.97, toe*.95),
				(.106, -.008, heel*.86, toe*.75), (height-.018, .006, heel*.82, toe*.64),
				(height, .008, heel*.79, toe*.59)] if height >= .139 else
				[(sole-.005, -.028, heel*.91, toe*.94), (sole+.023, -.034, heel*.96, toe*.96),
					(height-.012, .003, heel*.84, toe*.69), (height, .011, heel*.76, toe*.62)], upper)
			if key == 'skate':
				detail('Toe bumper', (0, -.119, .056), (.121, .051, .039), accent['cream'], .018)
				detail('Side canvas badge', (s*.078, -.040, .079), (.019, .077, .025), accent['berry'], angle=s*12)
			elif key == 'high':
				shoe('High rib collar', [(.160, .004, .077, .077), (.180, .007, .086, .084),
					(.197, .008, .079, .075)], accent['blue'])
				detail('Ankle badge', (s*.076, -.018, .145), (.015, .057, .041), accent['gold'], .007)
			elif key == 'runner':
				shoe('EVA midsole', [(.031, -.027, .083, .146), (.045, -.032, .091, .147),
					(.055, -.030, .083, .140)], accent['cream'])
				detail('Heel cage', (s*.069, .037, .075), (.043, .080, .058), accent['mint'], .017, s*12)
				detail('Reflector', (s*.075, -.050, .079), (.020, .079, .019), accent['orange'], .008)
			elif key == 'hiker':
				shoe('Padded boot collar', [(.150, .008, .090, .094), (.168, .012, .097, .093),
					(.189, .013, .084, .080)], accent['suede'])
				for y in (-.102, -.047, .010, .058):
					detail('Tread lug', (s*.070, y, .016), (.065, .040, .028), accent['ink'])
				detail('Rubber toe guard', (0, -.122, .081), (.138, .056, .053), accent['suede'], .020)
			elif key == 'rain':
				shoe('Wellington cuff', [(.185, .007, .078, .081), (.203, .008, .089, .092),
					(.221, .009, .080, .084)], accent['cream'])
				detail('Boot pull tab', (0, .084, .216), (.049, .024, .056), accent['coral'], .012)
				detail('Rubber patch', (s*.069, -.040, .165), (.020, .047, .036), accent['mint'])
			else:  # Mary Janes have a rounded toe and a single broad instep strap.
				detail('Instep strap', (0, -.069, .104), (.142, .037, .026), accent['berry'], .012, -s*8)
				detail('Dress shoe buckle', (s*.063, -.073, .112), (.032, .035, .025), accent['gold'])
			if key in ('skate', 'high', 'runner', 'hiker'):
				for i in range(3 if key in ('high', 'hiker') else 2):
					y = -.116 + i * .025
					z = .089 + i * (.020 if key in ('high', 'hiker') else .013)
					pieces.append((line('Lace', [(x-.041, y, z-.004), (x, y-.006, z+.008),
						(x+.041, y+.006, z-.001)], .0075, accent['cream']), bone))
		yield part(pieces, f'{prefix}Shoes_{key.title()}', rig, 'shoes', item='shoes_' + key)


def headwear(rig, prefix, part, accent):
	cream, ink, gold = (accent[key] for key in ('cream', 'ink', 'gold'))
	for key in ('knit', 'cap', 'bucket', 'beret', 'sun', 'cat'):
		pieces = []

		def section(name, rows, material, flutes=0):
			pieces.append(loft(name, [(z, x, y, rx, ry) for z, x, y, rx, ry in rows],
				material, segments=36, detail=2, flutes=flutes))

		if key == 'knit':
			section('Gathered knit crown', [(1.224, 0, .011, .338, .300), (1.326, 0, .027, .331, .280),
				(1.425, 0, .056, .238, .208), (1.487, 0, .066, .114, .102)], accent['berry'], .033)
			section('Folded rib cuff', [(1.199, 0, .008, .355, .321), (1.223, 0, .009, .368, .325),
				(1.282, 0, .015, .345, .309)], accent['lilac'], .025)
			pieces.append(ellipsoid('Pom pom', (0, .068, 1.512), (.091, .087, .075), cream))
		elif key == 'cap':
			section('Baseball crown', [(1.223, 0, .012, .351, .306), (1.309, 0, .027, .329, .282),
				(1.399, 0, .041, .251, .225), (1.450, 0, .045, .089, .094)], accent['blue'])
			pieces.append(ellipsoid('Curved peak', (0, -.229, 1.218), (.289, .267, .033), ink, segments=32))
			pieces.append(box('Woven front patch', (0, -.269, 1.322), (.102, .028, .065), cream, .020))
			pieces.append(ellipsoid('Covered button', (0, .043, 1.452), (.033, .030, .017), ink))
		elif key == 'bucket':
			section('Bucket crown', [(1.245, 0, .013, .346, .301), (1.348, 0, .023, .286, .255),
				(1.426, 0, .024, .254, .222), (1.443, 0, .024, .219, .185)], accent['mint'])
			section('Sloped bucket brim', [(1.177, 0, -.004, .416, .381), (1.201, 0, -.006, .423, .389),
				(1.256, 0, .006, .346, .305)], accent['mint'], .023)
			section('Bucket band', [(1.246, 0, .009, .354, .309), (1.266, 0, .010, .345, .306),
				(1.282, 0, .011, .329, .293)], cream)
		elif key == 'beret':
			section('Beret band', [(1.223, 0, .008, .342, .301), (1.255, 0, .014, .361, .316),
				(1.296, 0, .022, .353, .310)], ink)
			section('Soft tilted beret', [(1.257, -.020, .022, .352, .312), (1.305, -.051, .045, .401, .350),
				(1.381, -.068, .065, .355, .305), (1.441, -.095, .080, .173, .166),
				(1.459, -.118, .092, .055, .072)], accent['coral'])
			pieces.append(ellipsoid('Short beret stalk', (-.124, .091, 1.471), (.028, .027, .038), accent['coral']))
		elif key == 'sun':
			section('Wide straw brim', [(1.191, 0, -.014, .524, .478), (1.204, 0, -.015, .540, .484),
				(1.236, 0, .013, .350, .304)], cream, .027)
			section('Woven straw crown', [(1.227, 0, .010, .350, .305), (1.335, 0, .027, .297, .261),
				(1.428, 0, .038, .205, .201), (1.448, 0, .045, .104, .119)], accent['gold'], .014)
			section('Sunhat ribbon', [(1.238, 0, .010, .353, .310), (1.271, 0, .014, .337, .302),
				(1.296, 0, .020, .321, .285)], accent['coral'])
			for s in (-1, 1):
				pieces.append(box('Ribbon bow', (.220+s*.043, -.245, 1.267), (.101, .036, .056),
					accent['coral'], .019, s*20))
		else:
			section('Cat hood cap', [(1.204, 0, .010, .358, .323), (1.287, 0, .018, .360, .321),
				(1.395, 0, .029, .283, .268), (1.445, 0, .034, .162, .151)], accent['berry'])
			for s in (-1, 1):
				section('Rounded cat ear', [(1.350, s*.221, .040, .097, .077),
					(1.449, s*.247, .042, .076, .059), (1.555, s*.272, .047, .038, .038),
					(1.585, s*.274, .050, .010, .013)], accent['berry'])
				patch = ellipsoid('Inner ear', (s*.258, -.005, 1.477), (.039, .023, .065), accent['rose'])
				patch.rotation_euler.y = s * .18
				pieces.append(patch)
			pieces.append(box('Cat hood patch', (0, -.300, 1.259), (.097, .028, .036), gold, .015))
		for obj in pieces:
			toy.apply_transforms(obj)
			for vertex in obj.data.vertices:
				x, y, z = vertex.co
				vertex.co = Vector((x * 1.069, y * 1.093, z + .027))
		yield part([(obj, 'head') for obj in pieces], f'{prefix}Hat_{key.title()}', rig, 'hat', item='hat_' + key, hides='hair')


def facewear(rig, prefix, part, accent):
	for key, color, x, width, height in (
		('round', accent['suede'], .109, .081, .072), ('stars', accent['gold'], .115, .099, .088),
		('sun', accent['berry'], .112, .086, .065), ('goggles', accent['mint'], .115, .109, .083),
		('bandage', accent['rose'], .181, .061, .035),
	):
		pieces = []
		z, y = 1.080, -.352
		if key == 'bandage':
			base = box('Bandage', (x, -.291, .995), (.110, .025, .045), accent['cream'], .016, -18)
			base.rotation_euler.z = .49
			pieces.append(base)
			for off in (-.007, .007):
				pieces.append(ellipsoid('Heart lobes', (x+off, -.306+off*.45, 1.003), (.010, .006, .010), color))
			pieces.append(box('Heart point', (x, -.307, .996), (.018, .010, .018), color, .004, 45))
		else:
			for s in (-1, 1):
				if key == 'stars':
					points = []
					for i in range(11):
						a = math.pi / 2 + math.tau * i / 10
						r = 1 if i % 2 == 0 else .53
						points.append((s*x + width*r*math.cos(a), y, z + height*r*math.sin(a)))
					pieces.append(line('Star shaped rim', points, .011, color))
				else:
					pieces.append(loop('Glasses frame', (s*x, y, z), width, height, .014 if key == 'goggles' else .010, color))
				if key == 'sun':
					pieces.append(ellipsoid('Smoked lens', (s*x, y+.016, z), (width*.96, .015, height*.94), accent['ink']))
					pieces.append(line('Lens reflection', [(s*x-.039, y-.001, z+.022),
						(s*x-.028, y-.002, z+.034), (s*x-.014, y-.002, z+.041)], .005, accent['blue']))
				if key == 'goggles':
					pieces.append(loop('Inset goggle ring', (s*x, y-.012, z), width*.81, height*.80, .010, accent['gold']))
					pieces.append(box('Goggle side buckle', (s*.257, -.294, z), (.040, .047, .058), accent['ink'], .014))
				pieces.append(line('Temple', [(s*(x+width), y, z+.014),
					(s*.252, -.271, z+.018), (s*.302, -.164, z+.010)], .008, color))
			pieces.append(line('Bridge', [(-.041, y, z+.011), (0, y-.009, z+.023),
				(.041, y, z+.011)], .011, color))
		yield part([(obj, 'head') for obj in pieces], f'{prefix}Facewear_{key.title()}', rig,
			'facewear', item='facewear_' + key)


def bags(rig, prefix, part, accent):
	for key in ('daypack', 'sling', 'satchel', 'wings'):
		pieces = []
		if key == 'daypack':
			pieces.extend([
				box('Daypack shell', (0, .235, .562), (.292, .167, .320), accent['mint'], .059),
				box('Rounded front pouch', (0, .319, .499), (.210, .073, .127), accent['cream'], .034),
				box('Leather badge', (0, .323, .622), (.054, .023, .060), accent['suede'], .012, 45),
				line('Carry loop', [(-.050, .218, .698), (-.035, .240, .746), (.035, .240, .746), (.050, .218, .698)],
					.014, accent['cream']),
			])
			for s in (-1, 1):
				pieces.append(line('Padded shoulder strap', [(s*.118, .219, .664), (s*.098, .064, .761),
					(s*.093, -.126, .722), (s*.109, -.198, .632), (s*.127, -.196, .543),
					(s*.165, -.100, .472), (s*.136, .191, .456)], .017, accent['mint']))
		elif key == 'sling':
			pieces.extend([
				box('Crossbody sling', (.095, -.213, .550), (.215, .096, .139), accent['berry'], .044, -29),
				box('Sling zipper', (.088, -.260, .582), (.136, .012, .014), accent['gold'], .005, -29),
				line('Sling strap', [(-.111, .021, .751), (-.104, -.110, .697), (-.028, -.198, .618),
					(.079, -.213, .541), (.169, -.062, .483), (.074, .182, .514), (-.102, .158, .691),
					(-.111, .021, .751)], .019, accent['lilac']),
			])
		elif key == 'satchel':
			pieces.extend([
				box('Satchel body', (.133, .128, .452), (.218, .190, .194), accent['suede'], .042, 12),
				box('Satchel flap', (.133, .231, .491), (.223, .035, .122), accent['cream'], .022, 12),
				box('Flap closure', (.130, .252, .459), (.050, .018, .043), accent['gold'], .013, 12),
				line('Leather strap', [(-.108, .032, .748), (-.101, -.109, .678), (.015, -.185, .577),
					(.177, -.095, .465), (.204, .099, .464), (.088, .172, .549), (-.105, .154, .670),
					(-.108, .032, .748)], .016, accent['suede']),
			])
		else:
			for s in (-1, 1):
				for name, loc, radius, rotation, outer in (
					('Upper', (s*.235, .225, .649), (.141, .064, .205), s*-.52, accent['lilac']),
					('Lower', (s*.175, .242, .480), (.098, .053, .127), s*.42, accent['rose']),
				):
					wing = ellipsoid(name + ' wing', loc, radius, outer)
					wing.rotation_euler.y = rotation
					inlay = ellipsoid(name + ' wing velvet', (loc[0], .275, loc[2]),
						(radius[0]*.59, .030, radius[2]*.62), accent['cream'])
					inlay.rotation_euler.y = rotation
					pieces.extend([wing, inlay])
			pieces.append(box('Wing clasp', (0, .229, .584), (.112, .069, .099), accent['gold'], .031, 45))
		yield part([(obj, 'spine') for obj in pieces], f'{prefix}Back_{key.title()}', rig, 'back', item='back_' + key)


def accessories(rig, m, prefix, part, accent):
	return [*footwear(rig, m, prefix, part, accent), *headwear(rig, prefix, part, accent),
		*facewear(rig, prefix, part, accent), *bags(rig, prefix, part, accent)]
