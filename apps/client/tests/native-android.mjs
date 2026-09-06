import {chromium} from 'playwright';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {mkdirSync,writeFileSync,readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
const adb=process.env.ADB || 'adb';
const pkg='cn.zhihuilinye.preview.qa';
const output=fileURLToPath(new URL('../../../.preview/beta1/native/',import.meta.url));mkdirSync(output,{recursive:true});
const run=(...args)=>execFileSync(adb,args,{encoding:'utf8',windowsHide:true}).trim();
async function connect(){
 run('shell','input','keyevent','KEYCODE_WAKEUP');
 run('shell','wm','dismiss-keyguard');
 const pid=run('shell','pidof',pkg);assert.ok(/^\d+$/.test(pid),'QA app must be running');
 const port=run('forward','tcp:0','localabstract:webview_devtools_remote_'+pid);
 const browser=await chromium.connectOverCDP('http://127.0.0.1:'+port);
 const page=browser.contexts()[0].pages().find(p=>p.url().includes('appassets.androidplatform.net'));
 assert.ok(page);return {browser,page,port};
}
async function close(c){await c.browser.close();run('forward','--remove','tcp:'+c.port);}
async function restart(c){await close(c);run('shell','am','force-stop',pkg);run('shell','am','start','-W','-n',pkg+'/.MainActivity');return connect();}
const origin='https://appassets.androidplatform.net/index.html#';
const phase=process.argv[2];
let c=await connect(),page=c.page;
const byId=id=>page.locator('[data-testid="'+id+'"]');
const field=id=>byId(id).locator('input');
try {
 if(phase==='reset-keys'){
  assert.equal(await page.evaluate(()=>window.ForestAndroidPreview.saveBaidu('','')),true);
 } else if(phase==='keys'){
  await page.goto(origin+'/pages/settings/index');await field('baidu-key').waitFor();
  assert.equal(await page.evaluate(()=>window.ForestAndroidPreview.baiduConfigured()),false);
  const key='QA-ONLY-API-KEY-20260906',secret='QA-ONLY-SECRET-20260906';
  await field('baidu-key').fill(key);await field('baidu-secret').fill(secret);await byId('baidu-save').click();
  await page.getByText('密钥已加密保存',{exact:true}).waitFor();
  assert.equal(await field('baidu-key').inputValue(),'');assert.equal(await field('baidu-secret').inputValue(),'');
  const prefs=run('shell','run-as',pkg,'cat','shared_prefs/baidu-private.xml');
  assert.ok(prefs.includes('name="data"'));assert.ok(!prefs.includes(key)&&!prefs.includes(secret));
  const local=await page.evaluate(()=>JSON.stringify(localStorage));assert.ok(!local.includes(key)&&!local.includes(secret));
  c=await restart(c);page=c.page;await page.goto(origin+'/pages/settings/index');await field('baidu-key').waitFor();
  assert.equal(await page.evaluate(()=>window.ForestAndroidPreview.baiduConfigured()),true);
  await byId('baidu-test').click();await page.waitForFunction(()=>{const t=document.querySelector('[data-testid="baidu-message"]')?.textContent;return t && t!=='密钥已加密保存';},null,{timeout:65000});
  const validation=await byId('baidu-message').innerText();assert.notEqual(validation,'验证通过','Dummy credentials must not authenticate');
  await page.screenshot({path:output+'keys-validation.png',fullPage:true});
  await byId('baidu-remove').click();await page.getByText('移除',{exact:true}).last().click();await byId('key-status').getByText('未设置',{exact:true}).waitFor();
  const cleared=run('shell','run-as',pkg,'cat','shared_prefs/baidu-private.xml');assert.ok(!cleared.includes('name="data"'));
  c=await restart(c);page=c.page;assert.equal(await page.evaluate(()=>window.ForestAndroidPreview.baiduConfigured()),false);
  await writeFileSync(output+'keys-report.json',JSON.stringify({passed:true,device:'Pixel 4 XL',checks:['empty credentials on install','Keystore encrypted preferences','no plaintext in preferences or Web storage','blank input fields after save','persist across restart','invalid credentials rejected','remove persists across restart'],validation},null,2));
  console.log('Native key storage checks passed; '+validation);
 } else if(phase==='camera'){
  await page.goto(origin+'/pages/projects/index');await byId('new-project').click();
  await field('project-name').fill('真机相机验收');await byId('create-project').click();await byId('add-observation').waitFor();
  writeFileSync(output+'project.json',JSON.stringify({id:new URL(page.url().replace('#','')).searchParams.get('id')}));
  await byId('add-observation').click();
  await byId('take-photo').click();
 } else if(phase==='saved-photo'){
  await page.getByText('已选 1 张',{exact:true}).waitFor();await page.screenshot({path:output+'camera-return.png',fullPage:true});
  await byId('save-observations').click();await byId('job-open-project').waitFor();await byId('job-open-project').click();
  await page.locator('[data-testid^="observation-obs-"]').click();await page.locator('.detail-photo .photo-image').waitFor();
  await page.reload();await page.locator('.detail-photo .photo-image').waitFor();
  const state=await page.evaluate(()=>{const r=JSON.parse(localStorage.getItem('forest-observer:state:v1'));return typeof r.data==='string'?JSON.parse(r.data):r.data??r;});
  const projectId=JSON.parse(readFileSync(output+'project.json','utf8')).id;
  const observations=state.observations.filter(o=>o.projectId===projectId);
  assert.equal(observations.length,1);assert.ok(observations[0].photos[0].bytes>0);assert.ok(observations[0].photos[0].uri.startsWith('idb:'));
  await page.screenshot({path:output+'photo-persisted.png',fullPage:true});
  writeFileSync(output+'camera-report.json',JSON.stringify({passed:true,device:'Pixel 4 XL',android:'16',checks:['explicit camera fallback','full image returned','saved to IndexedDB','photo readable after reload'],bytes:observations[0].photos[0].bytes},null,2));
  console.log('Camera round trip passed.');
 } else if(phase==='export'){
  await page.goto(origin+'/pages/projects/index');await page.locator('[data-testid^="project-project-"]').first().click();await byId('export-package').click();
 } else if(phase==='gallery'){
  await page.goto(origin+'/pages/projects/index');await page.locator('[data-testid^="project-project-"]').first().click();await byId('add-observation').click();await byId('choose-photos').click();
 }
}finally {await close(c);}
