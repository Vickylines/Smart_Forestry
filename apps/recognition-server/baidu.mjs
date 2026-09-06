export class ApiError extends Error {
  constructor(status,code,message){super(message);this.status=status;this.code=code;}
}
export function isConfigured({key,secret}){return typeof key==='string'&&!!key.trim()&&(key.startsWith('bce-v3/')||!!secret);}
const TOKEN='https://aip.baidubce.com/oauth/2.0/token';
const PLANT='https://aip.baidubce.com/rest/2.0/image-classify/v1/plant';
export function mapBaidu(data){
  if(data?.error_code){
    const code=Number(data.error_code);
    if([4,17,18,19].includes(code))throw new ApiError(429,'PROVIDER_LIMIT','百度额度不足或调用过快，请检查控制台');
    if([6,14,110,111].includes(code))throw new ApiError(503,'PROVIDER_AUTH','百度凭据或植物识别权限不可用，请检查后台配置');
    throw new ApiError(502,'PROVIDER_ERROR','百度识别未完成（错误码 '+code+'）');
  }
  if(!Array.isArray(data?.result))throw new ApiError(502,'PROVIDER_FORMAT','百度未返回有效识别结果');
  const candidates=data.result.slice(0,5).map(c=>{
    if(typeof c.name!=='string'||!c.name.trim()||typeof c.score!=='number'||!Number.isFinite(c.score)||c.score<0||c.score>1)throw new ApiError(502,'PROVIDER_FORMAT','百度候选结果格式异常');
    return {name:c.name.slice(0,100),scientificName:'',score:c.score};
  });
  return {provider:'baidu-plant',candidates};
}
export class BaiduPlant {
  constructor(credentials,{fetchImpl=fetch,intervalMs=600}={}){this.credentials=credentials;this.fetch=fetchImpl;this.intervalMs=intervalMs;this.nextCall=0;this.cached=null;this.keyVersion='';}
  async post(url,form,headers={}){
    try{
      const r=await this.fetch(url,{method:'POST',redirect:'error',headers:{'Content-Type':'application/x-www-form-urlencoded',...headers},body:new URLSearchParams(form),signal:AbortSignal.timeout(20000)});
      if(!r.ok){
        if(url===TOKEN && [400,401].includes(r.status)){
          let data={};try{data=await r.json();}catch{}
          const description=typeof data.error_description==='string'?data.error_description:'';
          const message=description.includes('client id')?'百度未接受 API Key，请检查是否复制了图像识别应用的 API Key':description.includes('client secret')?'百度未接受 Secret Key，请检查两项密钥是否来自同一应用':'百度凭据无效，请核对 API Key 和 Secret Key';
          throw new ApiError(503,'PROVIDER_AUTH',message);
        }
        throw new ApiError(502,'PROVIDER_HTTP','百度服务暂时不可用');
      }
      return await r.json();
    }catch(e){if(e instanceof ApiError)throw e;throw new ApiError(504,'PROVIDER_TIMEOUT','百度连接失败或超时，请稍后重试');}
  }
  async token(){
    const {key,secret}=this.credentials();
    if(!key||!secret)throw new ApiError(503,'NOT_CONFIGURED','后台尚未填写百度 API Key 和 Secret Key');
    const version=key+'\0'+secret;
    if(this.cached&&this.keyVersion===version&&this.cached.expires>Date.now())return this.cached.token;
    const data=await this.post(TOKEN,{grant_type:'client_credentials',client_id:key,client_secret:secret});
    if(typeof data.access_token!=='string'||!data.access_token)throw new ApiError(503,'PROVIDER_AUTH','百度凭据无效，请确认图像识别应用的 API Key 和 Secret Key');
    const lifetime=Number(data.expires_in);if(!Number.isFinite(lifetime)||lifetime<=0)throw new ApiError(502,'PROVIDER_FORMAT','百度令牌有效期异常');
    this.keyVersion=version;this.cached={token:data.access_token,expires:Date.now()+Math.max(0,lifetime-120)*1000};return data.access_token;
  }
  async recognize(image){
    const config=this.credentials();
    const bearer=config.key?.startsWith('bce-v3/');
    const token=bearer?null:await this.token();
    const wait=this.nextCall-Date.now();if(wait>0)await new Promise(r=>setTimeout(r,wait));
    this.nextCall=Date.now()+this.intervalMs;
    const data=await this.post(bearer?PLANT:PLANT+'?access_token='+encodeURIComponent(token),{image},bearer?{Authorization:'Bearer '+config.key}:{});
    if([110,111].includes(Number(data?.error_code)))this.cached=null;
    return mapBaidu(data);
  }
}
