import type { ForestState } from '../domain/forest';
import { csvCell, exportProjectCsv } from '../domain/forest';
import { makeZip } from '../domain/zip';
import { photoUrl } from './media';

export async function projectArchive(state: ForestState, projectId: string): Promise<Blob> {
  const project=state.projects.find(p=>p.id===projectId); if(!project)throw new Error('项目不存在');
  const observations=JSON.parse(JSON.stringify(state.observations.filter(o=>o.projectId===projectId))) as ForestState['observations'];
  if(!observations.length)throw new Error('请先添加观察记录');
  const entries:Array<{name:string;blob:Blob}>=[]; const rows:unknown[][]=[['观察编号','照片编号','原文件名','资料包路径','字节数']];
  let total=0;
  for(const o of observations) for(const photo of o.photos) {
    const response=await fetch(await photoUrl(photo));if(!response.ok)throw new Error('照片读取失败，未导出不完整资料包');
    const blob=await response.blob();total+=blob.size;if(total>190*1024*1024)throw new Error('照片超过190MB，请分项目导出');
    const ext=({'image/png':'png','image/jpeg':'jpg','image/webp':'webp','image/svg+xml':'svg'} as Record<string,string>)[blob.type] || 'bin';
    const path='photos/'+photo.id+'.'+ext;
    entries.push({name:path,blob});rows.push([o.id,photo.id,photo.name,path,blob.size]);photo.uri=path;
  }
  entries.push({name:'观察记录.csv',blob:new Blob([exportProjectCsv(state,projectId)],{type:'text/csv'})});
  entries.push({name:'照片清单.csv',blob:new Blob(['\uFEFF'+rows.map(r=>r.map(csvCell).join(',')).join('\r\n')])});
  entries.push({name:'project.json',blob:new Blob([JSON.stringify({format:'forest-observer-export',version:1,exportedAt:new Date().toISOString(),project,observations},null,2)])});
  entries.push({name:'使用说明.txt',blob:new Blob(['植物调查资料包\r\n解压后，用Excel打开观察记录.csv和照片清单.csv。photos目录为原始保存照片。project.json包含候选与复核历史，供电脑端后续接入。\r\nCSV中的名称以复核状态为准。本文件包不包含识别密钥或访问口令。\r\n'])});
  return makeZip(entries);
}
export async function saveBlobFile(blob: Blob, filename: string): Promise<void> {
  // #ifdef H5
  const native=(window as any).ForestAndroidPreview;
  if(native?.beginFile) {
    if(!native.beginFile(filename,blob.type || 'application/octet-stream'))throw new Error('已有文件正在保存，请稍后重试');
    try {
      for(let offset=0;offset<blob.size;offset+=192*1024) {
        const bytes=new Uint8Array(await blob.slice(offset,offset+192*1024).arrayBuffer());
        let binary='';for(let i=0;i<bytes.length;i+=8192)binary+=String.fromCharCode(...bytes.subarray(i,i+8192));
        if(!native.appendFile(btoa(binary)))throw new Error('文件准备失败，请检查剩余空间');
      }
      await new Promise<void>((resolve,reject)=>{
        const handler=(event:Event)=>{window.removeEventListener('forest-file-result',handler);const result=(event as CustomEvent).detail;
          if(result==='saved')resolve();else reject(new Error(result==='cancelled'?'已取消保存':'文件保存失败，请重试'));};
        window.addEventListener('forest-file-result',handler);native.finishFile();
      });
    } catch(e) {native.cancelFile();throw e;}
    return;
  }
  const url=URL.createObjectURL(blob);const a=document.createElement('a');a.href=url;a.download=filename;document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),60000);
  return;
  // #endif
  // #ifndef H5
  throw new Error('请使用此版本的 Android 安装包导出资料');
  // #endif
}
