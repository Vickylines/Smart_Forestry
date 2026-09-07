import type { ForestState, PhotoRecognition, Candidate } from './forest';

export interface ServiceSettings { url: string; token: string; }
export function serviceUrl(input: string): string {
  const text = input.trim().replace(/\/+$/, '');
  let u: URL;
  try { u = new URL(text); } catch { throw new Error('请填写完整的 HTTPS 服务地址'); }
  if (u.protocol !== 'https:' || u.username || u.password || u.search || u.hash) throw new Error('服务地址须使用 HTTPS，且不能带密码或参数');
  return u.href.replace(/\/+$/, '');
}
// Baidu has no structured family/genus fields. Only extract explicit Chinese
// ranks from the matching entry's introduction, retaining evidence for review.
// Ambiguous, historical, comparative or sub-rank descriptions stay unfilled.
export function baiduTaxonomy(name: string, value: unknown): Partial<Candidate> {
  const info = value as Record<string, unknown> | null;
  if (!info || typeof info.description !== 'string') return {};
  const description = info.description.trim().slice(0, 2000);
  const intro = description.split(/[。！？!?\n]/)[0].slice(0, 600);
  if (!intro.startsWith(name) || !/^(?:[（(，,：:\s]|是|为|属于|隶属|又称|又名|别名|$)/.test(intro.slice(name.length))) return {};
  if (/不属|不是|不为|并非|原属|原为|曾属|曾为|旧属|旧称|过去|原归|改归|划归|区别|相似|近似|杂交|亚科|亚属|或/.test(intro)) return {};
  const token = '(?:(?![科属的是为和与或非])[\\u3400-\\u9fff]){1,12}';
  const ranks = (text: string, rank: '科' | '属') => {
    const boundary = '(?:^|[，,、：:；;\\s]|属于|隶属|是|为' + (rank === '属' ? '|科' : '') + ')';
    const pattern = new RegExp(boundary + '(' + token + rank + ')(?!于)', 'g');
    return new Set(Array.from(text.replace(/[（(][^）)]*[）)]/g, '').matchAll(pattern), match => match[1]));
  };
  const families = ranks(intro, '科'), genera = ranks(intro, '属');
  if (families.size > 1 || genera.size > 1 || ranks(description, '科').size > 1 || ranks(description, '属').size > 1) return {};
  const family = [...families][0] || '', genus = [...genera][0] || '';
  if (!family && !genus) return {};
  if (/一种|一类|多种|常见|植物|包括|相关|其他/.test(family + genus) || ['本科', '学科', '专科'].includes(family) || ['同属', '金属', '所属', '亲属', '家属', '下属', '隶属', '直属'].includes(genus)) return {};
  let taxonomySourceUrl = '';
  if (typeof info.baike_url === 'string') {
    try {
      const url = new URL(info.baike_url);
      if (['http:', 'https:'].includes(url.protocol) && url.hostname === 'baike.baidu.com' && !url.username && !url.password) {
        url.protocol = 'https:'; taxonomySourceUrl = url.href.slice(0, 1000);
      }
    } catch { /* A missing source link does not invalidate the quoted evidence. */ }
  }
  return { family, genus, taxonomySource: '百度百科摘要', taxonomyEvidence: intro.slice(0, 600), taxonomySourceUrl };
}
export function parseRecognition(value: unknown): PhotoRecognition {
  const data = value as Record<string, unknown> | null;
  if (!data || typeof data.provider !== 'string' || !data.provider.trim() || !Array.isArray(data.candidates) || data.candidates.length > 20) throw new Error('识别服务返回格式不正确');
  const candidates = data.candidates.map((raw: unknown): Candidate => {
    const c = raw as Record<string, unknown> | null;
    if (!c || typeof c.name !== 'string' || !c.name.trim() || c.name.length > 100 || typeof c.score !== 'number' || !Number.isFinite(c.score) || c.score < 0 || c.score > 1 || (c.scientificName != null && typeof c.scientificName !== 'string')) throw new Error('识别候选格式不正确');
    if ([c.family, c.genus].some(field => field != null && (typeof field !== 'string' || field.length > 100))) throw new Error('识别科属格式不正确');
    const taxonomy = data.provider === 'baidu-plant' ? baiduTaxonomy(c.name.trim(), c.baikeInfo) : {};
    return { ...taxonomy, name: c.name.trim(), scientificName: String(c.scientificName || '').slice(0,180), score: c.score,
      family: typeof c.family === 'string' ? c.family.trim() : taxonomy.family || '',
      genus: typeof c.genus === 'string' ? c.genus.trim() : taxonomy.genus || '' };
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
