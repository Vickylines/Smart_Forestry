import {chromium} from 'playwright';
import assert from 'node:assert/strict';
import {mkdir} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
const base=process.env.APP_URL||'http://127.0.0.1:6185/';
const browser=await chromium.launch({headless:true,channel:'chrome'});
const out=fileURLToPath(new URL('../../../.preview/beta4/',import.meta.url));await mkdir(out,{recursive:true});
const plant={id:64350,name:'Ginkgo biloba',matched_term:'银杏',preferred_common_name:'银杏',is_active:true,rank:'species',iconic_taxon_name:'Plantae',ancestors:[{rank:'family',name:'Ginkgoaceae',preferred_common_name:'银杏科'},{rank:'genus',name:'Ginkgo',preferred_common_name:'银杏属'}]};
const candidate={name:'银杏',scientificName:'',score:0.96};
const record={id:'o1',projectId:'p1',isDemo:false,createdAt:new Date().toISOString(),photos:[{id:'photo',uri:'/static/leaf-1.svg',name:'1.jpg',bytes:1}],candidates:[candidate],recognitionPhotos:{photo:{provider:'baidu-plant',recognizedAt:new Date().toISOString(),candidates:[candidate]}},recognitionStatus:'succeeded',reviewStatus:'pending',confirmedName:'',confirmedScientificName:'',confirmedFamily:'',confirmedGenus:'',note:'',revision:0,reviews:[]};
const seed={schemaVersion:1,projects:[{id:'p1',name:'全球科属补查',location:'',createdAt:record.createdAt,isDemo:false}],observations:[record],jobs:[]};
const field=(page,id)=>page.locator(`[data-testid="${id}"] input`);
const stored=page=>page.evaluate(()=>JSON.parse(localStorage.getItem('forest-observer:state:v1')));
async function run(name,fn){
 const context=await browser.newContext({viewport:{width:390,height:844}}),page=await context.newPage();
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 try{await fn(context,page);assert.deepEqual(errors,[]);console.log('PASS '+name);}
 finally{await context.close();}
}
async function prepare(context,data=seed,{delay=0,offline=false}={}){
 const calls=[];
 await context.addInitScript(value=>{localStorage.setItem('forest-observer:state:v1',JSON.stringify(value));},data);
 await context.route(/https:\/\/(api\.inaturalist\.org|api\.gbif\.org|www\.wikidata\.org)\//,async route=>{
  const url=new URL(route.request().url());calls.push(url);
  if(offline){await route.abort();return;}
  if(url.pathname.includes('autocomplete')){await route.fulfill({json:{total_results:1,results:[plant]}});return;}
  if(delay)await new Promise(r=>setTimeout(r,delay));
  await route.fulfill({json:{results:[plant]}});
 });
 return calls;
}
try{
 await run('旧记录自动补查、草稿同步和复核导出',async(context,page)=>{
  const calls=await prepare(context);await page.goto(base+'#/pages/observation/index?id=o1');
  await page.locator('[data-testid="candidate-taxonomy"]').filter({hasText:'银杏科'}).waitFor();
  assert.equal(await field(page,'review-family').inputValue(),'银杏科');assert.equal(await field(page,'review-genus').inputValue(),'银杏属');
  assert.equal(await field(page,'review-scientific-name').inputValue(),'Ginkgo biloba');
  await page.locator('[data-testid="save-review"]').click();
  await page.getByText('复核已保存',{exact:true}).waitFor();
  const data=await stored(page);assert.equal(data.observations[0].confirmedFamily,'银杏科');assert.equal(data.observations[0].recognitionPhotos.photo.candidates[0].genus,'银杏属');assert.equal(calls.length,2);
  await page.screenshot({path:out+'taxonomy-normal.png'});
  assert.equal(await page.evaluate(()=>getComputedStyle(document.documentElement).fontSize),'16px');
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
 });
 await run('补查返回时保留用户正在编辑的科属',async(context,page)=>{
  await prepare(context,seed,{delay:1500});await page.goto(base+'#/pages/observation/index?id=o1');
  await field(page,'review-family').fill('手填科');
  await page.locator('[data-testid="candidate-taxonomy"]').filter({hasText:'银杏科'}).waitFor();
  assert.equal(await field(page,'review-family').inputValue(),'手填科');assert.equal(await field(page,'review-genus').inputValue(),'');
 });
 await run('已确认留空不被后台补查覆盖',async(context,page)=>{
  await prepare(context,{...seed,observations:[{...record,reviewStatus:'confirmed',confirmedName:'银杏',confirmedFamily:'手填科',confirmedGenus:'',revision:1}]});
  await page.goto(base+'#/pages/observation/index?id=o1');await page.locator('[data-testid="candidate-taxonomy"]').filter({hasText:'银杏科'}).waitFor();
  assert.equal(await field(page,'review-family').inputValue(),'手填科');assert.equal(await field(page,'review-genus').inputValue(),'');
  assert.equal((await stored(page)).observations[0].confirmedGenus,'');
 });
 await run('异步补查不将暂未确定改成确认名称',async(context,page)=>{
  await prepare(context,seed,{delay:1200});await page.goto(base+'#/pages/observation/index?id=o1');
  await page.locator('[data-testid="decision-unknown"]').click();
  await page.locator('[data-testid="candidate-taxonomy"]').filter({hasText:'银杏科'}).waitFor();
  assert.equal(await page.locator('[data-testid="decision-unknown"]').getAttribute('aria-pressed'),'true');
  await page.locator('[data-testid="save-review"]').click();await page.getByText('复核已保存',{exact:true}).waitFor();
  assert.equal((await stored(page)).observations[0].reviewStatus,'undetermined');
 });
 await run('离线不丢识别结果、不重复识别、允许人工填写',async(context,page)=>{
  await prepare(context,seed,{offline:true});await page.goto(base+'#/pages/observation/index?id=o1');
  await page.getByText('分类库暂不可用，可稍后重试',{exact:true}).waitFor();
  const data=await stored(page);assert.equal(data.observations[0].recognitionStatus,'succeeded');assert.equal(data.observations[0].recognitionPhotos.photo.provider,'baidu-plant');
  await field(page,'review-family').fill('银杏科');await field(page,'review-genus').fill('银杏属');await page.locator('[data-testid="save-review"]').click();
  await page.getByText('复核已保存',{exact:true}).waitFor();assert.equal((await stored(page)).observations[0].confirmedGenus,'银杏属');
 });
 await run('批量补查跨记录复用名称缓存',async(context,page)=>{
  const calls=await prepare(context,{...seed,observations:[record,{...record,id:'o2'}]});
  await page.goto(base+'#/pages/project/index?id=p1');await page.locator('[data-testid="fill-project-taxonomy"]').click();
  await page.getByText('补查结束，请在记录中核对结果',{exact:true}).waitFor();
  const data=await stored(page);assert.ok(data.observations.every(o=>o.candidates[0].genus==='银杏属'));assert.equal(calls.length,2);
 });
}finally{await browser.close();}
