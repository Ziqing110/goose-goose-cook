// Run against npm run dev. All API requests are mocked; existing sessions are untouched.
import { chromium } from 'playwright';
import assert from 'node:assert/strict';
const browser=await chromium.launch();
const page=await browser.newPage();
const errors=[];page.on('pageerror',e=>errors.push(e.message));
const graph={title:'Test dinner',servings:2,nodes:[{id:'dice',label:'Dice onion',difficulty:'low',estimated_duration_sec:120,depends_on:[],required_equipment:[],required_materials:[],phase:'prep'}]};
const session={id:'countdown-qa',status:'active',kitchenProfileId:'qa',conversation:{complete:true,answers:{cooks:2},transcript:[],understanding:{}},recipes:[{id:'recipe',working:graph,draft:graph,approved:graph}],sharedSteps:[],cooks:[{id:'a',name:'Mia',bound:true},{id:'b',name:'Leo',bound:true}],mode:'competition',run:null,nodePositions:{},outMaterialIds:[]};
let writes=[];
await page.route('http://localhost:5173/api/**',async route=>{
 const req=route.request();const url=new URL(req.url());let data;
 if(req.method()==='GET')data=url.pathname==='/api/kitchens'?[{id:'qa',name:'QA kitchen',stoveBurners:2,cuttingBoards:2,pots:2,hasWok:true}]:url.searchParams.get('status')==='active'?[session]:[];
 else {const patch=req.postDataJSON();if(url.pathname==='/api/sessions/countdown-qa'){Object.assign(session,patch); if(patch.run)writes.push(patch.run);} data=session;}
 await route.fulfill({json:data});
});
await page.goto('http://localhost:5173/session/schedule');

await page.getByRole('button',{name:/Go live/}).click({timeout:3000});
assert(await page.getByRole('dialog').isVisible());
await page.waitForTimeout(1600);
assert.equal(session.run,null);
await page.getByRole('button',{name:/Back to plan/}).click();
await page.waitForTimeout(2500);
assert.equal(session.run,null);
const before=Date.now();

await page.getByRole('button',{name:/Go live/}).click({timeout:3000});
await page.waitForURL('**/session/live-cook');
assert(Date.parse(session.run.startedAt)-before>=3600);
assert.equal(await page.getByRole('dialog').count(),0);
const started=session.run.startedAt;
await page.goto('http://localhost:5173/session/schedule');
await page.getByRole('button',{name:/Back to the cook/}).click();
assert.equal(await page.getByRole('dialog').count(),0);
assert.equal(session.run.startedAt,started);
session.run=null;session.mode='cooperation';
await page.goto('http://localhost:5173/session/schedule');

await page.getByRole('button',{name:/Go live/}).click({timeout:3000});
await page.waitForURL('**/session/live-cook');
assert.equal(await page.getByRole('dialog').count(),0);
assert.deepEqual(errors,[]);
console.log('PASS actual Schedule → Live Cook routes (mock API): no run during countdown/cancel, timer starts after opening, resume skips countdown, co-op unchanged.');
await browser.close();
