import {chromium} from 'playwright';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {mkdir,writeFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
const adb=process.env.ADB||'adb',pkg='cn.zhihuilinye.preview.qa';
const run=(...args)=>execFileSync(adb,args,{encoding:'utf8',windowsHide:true}).trim();
run('shell','input','keyevent','KEYCODE_WAKEUP');run('shell','wm','dismiss-keyguard');
run('shell','am','start','-W','-n',pkg+'/.MainActivity');
const port=run('forward','tcp:0','localabstract:webview_devtools_remote_'+run('shell','pidof',pkg));
let browser;
try{
 for(let i=0;i<30;i++){
  try{if((await fetch('http://127.0.0.1:'+port+'/json/version',{signal:AbortSignal.timeout(1000)})).ok)break;}catch{}
  await new Promise(r=>setTimeout(r,250));
 }
 browser=await chromium.connectOverCDP('http://127.0.0.1:'+port);
 const page=browser.contexts()[0].pages().find(p=>p.url().includes('appassets.androidplatform.net'));
 assert.ok(page);const origin='https://appassets.androidplatform.net/index.html#';
 await page.goto(origin+'/pages/projects/index');
 await page.evaluate(()=>{
  const time=new Date().toISOString();
  const observations=['银杏','洋桔梗'].map((name,index)=>({id:'taxonomy-'+index,projectId:'taxonomy-qa',createdAt:time,isDemo:false,photos:[],candidates:[{name,scientificName:'',score:0.95}],recognitionStatus:'succeeded',reviewStatus:'pending',confirmedName:'',confirmedScientificName:'',confirmedFamily:'',confirmedGenus:'',note:'',revision:0,reviews:[]}));
  localStorage.removeItem('forest-observer:taxonomy:v1');
  localStorage.setItem('forest-observer:state:v1',JSON.stringify({schemaVersion:1,projects:[{id:'taxonomy-qa',name:'全球科属验证',location:'',createdAt:time,isDemo:false}],observations,jobs:[]}));
 });
 await page.reload();
 const rows=[];
 for(const [index,family,genus] of [[0,'银杏科','银杏属'],[1,'龙胆科','洋桔梗属']]){
  await page.goto(origin+'/pages/observation/index?id=taxonomy-'+index);
  await page.reload(); // A hash-only query change does not rerun uni-app onLoad.
  await page.waitForFunction(expected=>document.querySelector('[data-testid="candidate-taxonomy"]')?.textContent.includes(expected)||document.body.innerText.includes('分类库暂不可用'),genus,{timeout:90000,polling:200});
  assert.ok((await page.locator('[data-testid="candidate-taxonomy"]').innerText()).includes(genus),'Native taxonomy lookup failed for '+genus);
  // uni-input updates its inner native DOM value on the next WebView frame.
  await page.waitForFunction(expected=>document.querySelector('[data-testid="review-family"] input')?.value===expected,family,{timeout:10000,polling:200});
  assert.equal(await page.locator('[data-testid="review-family"] input').inputValue(),family);
  assert.equal(await page.locator('[data-testid="review-genus"] input').inputValue(),genus);
  const result=await page.evaluate(i=>JSON.parse(localStorage.getItem('forest-observer:state:v1')).observations[i].candidates[0],index);
  rows.push(result);
 }
 const rejected=await page.evaluate(()=>new Promise(resolve=>{
  const id='tax-invalid-url';
  const listener=e=>{if(e.detail.id!==id)return;window.removeEventListener('forest-taxonomy-result',listener);resolve(e.detail);};
  window.addEventListener('forest-taxonomy-result',listener);
  window.ForestAndroidPreview.requestTaxonomy(id,'arbitrary-url','https://example.com');
 }));assert.ok(rejected.error);
 const font=await page.evaluate(()=>getComputedStyle(document.documentElement).fontSize);assert.equal(font,'16px');
 const dir=fileURLToPath(new URL('../../../.preview/beta4/',import.meta.url));await mkdir(dir,{recursive:true});
 await page.screenshot({path:dir+'native-taxonomy-normal.png'});
 await writeFile(dir+'native-taxonomy.json',JSON.stringify({passed:true,rows,font,rejectedArbitraryUrl:!!rejected.error},null,2));
 console.log(JSON.stringify({passed:true,plants:rows.map(r=>({name:r.name,family:r.family,genus:r.genus,source:r.taxonomySource})),font,rejectedArbitraryUrl:true}));
}finally{if(browser)await browser.close();try{run('forward','--remove','tcp:'+port);}catch{/* A disconnected device must not mask the original test failure. */}}
