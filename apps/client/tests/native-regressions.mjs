import {chromium} from 'playwright';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {mkdirSync,writeFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';

// Requires the isolated inspection APK with one unsaved camera photo.
// Takes one additional photo using the connected phone's camera.
const adb=process.env.ADB || 'adb',pkg='cn.zhihuilinye.preview.qa';
const output=fileURLToPath(new URL('../../../.preview/bugfix/',import.meta.url));
mkdirSync(output,{recursive:true});
const run=(...args)=>execFileSync(adb,args,{encoding:'utf8',windowsHide:true}).trim();
const origin='https://appassets.androidplatform.net/index.html#';
async function connect(){
  const pid=run('shell','pidof',pkg);assert.match(pid,/^\d+$/);
  const port=run('forward','tcp:0','localabstract:webview_devtools_remote_'+pid);
  const browser=await chromium.connectOverCDP('http://127.0.0.1:'+port);
  const page=browser.contexts()[0].pages().find(p=>p.url().includes('appassets.androidplatform.net'));
  assert.ok(page);return {browser,page,port};
}
async function close(connection){await connection.browser.close();run('forward','--remove','tcp:'+connection.port);}
function cameraButton(label){
  run('shell','uiautomator','dump','/sdcard/forest-bugfix-ui.xml');
  const xml=run('shell','cat','/sdcard/forest-bugfix-ui.xml');
  const node=[...xml.matchAll(/<node\b[^>]*>/g)].map(m=>m[0]).find(n=>n.includes('package="com.google.android.GoogleCamera"')&&n.includes('content-desc="'+label+'"')&&n.includes('clickable="true"'));
  assert.ok(node,'Camera button not found: '+label);
  const [,x1,y1,x2,y2]=node.match(/bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"/).map(Number);
  run('shell','input','tap',String(Math.round((x1+x2)/2)),String(Math.round((y1+y2)/2)));
}
let connection;
const state=page=>page.evaluate(()=>JSON.parse(localStorage.getItem('forest-observer:state:v1')));
const byId=(page,id)=>page.locator('[data-testid="'+id+'"]');
async function fingerprints(page,photos){
  return page.evaluate(async photos=>{
    const db=await new Promise((resolve,reject)=>{const r=indexedDB.open('forest-observer-photos',1);r.onsuccess=()=>resolve(r.result);r.onerror=reject;});
    try{return await Promise.all(photos.map(async p=>{
      const blob=await new Promise((resolve,reject)=>{const q=db.transaction('photos').objectStore('photos').get(p.uri.slice(4));q.onsuccess=()=>resolve(q.result);q.onerror=reject;});
      const hash=await crypto.subtle.digest('SHA-256',await blob.arrayBuffer());
      return {id:p.id,bytes:blob.size,sha256:[...new Uint8Array(hash)].map(b=>b.toString(16).padStart(2,'0')).join('')};
    }));}finally{db.close();}
  },photos);
}
try{
  run('shell','input','keyevent','KEYCODE_WAKEUP');run('shell','wm','dismiss-keyguard');
  connection=await connect();let page=connection.page;
  let s=await state(page);const draft=s.drafts.find(d=>d.photos.length===1);assert.ok(draft,'Prepare a single unsaved QA capture first');
  const captureUrl=origin+'/pages/capture/index?projectId='+draft.projectId;
  await page.goto(captureUrl);await page.getByText('已选 1 张',{exact:true}).waitFor();
  await byId(page,'capture-note').locator('textarea').fill('真机连续拍摄草稿');
  if(!draft.samePlant)await page.locator('.grouping uni-switch').click();
  await byId(page,'take-photo').click();await close(connection);connection=null;
  cameraButton('拍照');cameraButton('完成');
  connection=await connect();page=connection.page;
  await page.getByText('已选 2 张',{exact:true}).waitFor();
  const before=await state(page),photos=before.drafts.find(d=>d.projectId===draft.projectId).photos;
  const hashes=await fingerprints(page,photos);assert.ok(hashes.every(p=>p.bytes>0));
  assert.equal(await page.evaluate(()=>window.ForestAndroidPreview.pendingCapture()),'');
  await byId(page,'take-photo').click();await close(connection);connection=null;
  run('shell','input','keyevent','KEYCODE_BACK');
  connection=await connect();page=connection.page;
  await page.waitForFunction(()=>document.querySelector('[data-testid="save-observations"]')?.getAttribute('aria-disabled')==='false');
  assert.equal((await state(page)).drafts[0].photos.length,2,'Camera cancellation must preserve both previous photos');
  await close(connection);connection=null;
  run('shell','am','force-stop',pkg);run('shell','am','start','-W','-n',pkg+'/.MainActivity');
  connection=await connect();page=connection.page;await page.goto(captureUrl);
  await page.getByText('已选 2 张',{exact:true}).waitFor();
  await page.waitForFunction(()=>document.querySelector('[data-testid="capture-note"] textarea')?.value==='真机连续拍摄草稿');
  assert.deepEqual(await fingerprints(page,(await state(page)).drafts[0].photos),hashes);
  await page.evaluate(()=>{window.qaSetItem=Storage.prototype.setItem;Storage.prototype.setItem=function(k,v){if(k==='forest-observer:state:v1')throw new DOMException('Full','QuotaExceededError');return window.qaSetItem.call(this,k,v);};});
  await byId(page,'save-observations').click();await byId(page,'capture-error').waitFor();
  assert.equal((await state(page)).observations.length,before.observations.length);
  await page.evaluate(()=>{Storage.prototype.setItem=window.qaSetItem;});
  await byId(page,'save-observations').click();await byId(page,'start-recognition').waitFor();
  s=await state(page);const observation=s.observations.find(o=>o.projectId===draft.projectId);
  assert.equal(observation.photos.length,2);assert.equal(observation.note,'真机连续拍摄草稿');assert.equal(s.drafts.length,0);
  assert.deepEqual(await fingerprints(page,observation.photos),hashes);
  await page.goto(origin+'/pages/observation/index?id='+observation.id);await page.locator('.detail-photo .photo-image').waitFor();
  await page.screenshot({path:output+'native-two-photos.png',fullPage:true});
  await page.goto(captureUrl);await byId(page,'choose-photos').waitFor();assert.equal(await page.locator('.photo-cell').count(),0);
  const report={passed:true,device:run('shell','getprop','ro.product.model'),android:run('shell','getprop','ro.build.version.release'),checks:['two consecutive camera photos','camera cancellation preserves drafts and unlocks controls','drafts, grouping and note survive process restart','failed record commit preserves drafts','retry commits exactly once','saved image SHA-256 unchanged','no duplicate draft after save'],photos:hashes};
  writeFileSync(output+'native-camera-report.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report));
}finally{if(connection)await close(connection);}
