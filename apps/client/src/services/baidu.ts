import {ref} from 'vue';
function bridge():any{return typeof window!=='undefined'?(window as any).ForestAndroidPreview:undefined;}
export const directAvailable=!!bridge()?.requestBaidu;
export const directConfigured=ref(!!bridge()?.baiduConfigured?.());
export function saveBaidu(key:string,secret:string){
 if(!directAvailable)throw new Error('请在 Android 应用中保存密钥');
 key=key.trim();secret=secret.trim();
 if (/\s/.test(key+secret) || key.length>4096 || secret.length>1024) throw new Error('密钥格式不正确');
 if (key && !key.startsWith('bce-v3/') && !secret) throw new Error('请填写配套 Secret Key');
 if (key.startsWith('bce-v3/')) secret='';
 if(!bridge()?.saveBaidu(key,secret))throw new Error('密钥保存失败，请等待识别结束或检查设备存储');
 directConfigured.value=!!bridge().baiduConfigured();
}
export function requestBaidu(image=''):Promise<any>{
 return new Promise((resolve,reject)=>{
  const native=bridge();if(!native?.requestBaidu){reject(new Error('请在 Android 安装包内使用百度直连'));return;}
  const id='req-'+Date.now().toString(36)+'-'+Math.random().toString(36).slice(2);
  const cleanup=()=>{clearTimeout(timer);window.removeEventListener('forest-baidu-result',handler);};
  const handler=(e:Event)=>{const d=(e as CustomEvent).detail;if(d.id!==id)return;cleanup();if(d.error)reject(new Error(d.error));else resolve(d.result);};
  const timer=setTimeout(()=>{cleanup();reject(new Error('百度响应超时，请稍后重试'));},65000);
  window.addEventListener('forest-baidu-result',handler);native.requestBaidu(id,image);
 });
}
