import {chromium} from 'playwright';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {mkdirSync,writeFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';

// Use the isolated inspection package; never reads the main app's credentials.
const adb=process.env.ADB || 'adb',pkg='cn.zhihuilinye.preview.qa';
const output=fileURLToPath(new URL('../../../.preview/beta3/',import.meta.url));
mkdirSync(output,{recursive:true});
const run=(...args)=>execFileSync(adb,args,{encoding:'utf8',windowsHide:true}).trim();
const origin='https://appassets.androidplatform.net/index.html#';
run('shell','input','keyevent','KEYCODE_WAKEUP');run('shell','wm','dismiss-keyguard');
run('shell','am','start','-W','-n',pkg+'/.MainActivity');
const pid=run('shell','pidof',pkg);assert.match(pid,/^\d+$/);
const port=run('forward','tcp:0','localabstract:webview_devtools_remote_'+pid);
let browser;
try{
  // Activity startup returns before the WebView debugging socket is ready.
  for(let attempt=0;attempt<20;attempt++){
    try{if((await fetch('http://127.0.0.1:'+port+'/json/version',{signal:AbortSignal.timeout(1000)})).ok)break;}catch{}
    await new Promise(resolve=>setTimeout(resolve,250));
  }
  browser=await chromium.connectOverCDP('http://127.0.0.1:'+port);
  const page=browser.contexts()[0].pages().find(p=>p.url().includes('appassets.androidplatform.net'));
  assert.ok(page);
  const byId=id=>page.locator('[data-testid="'+id+'"]');
  const field=id=>byId(id).locator('input');
  await page.goto(origin+'/pages/settings/index');await field('baidu-key').waitFor();
  await page.evaluate(()=>{
    window.qaVisibility=[];document.addEventListener('visibilitychange',()=>window.qaVisibility.push(document.visibilityState));
  });
  const backgroundStates=[];
  async function leaveAndReturn(){
    run('shell','input','keyevent','KEYCODE_HOME');
    const resumed=run('shell','dumpsys','activity','activities').split('\n').filter(line=>/topResumedActivity=|mResumedActivity:/.test(line));
    assert.ok(resumed.length && resumed.every(line=>!line.includes(pkg)),'QA activity must really leave the foreground');
    // Some Android WebViews keep document.visibilityState visible in the
    // background. Verify the Activity transition independently of that event.
    backgroundStates.push(await page.evaluate(()=>document.visibilityState));
    run('shell','am','start','-W','-n',pkg+'/.MainActivity');
    await page.waitForFunction(()=>document.visibilityState==='visible',null,{polling:100,timeout:5000});
  }
  await field('baidu-key').fill('QA-ONLY-API-KEY-DRAFT');await leaveAndReturn();
  assert.equal(await field('baidu-key').inputValue(),'QA-ONLY-API-KEY-DRAFT');
  await field('baidu-secret').fill('QA-ONLY-SECRET-KEY-DRAFT');await leaveAndReturn();
  assert.equal(await field('baidu-key').inputValue(),'QA-ONLY-API-KEY-DRAFT');
  assert.equal(await field('baidu-secret').inputValue(),'QA-ONLY-SECRET-KEY-DRAFT');
  assert.ok(!await page.evaluate(()=>JSON.stringify([localStorage,sessionStorage]).includes('QA-ONLY-')));
  const visibility=await page.evaluate(()=>window.qaVisibility);
  await page.screenshot({path:output+'native-credential-draft.png',fullPage:true});
  // Clear these unsaved test inputs without touching any saved credentials.
  await field('baidu-key').fill('');await field('baidu-secret').fill('');
  await page.evaluate(()=>{
    const key='forest-observer:state:v1',raw=JSON.parse(localStorage.getItem(key));
    const state=raw || {schemaVersion:1,projects:[],observations:[],jobs:[]};
    const projectId='qa-beta3-ui',observationId='qa-beta3-observation',jobId='qa-beta3-job',now=new Date().toISOString();
    state.projects=state.projects.filter(p=>p.id!==projectId).concat({id:projectId,name:'植物种类 · 布局测试',location:'',createdAt:now,isDemo:false});
    state.observations=state.observations.filter(o=>o.id!==observationId).concat({id:observationId,projectId,photos:[],createdAt:now,isDemo:false,recognitionStatus:'failed',reviewStatus:'pending',candidates:[{name:'测试植物',scientificName:'',family:'测试科',genus:'测试属',score:.8,taxonomySource:'测试夹具'}],confirmedName:'',confirmedScientificName:'',note:'',revision:0,reviews:[]});
    state.jobs=state.jobs.filter(j=>j.id!==jobId).concat({id:jobId,projectId,observationIds:[observationId],createdAt:now,engine:'service',status:'failed',processed:0,error:'百度鉴权失败，请检查 API Key 和 Secret Key'});
    localStorage.setItem(key,JSON.stringify(state));
  });
  await page.goto(origin+'/pages/tasks/index');await page.reload();
  const error=byId('job-qa-beta3-job').locator('.error-notice');await error.waitFor();
  const layouts=[];
  for(const scale of [1,2]){
    await page.addStyleTag({content:`html{font-size:${scale*100}%!important}`});
    const layout=await error.evaluate(element=>{
      const box=element.getBoundingClientRect(),previous=element.previousElementSibling.getBoundingClientRect(),next=element.nextElementSibling.getBoundingClientRect();
      return {boxes:element.getClientRects().length,noOverlap:box.top>=previous.bottom&&box.bottom<=next.top,noOverflow:document.documentElement.scrollWidth<=innerWidth};
    });
    assert.deepEqual(layout,{boxes:1,noOverlap:true,noOverflow:true});layouts.push({scale,...layout});
    await error.scrollIntoViewIfNeeded();await page.screenshot({path:output+'native-task-error-'+scale+'x.png',fullPage:true});
  }
  await page.goto(origin+'/pages/observation/index?id=qa-beta3-observation');
  await page.addStyleTag({content:'html{font-size:100%!important}'});
  await page.waitForFunction(()=>document.querySelector('[data-testid="review-family"] input')?.value==='测试科');
  assert.equal(await field('review-genus').inputValue(),'测试属');
  await page.screenshot({path:output+'native-taxonomy.png'});
  await byId('save-review').scrollIntoViewIfNeeded();await page.screenshot({path:output+'native-taxonomy-form.png'});
  const report={passed:true,device:run('shell','getprop','ro.product.model'),android:run('shell','getprop','ro.build.version.release'),visibility,backgroundStates,layouts,checks:['real HOME / resume retains both unsaved credentials','credentials absent from web storage','multiline error is one block without overlap at 100% / 200% type','taxonomy candidate prefills review fields'],provider:'no live recognition requests'};
  writeFileSync(output+'native-ui-report.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report));
}finally{await browser?.close();run('forward','--remove','tcp:'+port);}
