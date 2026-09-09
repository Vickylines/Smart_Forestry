import {chromium} from 'playwright';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {mkdirSync,writeFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';

const adb=process.env.ADB || 'adb',pkg='cn.zhihuilinye.preview.qa';
const run=(...args)=>execFileSync(adb,args,{encoding:'utf8',windowsHide:true}).trim();
const out=fileURLToPath(new URL('../../../.preview/release-0.3.0/',import.meta.url));mkdirSync(out,{recursive:true});
run('shell','input','keyevent','KEYCODE_WAKEUP');run('shell','wm','dismiss-keyguard');
run('shell','am','start','-W','-n',pkg+'/.MainActivity');
const pid=run('shell','pidof',pkg);assert.match(pid,/^\d+$/);
const port=run('forward','tcp:0','localabstract:webview_devtools_remote_'+pid);
let browser;
try {
  for(let attempt=0;attempt<30;attempt++) {
    try { if((await fetch('http://127.0.0.1:'+port+'/json/version',{signal:AbortSignal.timeout(1000)})).ok)break; } catch {}
    await new Promise(resolve=>setTimeout(resolve,250));
  }
  browser=await chromium.connectOverCDP('http://127.0.0.1:'+port);
  const page=browser.contexts()[0].pages().find(p=>p.url().includes('appassets.androidplatform.net'));assert.ok(page);
  const errors=[];page.on('pageerror',error=>errors.push(error.message));
  await page.goto('https://appassets.androidplatform.net/index.html#/pages/settings/index');
  const button=page.locator('[data-testid="open-repository"]');await button.waitFor();
  await page.getByText('智慧林业 · 0.3.0 正式版',{exact:true}).waitFor();
  const before=await page.evaluate(()=>localStorage.getItem('forest-observer:state:v1')),url=page.url();
  await button.scrollIntoViewIfNeeded();await page.screenshot({path:out+'settings-native.png'});
  await button.click();
  let activities='';
  for(let attempt=0;attempt<20;attempt++) {
    activities=run('shell','dumpsys','activity','activities');
    if(activities.includes('https://github.com/Vickylines/Smart_Forestry') && activities.split('\n').some(line=>/topResumedActivity=|mResumedActivity:/.test(line)&&!line.includes(pkg)))break;
    await new Promise(resolve=>setTimeout(resolve,250));
  }
  assert.ok(activities.includes('https://github.com/Vickylines/Smart_Forestry'),'Android must launch the repository URL');
  const foreground=activities.split('\n').filter(line=>/topResumedActivity=|mResumedActivity:/.test(line)).map(line=>line.trim());
  assert.ok(foreground.length&&foreground.every(line=>!line.includes(pkg)),'External activity must be foreground');
  assert.equal(page.url(),url,'The app WebView must stay on Settings');
  run('shell','am','start','-W','-n',pkg+'/.MainActivity');
  await button.waitFor();
  assert.equal(await page.evaluate(()=>localStorage.getItem('forest-observer:state:v1')),before);
  assert.deepEqual(errors,[]);
  const report={passed:true,device:run('shell','getprop','ro.product.model'),android:run('shell','getprop','ro.build.version.release'),foreground,checks:['native repository button launches fixed HTTPS URL externally','app WebView stays local','return preserves survey records','release version visible'],errors};
  writeFileSync(out+'repository-native.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report));
} finally { await browser?.close();run('forward','--remove','tcp:'+port); }
