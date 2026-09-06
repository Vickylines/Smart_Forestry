import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createService,validateInput} from '../server.mjs';
import {BaiduPlant,mapBaidu,ApiError,isConfigured} from '../baidu.mjs';
const image=Buffer.from([255,216,255,224,0,16,1,2,3,4,255,217]).toString('base64');
const token='local-test-access-token-only-123456';
test('新版API Key只使用Bearer，不取token且不混用旧鉴权',async()=>{
 const calls=[];const p=new BaiduPlant(()=>({key:'bce-v3/test-only',secret:''}),{intervalMs:0,fetchImpl:async(url,options)=>{calls.push({url,options});return {ok:true,json:async()=>({result:[]})};}});
 await p.recognize(image);assert.equal(calls.length,1);assert.ok(!calls[0].url.includes('access_token'));assert.equal(calls[0].options.headers.Authorization,'Bearer bce-v3/test-only');
 assert.equal(isConfigured({key:'bce-v3/test',secret:''}),true);assert.equal(isConfigured({key:'old-key',secret:''}),false);
});
test('百度令牌缓存、正确请求编码、响应映射及错误脱敏',async()=>{
  const calls=[];const provider=new BaiduPlant(()=>({key:'test-key',secret:'test-secret'}),{intervalMs:0,fetchImpl:async(url,options)=>{
    calls.push({url,options});return {ok:true,json:async()=>url.includes('/oauth/')?{access_token:'test-token',expires_in:3600}:{result:[{name:'测试植物',score:.8}]}};
  }});
  assert.equal((await provider.recognize(image)).candidates[0].name,'测试植物');await provider.recognize(image);
  assert.equal(calls.length,3);assert.equal(calls[0].options.body.get('client_secret'),'test-secret');assert.equal(calls[1].options.body.get('image'),image);assert.ok(!calls[1].options.body.has('top_num'));
  assert.deepEqual(mapBaidu({result:[]}).candidates,[]);assert.throws(()=>mapBaidu({error_code:18,error_msg:'SECRET MUST NOT LEAK'}),e=>e.status===429&&!e.message.includes('SECRET'));
});
test('HTTP鉴权、CORS、逐请求持久幂等、冲突与每日上限',async()=>{
  const dir=mkdtempSync(join(tmpdir(),'forest-api-test-'));let count=0;
  const app=createService({token,dbPath:join(dir,'test.sqlite'),dailyLimit:2,provider:{recognize:async()=>{count++;return {provider:'test-only',candidates:[]};}}});
  const server=http.createServer(app.handler);await new Promise(r=>server.listen(0,'127.0.0.1',r));const base='http://127.0.0.1:'+server.address().port;
  const req=(path,body,extra={})=>fetch(base+path,{method:body?'POST':'GET',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json',...extra},body:body?JSON.stringify(body):undefined});
  try{
    assert.equal((await fetch(base+'/health')).status,401);
    assert.equal((await req('/health',null,{Origin:'https://evil.example'})).status,403);
    const pre=await fetch(base+'/recognize',{method:'OPTIONS',headers:{Origin:'https://appassets.androidplatform.net'}});assert.equal(pre.status,204);
    assert.equal((await (await req('/health')).json()).ready,true);
    const [a,b]=await Promise.all([req('/recognize',{requestId:'a',image}),req('/recognize',{requestId:'a',image})]);assert.equal(a.status,200);assert.equal(b.status,200);assert.equal(count,1);
    assert.equal((await req('/recognize',{requestId:'a',image:Buffer.from([255,216,255,224,9,8,7,6,5,4,255,217]).toString('base64')})).status,409);
    assert.equal((await req('/recognize',{requestId:'b',image})).status,200);assert.equal((await req('/recognize',{requestId:'c',image})).status,429);assert.equal(count,2);
    assert.equal((await req('/recognize',{requestId:'z',image:'not an image'})).status,400);
  }finally{await new Promise(r=>server.close(r));app.close();}
  const again=createService({token,dbPath:join(dir,'test.sqlite'),provider:{recognize:async()=>{throw new Error('must not call');}}});
  assert.equal((await again.recognize({requestId:'a',image})).provider,'test-only');again.close();rmSync(dir,{recursive:true});
});
test('超时后的未知结果不重复调用，后台重启保留保护状态',async()=>{
  const dir=mkdtempSync(join(tmpdir(),'forest-api-uncertain-'));const dbPath=join(dir,'test.sqlite');let calls=0;
  let app=createService({token,dbPath,provider:{recognize:async()=>{calls++;throw new ApiError(504,'PROVIDER_TIMEOUT','超时');}}});
  await assert.rejects(app.recognize({requestId:'uncertain',image}),e=>e.status===504);app.close();
  app=createService({token,dbPath,provider:{recognize:async()=>{calls++;}}});
  await assert.rejects(app.recognize({requestId:'uncertain',image}),e=>e.status===409);assert.equal(calls,1);app.close();rmSync(dir,{recursive:true});
  assert.throws(()=>validateInput({requestId:'../a',image}));
});
