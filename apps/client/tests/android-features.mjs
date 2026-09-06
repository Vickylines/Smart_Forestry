import {chromium} from 'playwright';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {writeFile,mkdir} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
const Zip=createRequire(import.meta.url)('adm-zip');
const base=process.env.APP_URL || 'http://127.0.0.1:5174/';
const output=fileURLToPath(new URL('../../../.preview/beta1/integration/',import.meta.url));
await mkdir(output,{recursive:true});
const browser=await chromium.launch({headless:true,channel:'chrome'});
const context=await browser.newContext({viewport:{width:390,height:844}});
await context.addInitScript(()=>{
  window.ForestAndroidPreview={
    baiduConfigured:()=>localStorage.getItem('qa-configured')==='true',
    saveBaidu:(key,secret)=>{localStorage.setItem('qa-configured',String(!!key && !!secret));return true;},
    requestBaidu:(id,image)=>{
      let error=null,result={authenticated:true};
      if(image){
        const calls=JSON.parse(localStorage.getItem('qa-calls')||'[]');
        let hash=0;for(let i=0;i<image.length;i++)hash=(hash*31+image.charCodeAt(i))>>>0;
        calls.push(hash);localStorage.setItem('qa-calls',JSON.stringify(calls));
        if(calls.length===2)error='模拟网络中断';
        else result={provider:'TEST FIXTURE ONLY',candidates:calls.length===1?[{name:'测试候选',scientificName:'',score:.83},{name:'另一候选',scientificName:'',score:.41}]:[]};
      }
      setTimeout(()=>window.dispatchEvent(new CustomEvent('forest-baidu-result',{detail:{id,result,error}})),100);
    }
  };
});
const page=await context.newPage(),errors=[];
page.on('pageerror',e=>errors.push(e.message));
const byId=id=>page.locator('[data-testid="'+id+'"]');
const field=id=>byId(id).locator('input');
const state=()=>page.evaluate(()=>{const raw=JSON.parse(localStorage.getItem('forest-observer:state:v1'));const value=raw.data??raw;return typeof value==='string'?JSON.parse(value):value;});
try{
  await page.goto(base);await page.locator('uni-tabbar').getByText('任务',{exact:true}).click();
  await page.getByText('批量任务',{exact:true}).waitFor();
  await page.locator('uni-tabbar').getByText('调查',{exact:true}).click();
  await byId('new-project').click();await field('project-name').fill('采集与识别验收');await byId('create-project').click();
  await byId('add-observation').waitFor();const projectUrl=page.url();
  await byId('add-observation').click();
  const image1=await page.screenshot({clip:{x:0,y:0,width:80,height:80}});
  const image2=await page.screenshot({clip:{x:40,y:20,width:90,height:90}});
  const chooser=page.waitForEvent('filechooser');await byId('choose-photos').click();
  await (await chooser).setFiles([{name:'test-a.png',mimeType:'image/png',buffer:image1},{name:'test-b.png',mimeType:'image/png',buffer:image2}]);
  await page.locator('.grouping uni-switch').click();
  await byId('capture-note').locator('textarea').fill('离线采集备注');
  await context.setOffline(true);await byId('save-observations').click();await byId('start-recognition').waitFor();
  let s=await state();assert.equal(s.observations.length,1);assert.equal(s.observations[0].photos.length,2);assert.deepEqual(s.observations[0].candidates,[]);
  await context.setOffline(false);await page.reload();await byId('job-open-project').click();
  await page.locator('[data-testid^="observation-obs-"]').click();await page.locator('.detail-photo .photo-image').waitFor();
  await field('review-name').fill('人工确认名称');await byId('save-review').click();
  await page.goto(projectUrl);await byId('export-package').waitFor();
  const ready=page.waitForEvent('download');await byId('export-package').click();
  const chunks=[];for await(const c of await (await ready).createReadStream())chunks.push(c);
  const bytes=Buffer.concat(chunks),zip=new Zip(bytes);assert.equal(zip.test(),true);
  const manifest=JSON.parse(zip.readAsText('project.json'));
  assert.equal(manifest.observations.length,1);assert.deepEqual(zip.readFile(manifest.observations[0].photos[0].uri),image1);assert.deepEqual(zip.readFile(manifest.observations[0].photos[1].uri),image2);
  assert.ok(zip.readAsText('观察记录.csv').includes('人工确认名称'));
  await writeFile(output+'export-test.zip',bytes);
  await page.goto(base+'#/pages/settings/index');await field('baidu-key').waitFor();
  assert.equal(await byId('baidu-test').getAttribute('tabindex'),'-1');
  await field('baidu-key').fill('QA-ONLY-API-KEY');await byId('baidu-save').click();await page.getByText('请填写配套 Secret Key',{exact:true}).waitFor();
  await field('baidu-secret').fill('QA-ONLY-SECRET-KEY');await byId('baidu-save').click();await page.getByText('密钥已加密保存',{exact:true}).waitFor();
  assert.equal(await field('baidu-key').inputValue(),'');assert.equal(await field('baidu-secret').inputValue(),'');
  await byId('baidu-test').click();await page.getByText('验证通过',{exact:true}).waitFor();
  await page.screenshot({path:output+'settings.png',fullPage:true});
  await page.goto(base+'#/pages/tasks/index');await byId('start-recognition').click();await page.getByText('开始识别',{exact:true}).last().click();
  await page.getByText('模拟网络中断',{exact:true}).first().waitFor();
  s=await state();assert.equal(Object.keys(s.observations[0].recognitionPhotos).length,1);
  await page.reload();await byId('start-recognition').click();await page.getByText('开始识别',{exact:true}).last().click();
  await page.getByText('已完成',{exact:true}).waitFor();
  s=await state();assert.equal(s.observations[0].confirmedName,'人工确认名称');assert.equal(s.observations[0].recognitionStatus,'succeeded');assert.equal(s.observations[0].reviews.length,1);
  const calls=await page.evaluate(()=>JSON.parse(localStorage.getItem('qa-calls')));
  assert.equal(calls.length,3);assert.notEqual(calls[0],calls[1]);assert.equal(calls[1],calls[2]);
  await byId('job-open-project').click();await page.locator('[data-testid^="observation-obs-"]').click();
  await page.locator('.candidate').first().waitFor();assert.equal(await page.locator('.candidate').count(),2);
  await page.locator('.candidate').nth(1).click();await page.waitForFunction(()=>document.querySelector('[data-testid="review-name"] input')?.value==='另一候选');assert.equal(await field('review-name').inputValue(),'另一候选');
  await page.goto(base+'#/pages/settings/index');await byId('baidu-remove').click();await page.getByText('取消',{exact:true}).last().click();
  assert.equal(await byId('key-status').innerText(),'已保存');
  await byId('baidu-remove').click();await page.getByText('移除',{exact:true}).last().click();await byId('key-status').getByText('未设置',{exact:true}).waitFor();
  assert.equal((await state()).observations.length,1);
  await page.reload();await byId('key-status').getByText('未设置',{exact:true}).waitFor();
  assert.deepEqual(errors,[]);
  await writeFile(output+'report.json',JSON.stringify({passed:true,provider:'mock native bridge, no live Baidu requests',checks:['offline multi-photo grouping','original bytes in ZIP','credential UI validation/save/verify/remove/cancel','partial failure & resume skips completed photos','manual reviews preserved','duplicate empty scientific names selectable'],requests:calls.length,errors},null,2));
  console.log('Baidu bridge integration passed (mock responses; no provider quota used).');
}catch(e){await page.screenshot({path:output+'failure.png',fullPage:true});console.log(JSON.stringify({body:await page.locator('body').innerText(),errors}));throw e;}
finally{await browser.close();}
