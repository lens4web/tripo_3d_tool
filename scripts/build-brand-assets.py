"""Build site icons and the social preview using Pillow; not needed at runtime."""
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / 'assets'
OUT.mkdir(exist_ok=True)

def icon(size):
    scale = 8
    image = Image.new('RGBA', (size*scale, size*scale))
    d = ImageDraw.Draw(image)
    ratio = size * scale / 64
    def points(values): return [(round(x*ratio),round(y*ratio)) for x,y in values]
    d.rounded_rectangle((0,0,size*scale-1,size*scale-1),radius=17*ratio,fill='#1c4640')
    cube=[(32,13),(49,23),(49,42),(32,52),(15,42),(15,23)]
    d.polygon(points(cube),fill='#ecf1e6')
    d.polygon(points([(32,32),(49,23),(49,42),(32,52)]),fill='#e07850')
    d.line(points([(15,23),(32,32),(49,23)]),fill='#1c4640',width=round(2.5*ratio),joint='curve')
    d.line(points([(32,32),(32,52)]),fill='#1c4640',width=round(2.5*ratio))
    d.line(points(cube+[cube[0]]),fill='#ecf1e6',width=round(2*ratio),joint='curve')
    d.ellipse((29*ratio,29*ratio,35*ratio,35*ratio),fill='#1c4640')
    return image.resize((size,size),Image.Resampling.LANCZOS)

for size,name in [(180,'apple-touch-icon.png'),(192,'icon-192.png'),(512,'icon-512.png')]:
    icon(size).save(OUT/name)
icon(64).save(ROOT/'favicon.ico',sizes=[(16,16),(32,32),(48,48),(64,64)])

font_candidates=[Path('/System/Library/Fonts/Supplemental'),Path('/usr/share/fonts/truetype/dejavu')]
def font(size,bold=False):
    names=['Arial Bold.ttf','DejaVuSans-Bold.ttf'] if bold else ['Arial.ttf','DejaVuSans.ttf']
    for folder in font_candidates:
        for name in names:
            if (folder/name).exists(): return ImageFont.truetype(str(folder/name),size)
    return ImageFont.load_default(size=size)

image=Image.new('RGB',(1200,630),'#153a34')
d=ImageDraw.Draw(image)
for x in range(780,1250,52): d.line([(x,0),(x-270,630)],fill='#1b443b',width=1)
for y in range(90,750,55): d.line([(745,y),(1199,y-140)],fill='#1b443b',width=1)
image.paste(icon(64),(70,57),icon(64))
d.text((153,58),'LENS4WEB',font=font(21,True),fill='#eaf1e7')
d.text((153,90),'Personal tools. New possibilities.',font=font(15),fill='#92b1a0')
d.text((70,193),'Tripo 3D Tool',font=font(58,True),fill='#f3f6ef')
d.text((73,278),'Bring your character to life.',font=font(30),fill='#b9d2c1')
d.text((74,326),'Image to textured 3D, with your own Tripo API key.',font=font(18),fill='#a2c1af')
for x,label,width in [(72,'IMAGE',125),(237,'4 VIEWS',140),(417,'3D MODEL',164)]:
    d.rounded_rectangle((x,407,x+width,452),radius=9,fill='#244e42',outline='#426758',width=1)
    d.text((x+22,420),label,font=font(14,True),fill='#d4e7d8')
    if x < 400:
        d.line([(x+width+13,429),(x+width+29,429)],fill='#7d9f8b',width=2)
        d.line([(x+width+24,424),(x+width+29,429),(x+width+24,434)],fill='#7d9f8b',width=2)
d.text((74,552),'tripo3d.lens4web.com',font=font(19),fill='#a9c5b2')
cube=[(931,192),(1089,285),(1089,436),(931,528),(773,436),(773,285)]
d.polygon(cube,fill='#e9eedb')
d.polygon([(931,373),(1089,285),(1089,436),(931,528)],fill='#e07850')
d.polygon([(773,285),(931,373),(931,528),(773,436)],fill='#c9d7bc')
d.line([(773,285),(931,373),(1089,285)],fill='#153a34',width=7,joint='curve')
d.line([(931,373),(931,528)],fill='#153a34',width=7)
d.line(cube+[cube[0]],fill='#e9eedb',width=5,joint='curve')
d.ellipse((918,360,944,386),fill='#153a34')
image.save(OUT/'social-card.png',optimize=True)
