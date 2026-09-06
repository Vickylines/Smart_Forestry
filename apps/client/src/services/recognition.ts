import { ref } from 'vue';
import { forest, commit } from '../data/store';
import { parseRecognition, applyPhotoResult } from '../domain/recognition';
import type { Photo } from '../domain/forest';
import { photoUrl } from './media';
import { directConfigured, requestBaidu } from './baidu';
export const activeJob = ref('');
let pause = false;
async function encodePhoto(photo: Photo): Promise<string> {
  // #ifdef H5
  const image=new Image(); image.src=await photoUrl(photo); await image.decode();
  if (!image.naturalWidth || !image.naturalHeight) throw new Error('照片无法解码，请换一张照片');
  const scale=Math.min(1,1600/Math.max(image.naturalWidth,image.naturalHeight));
  const canvas=document.createElement('canvas'); canvas.width=Math.max(1,Math.round(image.naturalWidth*scale)); canvas.height=Math.max(1,Math.round(image.naturalHeight*scale));
  const ctx=canvas.getContext('2d'); if (!ctx) throw new Error('无法准备照片');
  ctx.fillStyle='#ffffff';ctx.fillRect(0,0,canvas.width,canvas.height);ctx.drawImage(image,0,0,canvas.width,canvas.height);
  const encoded=canvas.toDataURL('image/jpeg',.88).split(',')[1];
  if (!encoded || encoded.length>4*1024*1024) throw new Error('照片仍过大，请选择较小的照片');
  return encoded;
  // #endif
  // #ifndef H5
  throw new Error('请使用此版本的 Android 安装包');
  // #endif
}
export function pauseRecognition() { pause=true; }
export async function runRecognition(jobId: string) {
  if (activeJob.value) throw new Error('请等待当前任务完成或暂停');
  const job=forest.value.jobs.find(j=>j.id===jobId);
  if (!job || job.engine!=='service' || job.status==='completed') return;
  if (!directConfigured.value) throw new Error('请先在设置中填写百度识图密钥');
  activeJob.value=jobId;pause=false;
  try {
    commit(s=>({...s,jobs:s.jobs.map(j=>j.id===jobId?{...j,status:'running',error:''}:j)}));
    for (const id of job.observationIds) {
      const item=forest.value.observations.find(o=>o.id===id); if (!item || item.isDemo) throw new Error('任务记录不完整');
      for (const photo of item.photos) {
        if (pause) break;
        if (forest.value.observations.find(o=>o.id===id)?.recognitionPhotos?.[photo.id]) continue;
        const image=await encodePhoto(photo);
        if (pause) break;
        const raw=await requestBaidu(image);
        const result=parseRecognition(raw);
        commit(s=>applyPhotoResult(s,jobId,id,photo.id,result));
      }
      if (pause) break;
    }
    if (forest.value.jobs.find(j=>j.id===jobId)?.status!=='completed') commit(s=>({...s,jobs:s.jobs.map(j=>j.id===jobId?{...j,status:'paused',error:'已暂停，继续时跳过已完成的照片。'}:j)}));
  } catch (e) {
    const message=e instanceof Error?e.message:'识别失败，请重试';
    commit(s=>({...s,jobs:s.jobs.map(j=>j.id===jobId?{...j,status:'failed',error:message}:j)}));
    throw e;
  } finally {activeJob.value='';}
}
