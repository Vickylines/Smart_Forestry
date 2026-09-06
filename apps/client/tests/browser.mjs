import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
const base = process.env.APP_URL || 'http://127.0.0.1:5174/';
const output = fileURLToPath(new URL('../../../.preview/beta1/', import.meta.url));
await mkdir(output,{recursive:true});
const browser = await chromium.launch({headless:true,channel:'chrome'});
const page = await browser.newPage({viewport:{width:390,height:844}});
const errors=[], external=[];
page.on('pageerror',e=>errors.push(e.message));
page.on('request',r=>{if(/^https?:/.test(r.url()) && new URL(r.url()).origin!==new URL(base).origin)external.push(r.url());});
const byId=id=>page.locator('[data-testid="'+id+'"]');
const field=id=>byId(id).locator('input');
const shot=async name=>{await page.screenshot({path:output+name+'.png',fullPage:true});};
const state=()=>page.evaluate(()=>{const raw=JSON.parse(localStorage.getItem('forest-observer:state:v1'));const v=raw?.data??raw;return typeof v==='string'?JSON.parse(v):v;});
const photoCount=()=>page.evaluate(()=>new Promise((resolve,reject)=>{const r=indexedDB.open('forest-observer-photos',1);r.onsuccess=()=>{const db=r.result;const q=db.transaction('photos').objectStore('photos').count();q.onsuccess=()=>{resolve(q.result);db.close();};q.onerror=reject;};r.onerror=reject;}));
async function layout(name) {
  for(const width of [320,390,1100]) {
    await page.setViewportSize({width,height:844});
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1),false,name+' layout '+width);
  }
  await page.setViewportSize({width:390,height:844});
  await shot(name);
  const css=await page.addStyleTag({content:'html {font-size:200%!important;}'});
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1),false,name+' 200% text');
  await shot(name+'-large-text');
  await css.evaluate(e=>e.remove());
}
async function tab(name){await page.locator('uni-tabbar').getByText(name,{exact:true}).click();}
try {
  await page.goto(base);await byId('empty-projects').waitFor();
  assert.ok(!(await page.locator('body').innerText()).includes('示例'));
  await layout('home-empty');
  await byId('new-project').focus();await page.keyboard.press('Enter');await byId('project-form').waitFor();
  await byId('project-form').getByText('取消',{exact:true}).click();assert.equal(await byId('project-form').count(),0);
  await byId('new-project').click();await byId('create-project').click();await page.getByText('请填写项目名称',{exact:true}).waitFor();
  await field('project-name').fill('公园植物调查');await field('project-location').fill('中心公园');
  await byId('create-project').click();await byId('add-observation').waitFor();
  const projectUrl=page.url();
  await byId('add-observation').click();await byId('choose-photos').waitFor();
  assert.equal(await byId('load-examples').count(),0);
  assert.equal(await byId('save-observations').getAttribute('tabindex'),'-1');
  await byId('save-observations').dispatchEvent('keydown',{key:'Enter'});
  assert.equal(await byId('capture-error').count(),0);
  const fixture=await page.screenshot({clip:{x:0,y:0,width:64,height:64}});
  const chooser=page.waitForEvent('filechooser');await byId('choose-photos').click();
  await (await chooser).setFiles({name:'test-photo.png',mimeType:'image/png',buffer:fixture});
  await page.getByText('已选 1 张',{exact:true}).waitFor();await layout('capture');
  await byId('capture-note').locator('textarea').fill('叶缘有锯齿');
  await byId('save-observations').click();await byId('start-recognition').waitFor();
  let s=await state();assert.equal(s.projects.length,1);assert.equal(s.observations.length,1);
  assert.deepEqual(s.observations[0].candidates,[]);assert.equal(s.observations[0].note,'叶缘有锯齿');
  assert.equal(await photoCount(),1);
  await layout('tasks');
  await byId('job-open-project').click();await page.locator('[data-testid^="observation-obs-"]').click();
  await field('review-name').fill('人工核对名称');
  await field('review-scientific-name').fill('Example taxon');
  await byId('save-review').click();await byId('review-status').getByText('已确认',{exact:true}).waitFor();
  await page.reload();await field('review-name').waitFor();await page.waitForFunction(()=>document.querySelector('[data-testid="review-name"] input')?.value==='人工核对名称');assert.equal(await field('review-name').inputValue(),'人工核对名称');
  await page.locator('.detail-photo .photo-image').waitFor();await layout('review');
  await page.goto(projectUrl);await byId('filter-confirmed').click();
  assert.equal(await page.locator('[data-testid^="observation-obs-"]').count(),1);
  await layout('project');
  const downloadReady=page.waitForEvent('download');await byId('export-csv').click();
  const chunks=[];for await(const c of await (await downloadReady).createReadStream())chunks.push(c);
  const csv=Buffer.concat(chunks).toString('utf8');assert.ok(csv.includes('人工核对名称'));assert.ok(csv.includes('Example taxon'));assert.ok(!csv.includes('示例数据'));
  await page.goto(base+'#/pages/settings/index');await byId('local-projects').waitFor();await layout('settings');
  for(const [kind,selector] of [['projects','library-project'],['observations','library-observation'],['photos','library-photo']]){
    await byId('local-'+kind).click();await byId('library').waitFor();assert.equal(await byId(selector).count(),1);
    await layout('library-'+kind);
    await byId(selector).click();await (kind==='projects'?byId('add-observation'):byId('save-review')).waitFor();
    await page.goto(base+'#/pages/settings/index');await byId('local-'+kind).waitFor();
  }
  await byId('privacy').click();await page.getByText('知道了',{exact:true}).click();
  await page.goto(projectUrl);await byId('delete-project').click();await page.getByText('取消',{exact:true}).last().click();
  assert.equal((await state()).projects.length,1);
  // Simulate full storage: deletion must preserve both records and photo bytes.
  await page.evaluate(()=>{window.originalSetItem=Storage.prototype.setItem;Storage.prototype.setItem=function(k,v){if(k==='forest-observer:state:v1')throw new DOMException('Full','QuotaExceededError');return window.originalSetItem.call(this,k,v);};});
  await byId('delete-project').click();await page.getByText('删除',{exact:true}).last().click();
  await page.getByText('本机存储空间不足，未保存修改。请释放空间后重试。',{exact:true}).waitFor();
  assert.equal((await state()).projects.length,1);assert.equal(await photoCount(),1);
  await page.evaluate(()=>{Storage.prototype.setItem=window.originalSetItem;delete window.originalSetItem;});
  await byId('delete-project').click();await page.getByText('删除',{exact:true}).last().click();await byId('empty-projects').waitFor();
  s=await state();assert.equal(s.projects.length,0);assert.equal(s.observations.length,0);assert.equal(s.jobs.length,0);assert.equal(await photoCount(),0);
  await page.reload();await byId('empty-projects').waitFor();
  await tab('设置');await byId('local-photos').click();await page.getByText('暂无照片',{exact:true}).waitFor();
  assert.deepEqual(errors,[]);assert.deepEqual(external,[]);
  await writeFile(output+'browser-report.json',JSON.stringify({passed:true,checks:['empty start','keyboard & validation','photo persistence','review & CSV','all local-data links','privacy','cancel deletion','failed write preserves photos','cascade deletion persists','320/390/1100px & 200% text','no external traffic'],errors},null,2));
  console.log('Browser regression passed.');
} catch(e) {await shot('failure');console.log(JSON.stringify({url:page.url(),body:await page.locator('body').innerText(),errors}));throw e;}
finally {await browser.close();}
