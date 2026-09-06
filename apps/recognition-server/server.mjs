import http from 'node:http';
import https from 'node:https';
import {readFileSync,mkdirSync,existsSync,writeFileSync} from 'node:fs';
import {dirname,join,resolve} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {createHash,randomBytes,timingSafeEqual} from 'node:crypto';
import {DatabaseSync} from 'node:sqlite';
import {ApiError,BaiduPlant,isConfigured} from './baidu.mjs';
const here=dirname(fileURLToPath(import.meta.url));
export function credentials(){
  const values={};
  try{for(const line of readFileSync(join(here,'.env.local'),'utf8').split(/\r?\n/)){const i=line.indexOf('=');if(i>0&&!line.trim().startsWith('#'))values[line.slice(0,i).trim()]=line.slice(i+1).trim();}}catch{}
  return {key:process.env.BAIDU_API_KEY||values.BAIDU_API_KEY||'',secret:process.env.BAIDU_SECRET_KEY||values.BAIDU_SECRET_KEY||''};
}
export function validateInput(body){
  if(!body||typeof body.requestId!=='string'||!/^[A-Za-z0-9:_-]{1,160}$/.test(body.requestId))throw new ApiError(400,'INVALID_REQUEST','识别请求编号无效');
  const image=body.image;
  if(typeof image!=='string'||image.length>4*1024*1024||image.length<16||image.length%4!==0||!/^[A-Za-z0-9+/]+={0,2}$/.test(image))throw new ApiError(400,'INVALID_IMAGE','图片编码无效或超过4MB');
  const bytes=Buffer.from(image,'base64');
  const jpeg=bytes[0]===255&&bytes[1]===216&&bytes[2]===255;
  const png=bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]));
  if(!jpeg&&!png)throw new ApiError(400,'INVALID_IMAGE','只接受 JPEG 或 PNG 图片');
  return {id:body.requestId,image,hash:createHash('sha256').update(bytes).digest('hex')};
}
export function createService({token,dbPath,provider,ready=()=>true,dailyLimit=100,origins=['https://appassets.androidplatform.net','http://127.0.0.1:5173']}={}){
  if(typeof token!=='string'||token.length<24)throw new Error('后台访问口令至少24字符');
  const db=new DatabaseSync(dbPath);
  db.exec('PRAGMA journal_mode=WAL; CREATE TABLE IF NOT EXISTS requests(id TEXT PRIMARY KEY, hash TEXT NOT NULL, result TEXT, state TEXT NOT NULL); CREATE TABLE IF NOT EXISTS usage(day TEXT PRIMARY KEY, count INTEGER NOT NULL);');
  db.exec("UPDATE requests SET state='uncertain' WHERE state='running'");
  const inflight=new Map();let tail=Promise.resolve();
  function queue(fn){const next=tail.then(fn,fn);tail=next.catch(()=>{});return next;}
  async function recognize(body){
    const {id,image,hash}=validateInput(body);
    const old=db.prepare('SELECT * FROM requests WHERE id=?').get(id);
    if(old&&old.hash!==hash)throw new ApiError(409,'ID_CONFLICT','同一请求编号对应不同照片');
    if(old?.result)return JSON.parse(old.result);
    if(old?.state==='uncertain')throw new ApiError(409,'RESULT_UNCERTAIN','上次调用中断，结果待核对，未重复调用百度');
    if(inflight.has(id))return inflight.get(id);
    if(inflight.size>=8)throw new ApiError(429,'QUEUE_FULL','任务较多，请稍后重试');
    const work=queue(async()=>{
      if(!ready())throw new ApiError(503,'NOT_CONFIGURED','后台尚未配置百度账号');
      const day=new Date().toISOString().slice(0,10);const used=db.prepare('SELECT count FROM usage WHERE day=?').get(day)?.count||0;
      if(used>=dailyLimit)throw new ApiError(429,'DAILY_LIMIT','已达到本机每日调用上限');
      db.prepare("INSERT INTO requests(id,hash,state) VALUES(?,?,'running') ON CONFLICT(id) DO UPDATE SET state='running'").run(id,hash);
      db.prepare('INSERT INTO usage(day,count) VALUES(?,1) ON CONFLICT(day) DO UPDATE SET count=count+1').run(day);
      try{const result=await provider.recognize(image);const json=JSON.stringify(result);db.prepare("UPDATE requests SET result=?,state='completed' WHERE id=?").run(json,id);return result;}
      catch(e){db.prepare('UPDATE requests SET state=? WHERE id=?').run(e?.code==='PROVIDER_TIMEOUT'?'uncertain':'failed',id);throw e;}
    });
    inflight.set(id,work);try{return await work;}finally{inflight.delete(id);}
  }
  function authorized(value){const a=Buffer.from(value||''),b=Buffer.from('Bearer '+token);return a.length===b.length&&timingSafeEqual(a,b);}
  const handler=async(req,res)=>{
    const origin=req.headers.origin;
    if(origin&&origins.includes(origin)){res.setHeader('Access-Control-Allow-Origin',origin);res.setHeader('Vary','Origin');}
    res.setHeader('Cache-Control','no-store');res.setHeader('X-Content-Type-Options','nosniff');
    const send=(status,value)=>{res.writeHead(status,{'Content-Type':'application/json; charset=utf-8'});res.end(JSON.stringify(value));};
    if(origin&&!origins.includes(origin))return send(403,{error:'ORIGIN_DENIED',message:'请求来源未授权'});
    if(!['/health','/recognize'].includes(req.url))return send(404,{error:'NOT_FOUND'});
    if(req.method==='OPTIONS'){res.writeHead(204,{'Access-Control-Allow-Methods':'GET, POST, OPTIONS','Access-Control-Allow-Headers':'Content-Type, Authorization','Access-Control-Max-Age':'600'});res.end();return;}
    if(!authorized(req.headers.authorization))return send(401,{error:'UNAUTHORIZED',message:'后台访问口令不正确'});
    if(req.method==='GET'&&req.url==='/health')return send(200,{service:'forest-recognition',apiVersion:1,ready:ready()});
    if(req.method!=='POST'||req.url!=='/recognize')return send(405,{error:'METHOD_NOT_ALLOWED'});
    if(!req.headers['content-type']?.startsWith('application/json'))return send(415,{error:'JSON_REQUIRED'});
    try{
      const chunks=[];let size=0;for await(const chunk of req){size+=chunk.length;if(size>4300000)throw new ApiError(413,'TOO_LARGE','图片请求过大');chunks.push(chunk);}
      let body;try{body=JSON.parse(Buffer.concat(chunks).toString('utf8'));}catch{throw new ApiError(400,'INVALID_JSON','请求内容不是有效JSON');}
      send(200,await recognize(body));
    }catch(e){send(e instanceof ApiError?e.status:500,{error:e instanceof ApiError?e.code:'INTERNAL_ERROR',message:e instanceof ApiError?e.message:'后台处理失败，请稍后重试'});}
  };
  return {handler,close:()=>db.close(),recognize};
}
export function loadSettings(){
  const dir=join(here,'.local');mkdirSync(dir,{recursive:true});const path=join(dir,'settings.json');
  if(!existsSync(path))writeFileSync(path,JSON.stringify({token:randomBytes(32).toString('hex'),port:8765,dailyLimit:100},null,2),{mode:0o600});
  return {...JSON.parse(readFileSync(path,'utf8')),dir};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
  const settings=loadSettings();const provider=new BaiduPlant(credentials);
  const app=createService({token:settings.token,dbPath:join(settings.dir,'recognition.sqlite'),provider,ready:()=>isConfigured(credentials()),dailyLimit:settings.dailyLimit});
  const cert=join(settings.dir,'localhost.crt'),key=join(settings.dir,'localhost.key');
  const server=existsSync(cert)&&existsSync(key)?https.createServer({cert:readFileSync(cert),key:readFileSync(key)},app.handler):http.createServer(app.handler);
  server.requestTimeout=60000;server.headersTimeout=10000;
  server.listen(settings.port,'127.0.0.1',()=>console.log('植物识别后台已启动，仅监听本机端口 '+settings.port+'；密钥从 .env.local 读取。'));
  server.on('error',()=>{console.error('后台启动失败，请检查端口和本机配置。');process.exitCode=1;});
}
