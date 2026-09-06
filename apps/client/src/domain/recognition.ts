import type { ForestState, PhotoRecognition, Candidate } from './forest';

export interface ServiceSettings { url: string; token: string; }
export function serviceUrl(input: string): string {
  const text = input.trim().replace(/\/+$/, '');
  let u: URL;
  try { u = new URL(text); } catch { throw new Error('请填写完整的 HTTPS 服务地址'); }
  if (u.protocol !== 'https:' || u.username || u.password || u.search || u.hash) throw new Error('服务地址须使用 HTTPS，且不能带密码或参数');
  return u.href.replace(/\/+$/, '');
}
export function parseRecognition(value: unknown): PhotoRecognition {
  const data = value as Record<string, unknown> | null;
  if (!data || typeof data.provider !== 'string' || !data.provider.trim() || !Array.isArray(data.candidates) || data.candidates.length > 20) throw new Error('识别服务返回格式不正确');
  const candidates = data.candidates.map((raw: unknown): Candidate => {
    const c = raw as Record<string, unknown> | null;
    if (!c || typeof c.name !== 'string' || !c.name.trim() || c.name.length > 100 || typeof c.score !== 'number' || !Number.isFinite(c.score) || c.score < 0 || c.score > 1 || (c.scientificName != null && typeof c.scientificName !== 'string')) throw new Error('识别候选格式不正确');
    return { name: c.name.trim(), scientificName: String(c.scientificName || '').slice(0,180), score: c.score };
  });
  return { candidates: candidates.filter(c=>c.name!=='非植物').sort((a,b) => b.score-a.score), provider: data.provider.slice(0,100), recognizedAt: new Date().toISOString() };
}
export function migrateTasks(state: ForestState): ForestState {
  // 旧预览把用户照片放进演示队列；保留照片、复核和历史，转为真实待提交。
  return { ...state, jobs: state.jobs.map(job => {
    const real = job.observationIds.some(id => state.observations.some(o => o.id === id && !o.isDemo));
    if (real && job.engine === 'demo') return {...job, engine:'service' as const, status:'queued' as const, processed:0};
    if (job.engine === 'service' && job.status === 'running') return {...job,status:'paused' as const,error:'上次处理已中断，可继续未完成的照片。'};
    return job;
  }) };
}
export function applyPhotoResult(state: ForestState, jobId: string, observationId: string, photoId: string, result: PhotoRecognition): ForestState {
  const job = state.jobs.find(j => j.id === jobId);
  const item = state.observations.find(o => o.id === observationId);
  if (!job || !item || item.isDemo || !job.observationIds.includes(item.id) || !item.photos.some(p => p.id === photoId)) throw new Error('识别任务与照片不匹配');
  if (item.recognitionPhotos?.[photoId]) return state;
  const outcomes = {...item.recognitionPhotos,[photoId]:result};
  const byName = new Map<string,Candidate>();
  Object.entries(outcomes).forEach(([id,entry]) => entry.candidates.forEach(c => {
    const key = c.scientificName || c.name;
    if (!byName.has(key) || byName.get(key)!.score < c.score) byName.set(key,{...c,photoId:id});
  }));
  const observations = state.observations.map(o => o.id !== item.id ? o : {...o, recognitionPhotos:outcomes, recognitionError:'',
    candidates:[...byName.values()].sort((a,b) => b.score-a.score).slice(0,5),
    recognitionStatus:item.photos.every(p => outcomes[p.id]) ? 'succeeded' as const : 'pending' as const});
  const processed = observations.filter(o => job.observationIds.includes(o.id) && o.recognitionStatus === 'succeeded').length;
  return {...state,observations,jobs:state.jobs.map(j => j.id !== jobId ? j : {...j,processed,status:processed === job.observationIds.length ? 'completed' as const : j.status,error:''})};
}
