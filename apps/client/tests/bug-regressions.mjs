import {chromium} from 'playwright';
import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';

const base=process.env.APP_URL || 'http://127.0.0.1:5174/';
const output=fileURLToPath(new URL('../../../.preview/bugfix/',import.meta.url));
await mkdir(output,{recursive:true});
const browser=await chromium.launch({headless:true,channel:'chrome'});
const project={id:'project-regression',name:'故障恢复调查',location:'',createdAt:new Date().toISOString(),isDemo:false};
const seed={schemaVersion:1,projects:[project],observations:[],jobs:[]};
const results=[];
async function check(name,body){
  if(process.env.TEST_FILTER && !new RegExp(process.env.TEST_FILTER).test(name))return;
  const context=await browser.newContext({viewport:{width:390,height:844}});
  const page=await context.newPage();
  const errors=[];page.on('pageerror',error=>errors.push(error.message));
  try{await body(context,page);assert.deepEqual(errors,[]);results.push({name,passed:true});}
  catch(error){results.push({name,passed:false,error:error.message});await page.screenshot({path:output+name+'.png',fullPage:true});}
  finally{await context.close();}
}
const state=page=>page.evaluate(()=>JSON.parse(localStorage.getItem('forest-observer:state:v1')));
const byId=(page,id)=>page.locator('[data-testid="'+id+'"]');

await check('credential-draft-background',async(context,page)=>{
  await context.addInitScript(()=>{
    window.ForestAndroidPreview={baiduConfigured:()=>false,requestBaidu:()=>{},saveBaidu:()=>!window.qaSaveFailure};
  });
  await page.goto(base+'#/pages/settings/index');
  const key=byId(page,'baidu-key').locator('input'),secret=byId(page,'baidu-secret').locator('input');
  const background=()=>page.evaluate(async()=>{
    Object.defineProperty(document,'visibilityState',{configurable:true,value:'hidden'});
    document.dispatchEvent(new Event('visibilitychange'));
    await new Promise(resolve=>requestAnimationFrame(resolve));
    Object.defineProperty(document,'visibilityState',{configurable:true,value:'visible'});
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await key.fill('QA-ONLY-API-KEY-DRAFT');await background();
  assert.equal(await key.inputValue(),'QA-ONLY-API-KEY-DRAFT','Switching out to copy the secret must retain the API key');
  await secret.fill('QA-ONLY-SECRET-KEY-DRAFT');await background();
  assert.equal(await secret.inputValue(),'QA-ONLY-SECRET-KEY-DRAFT');
  await page.locator('uni-tabbar').getByText('任务',{exact:true}).click();
  await page.locator('uni-tabbar').getByText('设置',{exact:true}).click();
  assert.equal(await key.inputValue(),'QA-ONLY-API-KEY-DRAFT');
  assert.equal(await secret.inputValue(),'QA-ONLY-SECRET-KEY-DRAFT');
  assert.ok(!await page.evaluate(()=>JSON.stringify([localStorage,sessionStorage]).includes('QA-ONLY-')),'Draft credentials must stay out of web storage');
  await page.evaluate(()=>{window.qaSaveFailure=true;});await byId(page,'baidu-save').click();
  await page.getByText('密钥保存失败，请等待识别结束或检查设备存储',{exact:true}).waitFor();
  assert.equal(await key.inputValue(),'QA-ONLY-API-KEY-DRAFT');
  await page.evaluate(()=>{window.qaSaveFailure=false;});await byId(page,'baidu-save').click();
  await page.getByText('密钥已加密保存',{exact:true}).waitFor();
  assert.equal(await key.inputValue(),'');assert.equal(await secret.inputValue(),'');
});

await check('multiline-task-error',async(context,page)=>{
  await context.addInitScript(data=>{
    localStorage.setItem('forest-observer:state:v1',JSON.stringify({...data,
      observations:[{id:'obs-error',projectId:data.projects[0].id,isDemo:false,photos:[],reviews:[],candidates:[],revision:0,reviewStatus:'pending'}],
      jobs:[{id:'job-error',projectId:data.projects[0].id,observationIds:['obs-error'],createdAt:new Date().toISOString(),engine:'service',status:'failed',processed:0,error:'百度鉴权失败，请检查 API Key 和 Secret Key'}]}));
  },seed);
  await page.goto(base+'#/pages/tasks/index');await page.locator('.error-notice').waitFor();
  for(const width of [320,390])for(const scale of [1,1.5,2]){
    await page.setViewportSize({width,height:844});
    await page.addStyleTag({content:`html{font-size:${scale*100}%!important}`});
    const layout=await page.locator('.error-notice').evaluate(element=>{
      const box=element.getBoundingClientRect(),previous=element.previousElementSibling.getBoundingClientRect(),next=element.nextElementSibling.getBoundingClientRect();
      const range=document.createRange();range.selectNodeContents(element);
      return {boxes:element.getClientRects().length,noOverlap:box.top>=previous.bottom&&box.bottom<=next.top,
        textInside:[...range.getClientRects()].every(r=>r.left>=box.left&&r.right<=box.right+1&&r.top>=box.top&&r.bottom<=box.bottom+1),
        noOverflow:document.documentElement.scrollWidth<=innerWidth};
    });
    assert.deepEqual(layout,{boxes:1,noOverlap:true,textInside:true,noOverflow:true},`Error box must wrap cleanly at ${width}px / ${scale*100}% type`);
  }
  await page.screenshot({path:output+'multiline-task-error-fixed.png',fullPage:true});
});

await check('startup-write-failure',async(context,page)=>{
  await context.addInitScript(data=>{
    localStorage.setItem('forest-observer:state:v1',JSON.stringify(data));
    const original=Storage.prototype.setItem;
    Storage.prototype.setItem=function(key,value){if(key==='forest-observer:state:v1')throw new DOMException('Full','QuotaExceededError');return original.call(this,key,value);};
  },seed);
  await page.goto(base);await byId(page,'new-project').waitFor();
  assert.equal(await page.getByText(project.name,{exact:true}).count(),1,'A failed startup write must not hide readable projects');
  await page.getByText(project.name,{exact:true}).click();
  const download=page.waitForEvent('download');await byId(page,'export-csv').click();await download;
});

await check('startup-migration-write-failure',async(context,page)=>{
  const data={...seed,observations:[{id:'obs-existing',projectId:project.id,isDemo:false,photos:[],reviews:[],revision:0,note:'',candidates:[],reviewStatus:'pending',recognitionStatus:'pending'}],
    jobs:[{id:'job-existing',projectId:project.id,observationIds:['obs-existing'],engine:'service',status:'running',processed:0}]};
  await context.addInitScript(data=>{
    localStorage.setItem('forest-observer:state:v1',JSON.stringify(data));
    const original=Storage.prototype.setItem;
    Storage.prototype.setItem=function(key,value){if(key==='forest-observer:state:v1')throw new DOMException('Full','QuotaExceededError');return original.call(this,key,value);};
  },data);
  await page.goto(base);await byId(page,'new-project').waitFor();
  assert.equal(await page.getByText(project.name,{exact:true}).count(),1);
  assert.ok((await page.locator('body').innerText()).includes('仍可查看和导出'));
  assert.equal((await state(page)).jobs[0].status,'running','Failed migrations must not overwrite the old data');
});

await check('startup-read-failure',async(context,page)=>{
  await context.addInitScript(data=>{
    localStorage.setItem('forest-observer:state:v1',JSON.stringify(data));
    window.qaGetItem=Storage.prototype.getItem;
    Storage.prototype.getItem=function(key){if(key==='forest-observer:state:v1')throw new DOMException('Denied','SecurityError');return window.qaGetItem.call(this,key);};
  },seed);
  await page.goto(base);await byId(page,'new-project').waitFor();
  assert.ok((await page.locator('body').innerText()).includes('本机资料无法读取'));
  await byId(page,'new-project').click();await byId(page,'project-name').locator('input').fill('不能覆盖旧资料');await byId(page,'create-project').click();
  await page.evaluate(()=>{Storage.prototype.getItem=window.qaGetItem;});
  assert.deepEqual((await state(page)).projects,[project]);
});

await check('capture-draft-and-retry',async(context,page)=>{
  await context.addInitScript(data=>{
    if(!localStorage.getItem('forest-observer:state:v1'))localStorage.setItem('forest-observer:state:v1',JSON.stringify(data));
    window.ForestAndroidPreview={
      pendingCapture:()=>localStorage.getItem('qa-pending') || '',
      releaseCapture:()=>localStorage.removeItem('qa-pending'),
    };
  },seed);
  await page.goto(base+'#/pages/capture/index?projectId='+project.id);
  await byId(page,'choose-photos').waitFor();
  const image=await page.screenshot({clip:{x:0,y:0,width:80,height:80}});
  await page.route('**/__qa-capture/*',route=>route.fulfill({status:200,contentType:'image/png',body:image}));
  async function recover(name){
    await page.evaluate(photo=>{
      localStorage.setItem('qa-pending',JSON.stringify(photo));
      window.dispatchEvent(new Event('forest-capture-ready'));
    },{projectId:project.id,uri:base+'__qa-capture/'+name,name,bytes:image.length});
  }
  await recover('first.png');await page.getByText('已选 1 张',{exact:true}).waitFor();
  await byId(page,'capture-note').locator('textarea').fill('恢复后保留备注');
  await page.locator('.grouping uni-switch').click();
  await recover('second.png');await page.getByText('已选 2 张',{exact:true}).waitFor();
  await page.reload();await byId(page,'choose-photos').waitFor();
  assert.equal(await page.getByText('已选 2 张',{exact:true}).count(),1,'Both captures must survive renderer restart');
  assert.equal(await byId(page,'capture-note').locator('textarea').inputValue(),'恢复后保留备注');
  await page.evaluate(()=>{
    window.qaSetItem=Storage.prototype.setItem;
    Storage.prototype.setItem=function(key,value){if(key==='forest-observer:state:v1')throw new DOMException('Full','QuotaExceededError');return window.qaSetItem.call(this,key,value);};
  });
  await byId(page,'save-observations').click();await byId(page,'capture-error').waitFor();
  assert.equal((await state(page)).observations.length,0);
  await page.evaluate(()=>{Storage.prototype.setItem=window.qaSetItem;});
  await byId(page,'save-observations').click();await byId(page,'start-recognition').waitFor();
  let s=await state(page);assert.equal(s.observations.length,1);assert.equal(s.observations[0].photos.length,2);assert.equal(s.observations[0].note,'恢复后保留备注');
  assert.equal(s.drafts?.length || 0,0);
  await page.goto(base+'#/pages/capture/index?projectId='+project.id);
  await byId(page,'choose-photos').waitFor();assert.equal(await page.locator('.photo-cell').count(),0,'Saved drafts must not return as duplicates');
  await recover('third.png');await page.getByText('已选 1 张',{exact:true}).waitFor();
  await page.locator('.remove-photo').click();await page.reload();await byId(page,'choose-photos').waitFor();
  assert.equal(await page.locator('.photo-cell').count(),0,'Removed captures must stay removed');
  await page.evaluate(()=>{
    window.qaSetItem=Storage.prototype.setItem;
    Storage.prototype.setItem=function(key,value){if(key==='forest-observer:state:v1')throw new DOMException('Full','QuotaExceededError');return window.qaSetItem.call(this,key,value);};
  });
  await recover('retry-import.png');await byId(page,'capture-error').waitFor();
  assert.ok(await page.evaluate(()=>localStorage.getItem('qa-pending')),'A failed draft commit must not acknowledge the native photo');
  await page.evaluate(()=>{Storage.prototype.setItem=window.qaSetItem;window.dispatchEvent(new Event('forest-capture-ready'));});
  await page.getByText('已选 1 张',{exact:true}).waitFor();
  await page.evaluate(()=>window.dispatchEvent(new Event('forest-capture-ready')));
  assert.equal((await state(page)).drafts[0].photos.length,1);
  await page.goto(base+'#/pages/project/index?id='+project.id);await byId(page,'delete-project').click();await page.getByText('删除',{exact:true}).last().click();await byId(page,'empty-projects').waitFor();
  assert.equal((await state(page)).drafts.length,0);
  const remaining=await page.evaluate(()=>new Promise((resolve,reject)=>{
    const request=indexedDB.open('forest-observer-photos',1);
    request.onsuccess=()=>{const db=request.result;const count=db.transaction('photos').objectStore('photos').count();count.onsuccess=()=>{db.close();resolve(count.result);};count.onerror=reject;};request.onerror=reject;
  }));
  assert.equal(remaining,0,'Deleting a project must also clean draft photos and failed-import blobs');
});

await check('pending-capture-project',async(context,page)=>{
  const second={...project,id:'project-other',name:'另一个项目'};
  await context.addInitScript(({seed,second})=>{
    if(!localStorage.getItem('forest-observer:state:v1'))localStorage.setItem('forest-observer:state:v1',JSON.stringify({...seed,projects:[...seed.projects,second]}));
    window.ForestAndroidPreview={pendingCapture:()=>localStorage.getItem('qa-pending') || '',releaseCapture:()=>localStorage.removeItem('qa-pending')};
  },{seed,second});
  await page.goto(base+'#/pages/capture/index?projectId='+second.id);await byId(page,'choose-photos').waitFor();
  const image=await page.screenshot({clip:{x:0,y:0,width:80,height:80}});
  await page.route('**/__qa-capture/*',route=>route.fulfill({status:200,contentType:'image/png',body:image}));
  await page.evaluate(photo=>localStorage.setItem('qa-pending',JSON.stringify(photo)),{projectId:project.id,uri:base+'__qa-capture/project.png',name:'project.png',bytes:image.length});
  await byId(page,'take-photo').click();await page.getByText('照片尚未保存',{exact:true}).waitFor();
  await page.getByText('返回处理',{exact:true}).click();await page.getByText('已选 1 张',{exact:true}).waitFor();
  assert.equal((await state(page)).drafts[0].projectId,project.id);
  assert.equal((await state(page)).drafts.length,1);
});

await browser.close();
await writeFile(output+'regression-report.json',JSON.stringify(results,null,2));
console.log(JSON.stringify(results,null,2));
assert.ok(results.every(r=>r.passed),'Regression checks failed');
