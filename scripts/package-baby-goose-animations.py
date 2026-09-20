"""Package generated white-background baby-goose animation strips for the web."""
from pathlib import Path
from PIL import Image,ImageDraw,ImageOps
import numpy as np,json,sys
ROOT=Path(__file__).resolve().parents[1];BASE=ROOT/'src/assets/baby-goose-final/animated';N=320
DUR={'g1-on-it':190,'g2-up-next':260,'g3-waiting':500,'g4-free-hands':300,'g5-done-for-the-night':550,'g6-eyeing-the-offer':350,'g7-due-honk':200,'g8-toque-neutral':500,'g8x-toque-speaking-left':180,'g9-victory':320,'g10-walking':150,'g11-handoff':340,'g12-behind-plan':300,'g13-listening':380,'g14-defeat-good-game':380}
selected=set(sys.argv[1:]);manifest=json.loads((BASE/'manifest.json').read_text()) if selected and (BASE/'manifest.json').exists() else {}
for source in sorted((BASE/'sources').glob('*.png')):
 name=source.stem
 if selected and name not in selected:continue
 im=Image.open(source).convert('RGB');a=np.array(im);h,w=a.shape[:2];ink=(a.min(axis=2)<170);col=ink.sum(axis=0);cuts=[0]
 for i in range(1,4):
  nominal=round(w*i/4);lo=round(nominal-w*.09);hi=round(nominal+w*.09);v=col[lo:hi];options=np.flatnonzero(v==v.min())+lo;cuts.append(int(options[np.argmin(abs(options-nominal))]))
 cuts.append(w);crops=[];anchors=[]
 for l,r in zip(cuts,cuts[1:]):
  cell=im.crop((l,0,r,h));a=np.array(cell);mask=a.min(axis=2)<170;ys,xs=np.where(mask)
  if not len(xs):raise ValueError(name+' empty frame')
  box=(max(0,int(xs.min())-3),max(0,int(ys.min())-3),min(cell.width,int(xs.max())+4),min(cell.height,int(ys.max())+4));cell=cell.crop(box);a=np.array(cell);hh,ww=a.shape[:2]
  orange=(a[:,:,0]>170)&(a[:,:,1]>35)&(a[:,:,1]<200)&(a[:,:,2]<110);orange[:int(hh*.75)]=False;oy,ox=np.where(orange)
  ax=float((ox.min()+ox.max())/2) if len(ox) and name!='g10-walking' else ww/2
  crops.append(cell);anchors.append(ax)
 left=max(anchors);right=max(c.width-x for c,x in zip(crops,anchors));height=max(c.height for c in crops);scale=min(280/(left+right),280/height);anchor=20+left*scale
 frames=[]
 for c,ax in zip(crops,anchors):
  c=c.resize((round(c.width*scale),round(c.height*scale)),Image.Resampling.LANCZOS);f=Image.new('RGB',(N,N),'white');f.paste(c,(round(anchor-ax*scale),300-c.height));frames.append(f)
 seq=[0,1,2,3] if name=='g10-walking' else [0,1,2,3,2,1];duration=DUR[name];outputs=[(name,frames)]
 if name=='g8x-toque-speaking-left':outputs.append(('g8y-toque-calling-right',[ImageOps.mirror(f) for f in frames]))
 for outname,ff in outputs:
  sequence=[ff[i] for i in seq];sequence[0].save(BASE/'webp'/f'goose-{outname}.webp',save_all=True,append_images=sequence[1:],duration=duration,loop=0,quality=92,method=4)
  ff[0].save(BASE/'posters'/f'goose-{outname}.png');sheet=Image.new('RGB',(N*len(seq),N),'white')
  for i,f in enumerate(sequence):sheet.paste(f,(i*N,0))
  sheet.save(BASE/'sprites'/f'goose-{outname}.png')
  manifest[outname]={'width':N,'height':N,'frames':len(seq),'frameDuration':duration,'duration':duration*len(seq),'webp':f'webp/goose-{outname}.webp','sprite':f'sprites/goose-{outname}.png','poster':f'posters/goose-{outname}.png','cuts':cuts}
(BASE/'manifest.json').write_text(json.dumps(manifest,indent=2))
qa=Image.new('RGB',(900,max(1,len(manifest))*160),'#ece8df');d=ImageDraw.Draw(qa)
for j,(name,m) in enumerate(manifest.items()):
 d.text((8,j*160+8),name,fill='black');sheet=Image.open(BASE/m['sprite'])
 for i in range(4):qa.paste(sheet.crop((i*N,0,(i+1)*N,N)).resize((140,140),Image.Resampling.LANCZOS),(260+i*155,j*160+15))
qa.save(BASE/'qa/contact.jpg');print('Packaged',len(manifest),'states')
