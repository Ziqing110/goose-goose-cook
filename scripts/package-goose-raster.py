"""Crop, register and package generated raster animation frames; no vector redraw."""
from pathlib import Path
from PIL import Image,ImageChops,ImageDraw
import numpy as np,json,sys
ROOT=Path(__file__).resolve().parents[1]
BASE=ROOT/'src/assets/goose-postures/raster-animated'
N=320
DUR={'g1-on-it':200,'g2-up-next':240,'g3-waiting':420,'g4-free-hands':230,'g5-done-for-the-night':520,'g6-up-for-grabs':300,'g7-honk':180,'g9-victory':330,'toque-idle':440,'toque-left':160,'toque-right':160}
selected=set(sys.argv[1:])
manifest=json.loads((BASE/'manifest.json').read_text()) if selected and (BASE/'manifest.json').exists() else {}
for source in sorted((BASE/'sources').glob('*.png')):
 if selected and source.stem not in selected:continue
 name=source.stem;im=Image.open(source).convert('RGBA');a=np.array(im);h,w=a.shape[:2]
 if a[:,:,3].min()!=0:raise ValueError(f'{name}: no transparency')
 col=(a[:,:,3]>48).sum(axis=0);cuts=[0]
 for i in range(1,4):
  nominal=round(w*i/4);lo=round(nominal-w/10);hi=round(nominal+w/10)
  values=col[lo:hi];mn=values.min();candidates=np.flatnonzero(values==mn)+lo
  cut=int(candidates[np.argmin(abs(candidates-nominal))]);cuts.append(cut)
 cuts.append(w)
 crops=[];anchors=[]
 for l,r in zip(cuts,cuts[1:]):
  cell=im.crop((l,0,r,h));alpha=cell.getchannel('A');bbox=alpha.point(lambda v:255 if v>48 else 0).getbbox()
  if not bbox:raise ValueError(name)
  cell=cell.crop(bbox);px=np.array(cell);hh,ww=px.shape[:2]
  orange=(px[:,:,0]>170)&(px[:,:,1]>35)&(px[:,:,1]<190)&(px[:,:,2]<100)&(px[:,:,3]>128)
  orange[:int(hh*.72)]=False;ys,xs=np.where(orange)
  anchor=(float((xs.min()+xs.max())/2) if len(xs) else ww/2,hh)
  crops.append(cell);anchors.append(anchor)
 # Shared scale per strip, common foot anchor; no frame-specific stretching.
 left=max(x for x,y in anchors);right=max(c.width-x for c,(x,y) in zip(crops,anchors));height=max(c.height for c in crops)
 scale=min(280/(left+right),280/height);anchorx=20+left*scale
 frames=[]
 for c,(ax,ay) in zip(crops,anchors):
  c=c.resize((round(c.width*scale),round(c.height*scale)),Image.Resampling.LANCZOS)
  frame=Image.new('RGBA',(N,N));frame.alpha_composite(c,(round(anchorx-ax*scale),300-c.height));frames.append(frame)
 # Ping-pong sequence avoids a hard last-to-first jump.
 sequence=[frames[i] for i in [0,1,2,3,2,1]];duration=DUR.get(name,250)
 sequence[0].save(BASE/'webp'/f'goose-{name}.webp',save_all=True,append_images=sequence[1:],duration=duration,loop=0,lossless=True,method=6)
 frames[0].save(BASE/'posters'/f'goose-{name}.png')
 sheet=Image.new('RGBA',(N*6,N))
 for i,f in enumerate(sequence):sheet.alpha_composite(f,(i*N,0))
 sheet.save(BASE/'sprites'/f'goose-{name}.png')
 manifest[name]={'width':N,'height':N,'frames':6,'duration':duration*6,'frameDuration':duration,'webp':f'webp/goose-{name}.webp','sprite':f'sprites/goose-{name}.png','poster':f'posters/goose-{name}.png','cuts':cuts,'alpha':list(im.getchannel('A').getextrema())}
(BASE/'manifest.json').write_text(json.dumps(manifest,indent=2))
# Contact sheet of actual output frames, one state per row.
qa=Image.new('RGB',(1040,max(1,len(manifest))*190),'#eee9df');draw=ImageDraw.Draw(qa)
for j,(name,m) in enumerate(manifest.items()):
 draw.text((10,j*190+6),name,fill='#222222');sheet=Image.open(BASE/m['sprite'])
 for i in range(4):
  frame=sheet.crop((i*N,0,(i+1)*N,N)).resize((160,160),Image.Resampling.LANCZOS)
  qa.paste(frame,(200+i*195,j*190+22),frame)
qa.save(BASE/'qa'/'contact.jpg')
print(f'Packaged {len(manifest)} states')
