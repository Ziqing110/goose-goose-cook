"""Build standalone CSS-animated SVGs from the approved native posture redraws."""
from pathlib import Path
import xml.etree.ElementTree as ET
import copy
ROOT=Path(__file__).resolve().parents[1]
BASE=ROOT/'src/assets/goose-postures'
OUT=BASE/'animated'
OUT.mkdir(exist_ok=True)
ET.register_namespace('', 'http://www.w3.org/2000/svg')
N='{http://www.w3.org/2000/svg}'
CSS='''
.kp-animated-goose{color:var(--goose-ink,#171717)}
.goose-motion{transform-box:view-box;animation-timing-function:ease-in-out;animation-iteration-count:infinite;animation-play-state:var(--goose-play-state,running)}
@keyframes goose-stir{0%,100%{transform:rotate(-5deg)}50%{transform:rotate(5deg)}}
@keyframes goose-wave{0%,60%,100%{transform:rotate(0)}15%,40%{transform:rotate(-10deg)}27%{transform:rotate(4deg)}}
@keyframes goose-offer{0%,100%{transform:rotate(-4deg)}50%{transform:rotate(5deg)}}
@keyframes goose-breathe{0%,100%{transform:scaleY(1)}50%{transform:scaleY(1.025)}}
@keyframes goose-sleep{0%,100%{transform:scaleY(1)}50%{transform:scaleY(1.045)}}
@keyframes goose-hover{0%,100%{transform:translateY(0)}50%{transform:translateY(-4px)}}
@keyframes goose-nod{0%,100%{transform:rotate(0)}50%{transform:rotate(3deg)}}
@keyframes goose-talk{0%,40%,80%,100%{transform:rotate(0)}20%,60%{transform:rotate(-2.5deg)}}
@keyframes goose-beak{0%,35%,75%,100%{transform:scaleY(.65)}15%,55%{transform:scaleY(1)}}
@keyframes goose-call{0%,15%,35%,100%{transform:translateY(0)}8%,25%{transform:translateY(-2px)}}
@keyframes goose-sound{0%,38%,100%{opacity:0}7%,30%{opacity:1}}
@keyframes goose-blink{0%,43%,47%,100%{transform:scaleY(1)}45%{transform:scaleY(.08)}}
@media(prefers-reduced-motion:reduce){.goose-motion{animation:none!important}}
'''
def animate(parent, nodes, key, duration, origin):
 children=list(parent); pos=children.index(nodes[0]);g=ET.Element(N+'g',{'class':'goose-motion','style':f'transform-origin:{origin};animation-name:goose-{key};animation-duration:calc({duration}s * var(--goose-tempo,1))'})
 for node in nodes:parent.remove(node);g.append(node)
 parent.insert(pos,g)
 return g
order=['g1-on-it','g2-up-next','g4-free-hands','g3-waiting','g5-done-for-the-night','g6-up-for-grabs','g7-honk','g9-victory','toque-idle','toque-left','toque-right']
for name in order:
 root=ET.parse(BASE/'svg'/f'goose-{name}.svg').getroot()
 root.set('class','kp-animated-goose')
 # A self-contained default works through <img>; inline usage inherits custom colours.
 for e in root.iter():
  if e.get('fill')=='var(--kp-cook-a)':e.set('fill','var(--kp-cook-a,'+('#7C5CE0' if name.startswith('toque') else '#E58A1F')+')')
 parent=root if name!='toque-right' else list(root)[1]
 nodes=[e for e in list(parent) if e.tag!=N+'title']
 if name=='g1-on-it':animate(parent,nodes[10:13],'stir',1.6,'64px 126px')
 elif name=='g2-up-next':animate(parent,[nodes[3]],'wave',3.2,'97px 113px')
 elif name=='g4-free-hands':
  animate(parent,[nodes[3]],'offer',2.1,'110px 110px');animate(parent,[nodes[4]],'offer',2.1,'140px 117px')
 elif name=='g3-waiting':animate(parent,[nodes[2]],'breathe',4.2,'110px 160px')
 elif name=='g5-done-for-the-night':
  animate(parent,[nodes[0]],'sleep',3.6,'110px 177px');animate(parent,nodes[2:4],'breathe',3.6,'110px 177px')
 elif name=='g6-up-for-grabs':animate(parent,[nodes[9]],'hover',2.7,'80px 120px');animate(parent,nodes[3:6],'nod',3.7,'118px 108px')
 elif name=='g7-honk':
  animate(parent,nodes[3:6],'call',2.8,'115px 110px')
  nodes[8].set('d','M86 125Q77 142 85 151')
  lines=ET.SubElement(parent,N+'path',{'d':'M63 36l-9-7M61 50H48M63 65l-10 8','fill':'none'})
  animate(parent,[lines],'sound',2.8,'60px 50px')
 elif name=='g9-victory':
  animate(parent,[nodes[3]],'offer',3.8,'99px 117px');animate(parent,[nodes[4]],'offer',3.8,'137px 117px')
 elif name.startswith('toque'):
  if name=='toque-idle':animate(parent,[nodes[2]],'breathe',4,'110px 161px')
  else:
   head=nodes[3];beak=list(head)[1];animate(head,[beak],'beak',.8,'94px 56px')
   animate(parent,[head],'talk',1.6,'114px 126px')
 # Eyes blink as a separate subtle cue, without moving feet or the countertop.
 for par in list(root.iter()):
  for eye in list(par):
   if eye.tag==N+'circle' and eye.get('fill')=='#111111':animate(par,[eye],'blink',5.8,f'{eye.get("cx")}px {eye.get("cy")}px')
 style=ET.Element(N+'style');style.text=CSS;root.insert(1,style)
 (OUT/f'goose-{name}.svg').write_text(ET.tostring(root,encoding='unicode'))
labels=['认真炒菜','我下一个','我来帮忙','趴着等你','下班睡觉','试探着接活','Honk 提醒','安静庆祝','Toque 待命','Toque 向左说话','Toque 向右说话']
html='''<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>会动的厨房鹅</title><style>
*{box-sizing:border-box}body{margin:0;padding:32px;background:#f8f5ed;color:#242320;font:15px system-ui;--kp-cook-a:#E58A1F}main{max-width:1180px;margin:auto}h1{font-size:30px;margin:0 0 8px}p{color:#777268;line-height:1.7}header{position:sticky;top:0;background:inherit;padding:16px 0;z-index:2}.controls{display:flex;gap:12px;align-items:center;flex-wrap:wrap}button,select{border:1px solid #d7d0c4;background:#fff;border-radius:10px;padding:10px 16px;font:inherit;color:#242320}button{cursor:pointer}.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(230px,1fr));gap:16px;margin:24px 0}article{background:#fff;border:1px solid #e8e0d3;border-radius:18px;padding:18px}article .large svg{width:100%;height:190px}.sizes{display:flex;align-items:end;gap:18px;height:58px;border-top:1px solid #eee;padding-top:8px}.sizes svg{display:block}.sizes small{font-size:10px;color:#8e877d}h2{font-size:16px;margin:0}.agent{--kp-cook-a:#7C5CE0}body.dark{background:#262633;color:#f8f5ed}.dark article{background:#383845;border-color:#51505e}.dark p{color:#bdb9c5}.dark svg{filter:drop-shadow(0 0 1px #faf7ef)}a{color:inherit;font-size:12px}.meta{display:flex;justify-content:space-between;align-items:center;margin-top:14px}body.paused{--goose-play-state:paused}@media(max-width:520px){body{padding:16px}.grid{grid-template-columns:1fr 1fr;gap:8px}article{padding:10px}article .large svg{height:135px}.sizes{gap:8px}h2{font-size:14px}}
</style><body><main><header><h1>认真上班的小鹅们</h1><p>11 个循环动作 · 透明 SVG · 脚不乱跑，情绪都在脖子和翅膀上</p><div class="controls"><button id="play" aria-pressed="false">暂停动画</button><label>速度 <select id="speed"><option value="1.5">慢一点</option><option selected value="1">正常</option><option value="0.65">快一点</option></select></label><button id="color">换成 Mia 蓝</button><button id="theme">深色背景</button></div></header><div class="grid">'''
for name,label in zip(order,labels):
 s=(OUT/f'goose-{name}.svg').read_text();s=s[s.index('<svg'):]
 html+=f'<article class="{"agent" if name.startswith("toque") else "player"}"><h2>{label}</h2><div class="large">{s}</div><div class="sizes">'
 for size in [32,48]:html+=f'<div style="width:{size}px">'+s.replace('<svg ',f'<svg width="{size}" height="{size}" ')+f'<small>{size}px</small></div>'
 html+=f'</div><div class="meta"><small>{name}</small><a href="animated/goose-{name}.svg" download>下载 SVG</a></div></article>'
html+='''</div><p>网页直接使用 animated 文件夹里的 SVG 即可自动播放。需要切换角色、颜色或暂停时，使用附带的 React 组件。系统开启“减少动态效果”时显示静态姿态。</p></main><script>
const play=document.querySelector('#play');play.onclick=()=>{const p=document.body.classList.toggle('paused');play.textContent=p?'播放动画':'暂停动画';play.setAttribute('aria-pressed',String(p))};document.querySelector('#speed').onchange=e=>document.body.style.setProperty('--goose-tempo',e.target.value);let blue=false;document.querySelector('#color').onclick=e=>{blue=!blue;document.body.style.setProperty('--kp-cook-a',blue?'#458CCC':'#E58A1F');e.target.textContent=blue?'换成 Leo 橙':'换成 Mia 蓝'};document.querySelector('#theme').onclick=e=>{const dark=document.body.classList.toggle('dark');e.target.textContent=dark?'浅色背景':'深色背景'};
</script></body></html>'''
(BASE/'animated-preview.html').write_text(html)
print(f'Built {len(order)} standalone animated SVGs and preview.')
