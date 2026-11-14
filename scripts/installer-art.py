import math
from PIL import Image, ImageDraw, ImageFilter, ImageFont, ImageChops
# Regenerates the Windows installer artwork (NSIS) in the app's style:
#   src-tauri/installer/sidebar.bmp (164x314, Welcome / Finish pages)
#   src-tauri/installer/header.bmp  (150x57, top of the other pages)
# Run from the project root:  pip install pillow fonttools brotli
#                             python scripts/installer-art.py
import os
from fontTools.ttLib import TTFont
ROOT=os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ICON=os.path.join(ROOT,"src-tauri","icons","icon.png")
OUT=os.path.join(ROOT,"src-tauri","installer")
FONTS=os.path.join(ROOT,"node_modules","@fontsource","poppins","files")
TMP=os.path.join(OUT,".fonts"); os.makedirs(TMP,exist_ok=True)
for w in ("300","500","700"):  # Poppins (the app's font) from its woff2 files
    f=TTFont(os.path.join(FONTS,f"poppins-latin-{w}-normal.woff2")); f.flavor=None; f.save(os.path.join(TMP,f"poppins{w}.ttf"))
S=4  # supersampling
def font(w,size): return ImageFont.truetype(os.path.join(TMP,f"poppins{w}.ttf"), int(size*S))

def background(W,H, glow=True):
    img=Image.new("RGB",(W*S,H*S),(9,9,11))
    # vertical gradient
    top=(14,8,26); bot=(9,9,11)
    d=ImageDraw.Draw(img)
    for y in range(H*S):
        t=y/(H*S-1)
        c=tuple(int(top[i]+(bot[i]-top[i])*t) for i in range(3))
        d.line([(0,y),(W*S,y)],fill=c)
    if glow:
        g=Image.new("RGB",img.size,(0,0,0)); gd=ImageDraw.Draw(g)
        gd.ellipse([-W*S*0.6,-H*S*0.25,W*S*0.9,H*S*0.35],fill=(70,24,120))
        gd.ellipse([W*S*0.2,H*S*0.62,W*S*1.6,H*S*1.25],fill=(18,40,110))
        g=g.filter(ImageFilter.GaussianBlur(40*S))
        img=ImageChops.add(img,g)
    return img

def lines(img, W, H, y0, amp, count, spread, phase=0.0):
    """Flowing glowing lines (like the app's Floating Lines background)."""
    layer=Image.new("RGB",img.size,(0,0,0)); d=ImageDraw.Draw(layer)
    for k in range(count):
        t=k/max(1,count-1)
        col=(int(167+(59-167)*t), int(85+(130-85)*t), int(247+(246-247)*t))  # violet → blue
        pts=[]
        for xi in range(0,W*S+1,2):
            x=xi/S
            y=y0+k*spread+amp*math.sin(x/W*math.pi*1.6+phase+k*0.35)+amp*0.4*math.sin(x/W*math.pi*3.1+k)
            pts.append((xi,y*S))
        d.line(pts,fill=col,width=int(1.1*S))
    glow=layer.filter(ImageFilter.GaussianBlur(5*S))
    out=ImageChops.add(img,glow); out=ImageChops.add(out,glow)
    out=ImageChops.add(out,layer)
    return out

def paste_logo(img, cx, cy, size, glow=True):
    logo=Image.open(ICON).convert("RGBA").resize((int(size*S),int(size*S)),Image.LANCZOS)
    if glow:
        g=Image.new("RGB",img.size,(0,0,0)); gd=ImageDraw.Draw(g)
        r=size*S*0.75
        gd.ellipse([cx*S-r,cy*S-r,cx*S+r,cy*S+r],fill=(90,50,170))
        g=g.filter(ImageFilter.GaussianBlur(size*S*0.45))
        img=ImageChops.add(img,g)
    img.paste(logo,(int(cx*S-size*S/2),int(cy*S-size*S/2)),logo)
    return img

def text_center(img, y, parts, cx=None):
    d=ImageDraw.Draw(img)
    widths=[d.textlength(s,font=f) for s,f,_ in parts]
    total=sum(widths); x=(cx*S if cx is not None else img.width/2)-total/2
    for (s,f,c),w in zip(parts,widths):
        d.text((x,y*S),s,font=f,fill=c,anchor="ls"); x+=w
    return img

def tracked(img, y, s, f, col, track, cx=None):
    d=ImageDraw.Draw(img)
    ws=[d.textlength(ch,font=f) for ch in s]; total=sum(ws)+track*S*(len(s)-1)
    x=(cx*S if cx is not None else img.width/2)-total/2
    for ch,w in zip(s,ws):
        d.text((x,y*S),ch,font=f,fill=col,anchor="ls"); x+=w+track*S
    return img

# ---- Sidebar 164x314 (Welcome / Finish pages) ----
W,H=164,314
img=background(W,H)
img=lines(img,W,H,y0=212,amp=10,count=5,spread=5,phase=0.4)
img=paste_logo(img,W/2,86,58)
img=text_center(img,148,[("Flow ",font(300,17),(250,250,250)),("Downloader",font(700,17),(255,255,255))])
img=tracked(img,166,"DOWNLOAD ANYTHING",font(500,6.6),(196,190,215),1.1)
img=tracked(img,176,"ANYTIME IN 2 CLICKS",font(500,6.6),(196,190,215),1.1)
img=img.resize((W,H),Image.LANCZOS)
img.save(os.path.join(OUT,"sidebar.bmp"))

# ---- Header 150x57 (top of the other pages) ----
W,H=150,57
img=background(W,H)
img=lines(img,W,H,y0=50,amp=3,count=3,spread=2.5,phase=1.2)
img=paste_logo(img,24,28.5,30,glow=True)
d=ImageDraw.Draw(img)
d.text((46*S,26*S),"Flow",font=font(300,12.5),fill=(250,250,250),anchor="ls")
d.text((46*S,40*S),"Downloader",font=font(700,12.5),fill=(255,255,255),anchor="ls")
img=img.resize((W,H),Image.LANCZOS)
img.save(os.path.join(OUT,"header.bmp"))

import shutil; shutil.rmtree(TMP, ignore_errors=True)
print("installer art written to", OUT)
