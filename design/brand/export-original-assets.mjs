// Export-only: preserve the selected raster artwork; never redraw its contours.
import { chromium } from 'playwright';
import { mkdir, readFile, writeFile, copyFile } from 'node:fs/promises';
const root = new URL('../../',import.meta.url);
const out = new URL('exports/goose-original-assets/',root);
await mkdir(out,{recursive:true});
const source = new URL('design/goose-goose-cook-logo-options/chef-goose-baguette-doodle-v2.png',root);
await copyFile(source,new URL('L-lockup-original.png',out));
const browser=await chromium.launch({headless:true});
const page=await browser.newPage();
const uri='data:image/png;base64,'+(await readFile(source)).toString('base64');
const assets=await page.evaluate(async uri=>{
  const img=new Image();img.src=uri;await img.decode();
  const canvas=(w,h)=>Object.assign(document.createElement('canvas'),{width:w,height:h});
  const original=canvas(img.width,img.height);original.getContext('2d').drawImage(img,0,0);
  const crop=(x,y,w,h)=>{const c=canvas(w,h);c.getContext('2d').drawImage(img,x,y,w,h,0,0,w,h);return c;};
  const mark=crop(410,230,310,820);
  const letters=crop(174,1070,780,100);
  const transparent=c=>{
    const result=canvas(c.width,c.height),ctx=result.getContext('2d');ctx.drawImage(c,0,0);
    const pixels=ctx.getImageData(0,0,c.width,c.height);
    for(let i=0;i<pixels.data.length;i+=4){
      const gray=(pixels.data[i]+pixels.data[i+1]+pixels.data[i+2])/3;
      pixels.data[i+3]=gray>=245?0:Math.round(255-gray);
      pixels.data[i]=pixels.data[i+1]=pixels.data[i+2]=0;
    }
    ctx.putImageData(pixels,0,0);return result;
  };
  const m=transparent(mark),l=transparent(original),word=transparent(letters);
  const og=canvas(1200,630),ctx=og.getContext('2d');ctx.fillStyle='#fff';ctx.fillRect(0,0,1200,630);
  ctx.drawImage(m,115,55,310*520/820,520);
  ctx.drawImage(word,390,266,740,100*740/780);
  const exports={};
  for(const [name,c] of [['M-mark-transparent',m],['L-lockup-transparent',l],['OG-horizontal',og]]){
    for(const [ext,mime] of [['png','image/png'],['webp','image/webp']]) exports[`${name}.${ext}`]=c.toDataURL(mime,1).split(',')[1];
  }
  return exports;
},uri);
for(const [name,data] of Object.entries(assets)) await writeFile(new URL(name,out),Buffer.from(data,'base64'));
// S Light exports preserve the existing, explicitly requested head artwork.
for(const size of [16,28,32,48,64]){
  await copyFile(new URL(`design/brand/qa/head-${size}-light.png`,root),new URL(`S-light-${size}.png`,out));
  const svg=await readFile(new URL(`design/brand/${size===16?'goose-head-16':'goose-head'}.svg`,root));
  await page.setViewportSize({width:size,height:size});
  await page.emulateMedia({colorScheme:'light'});
  await page.setContent(`<style>html,body{margin:0;background:transparent}img{display:block;width:${size}px;height:${size}px}</style><img src="data:image/svg+xml;base64,${svg.toString('base64')}">`);
  await page.locator('img').evaluate(img=>img.decode());
  await page.screenshot({path:new URL(`S-light-${size}-transparent.png`,out).pathname,omitBackground:true});
}
await browser.close();
console.log(out.pathname);
