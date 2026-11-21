"""Une varias vistas previas en una sola imagen: python contact_sheet.py salida.png a.png b.png ..."""
import sys
from PIL import Image

out, *files = sys.argv[1:]
images = [Image.open(f).convert('RGB') for f in files]
cols = min(3, len(images))
rows = (len(images) + cols - 1) // cols
w = max(i.width for i in images); h = max(i.height for i in images)
sheet = Image.new('RGB', (cols * w, rows * h), (20, 14, 34))
for n, img in enumerate(images):
    sheet.paste(img, ((n % cols) * w, (n // cols) * h))
sheet.thumbnail((1500, 1500))
sheet.save(out)
print(out, sheet.size)
