export type ReviewStatus = 'pending' | 'confirmed' | 'undetermined';
export interface Photo { id: string; uri: string; name: string; bytes: number; }
export interface Candidate { name: string; scientificName: string; score: number; photoId?: string; }
export interface PhotoRecognition { candidates: Candidate[]; provider: string; recognizedAt: string; }
export interface Project { id: string; name: string; location: string; createdAt: string; isDemo: boolean; }
export interface Review { at: string; decision: ReviewStatus; name: string; scientificName: string; note: string; }
export interface Observation {
  id: string; projectId: string; photos: Photo[]; createdAt: string; isDemo: boolean;
  recognitionStatus: 'pending' | 'demo_complete' | 'not_connected' | 'succeeded' | 'failed';
  recognitionPhotos?: Record<string, PhotoRecognition>; recognitionError?: string;
  reviewStatus: ReviewStatus; candidates: Candidate[]; confirmedName: string;
  confirmedScientificName: string; note: string; revision: number; reviews: Review[];
}
export interface Job {
  id: string; projectId: string; observationIds: string[]; createdAt: string;
  status: 'queued' | 'running' | 'paused' | 'failed' | 'completed'; processed: number; engine: 'demo' | 'service'; error?: string;
}
export interface CaptureDraft {
  projectId: string; photos: Array<Photo & { sourceUri?: string }>; samePlant: boolean; note: string;
}
export interface ForestState { schemaVersion: 1; projects: Project[]; observations: Observation[]; jobs: Job[]; drafts?: CaptureDraft[]; }

export function uid(prefix: string): string { return prefix + '-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 9); }
export function emptyState(): ForestState { return { schemaVersion: 1, projects: [], observations: [], jobs: [] }; }
// Upgrade old previews without losing real photos added to a former example project.
export function removeExamples(state: ForestState): ForestState {
  const observations = state.observations.filter(item => !item.isDemo);
  const ids = new Set(observations.map(item => item.id));
  const projects = state.projects.filter(p => !p.isDemo || observations.some(o => o.projectId === p.id))
    .map(p => p.isDemo ? { ...p, isDemo: false, location: p.location.replace(/\s*·\s*演示项目$/, '') } : p);
  const jobs = state.jobs.map(job => ({ ...job, observationIds: job.observationIds.filter(id => ids.has(id)) }))
    .filter(job => job.observationIds.length > 0);
  return { ...state, projects, observations, jobs };
}
export function deleteProject(state: ForestState, projectId: string, activeJobId = ''): ForestState {
  if (!state.projects.some(p => p.id === projectId)) throw new Error('项目不存在');
  if (state.jobs.some(j => j.projectId === projectId && (j.id === activeJobId || j.status === 'running')))
    throw new Error('请等待当前识别结束或暂停后再删除');
  return { ...state, projects: state.projects.filter(p => p.id !== projectId),
    observations: state.observations.filter(o => o.projectId !== projectId), jobs: state.jobs.filter(j => j.projectId !== projectId),
    ...(state.drafts ? { drafts: state.drafts.filter(d => d.projectId !== projectId) } : {}) };
}
export function captureDraft(state: ForestState, projectId: string): CaptureDraft {
  return state.drafts?.find(d => d.projectId === projectId) || { projectId, photos: [], samePlant: false, note: '' };
}
export function updateCaptureDraft(state: ForestState, projectId: string, update: Partial<Omit<CaptureDraft, 'projectId'>>): ForestState {
  if (!state.projects.some(p => p.id === projectId)) throw new Error('调查项目不存在');
  const draft = { ...captureDraft(state, projectId), ...update };
  if (draft.photos.length > 9) throw new Error('每次最多9张照片');
  return { ...state, drafts: [...(state.drafts || []).filter(d => d.projectId !== projectId), draft] };
}
export function saveCaptureDraft(state: ForestState, projectId: string): ForestState {
  const draft = captureDraft(state, projectId);
  const photos = draft.photos.map(({ id, uri, name, bytes }) => ({ id, uri, name, bytes }));
  return { ...addBatch(state, projectId, photos, draft.samePlant, false, draft.note),
    drafts: (state.drafts || []).filter(d => d.projectId !== projectId) };
}
export function projectStats(state: ForestState, projectId?: string) {
  const items = state.observations.filter(item => !projectId || item.projectId === projectId);
  return {
    observations: items.length,
    photos: items.reduce((sum, item) => sum + item.photos.length, 0),
    pending: items.filter(item => item.reviewStatus === 'pending').length,
    confirmed: items.filter(item => item.reviewStatus === 'confirmed').length,
    species: new Set(items.filter(item => item.reviewStatus === 'confirmed').map(item => item.confirmedScientificName || item.confirmedName)).size,
  };
}
export function makeProject(state: ForestState, name: string, location: string): ForestState {
  const cleanName = name.trim();
  if (!cleanName) throw new Error('请填写项目名称');
  if (cleanName.length > 40) throw new Error('项目名称最多40个字');
  const project: Project = { id: uid('project'), name: cleanName, location: location.trim().slice(0, 80), createdAt: new Date().toISOString(), isDemo: false };
  return { ...state, projects: [project, ...state.projects] };
}
export function addBatch(state: ForestState, projectId: string, photos: Photo[], samePlant: boolean, isDemo = false, note = ''): ForestState {
  if (!state.projects.some(item => item.id === projectId)) throw new Error('调查项目不存在');
  if (!photos.length) throw new Error('请先选择照片');
  if (photos.length > 9) throw new Error('每次最多9张照片');
  if (isDemo) throw new Error('当前版本不支持示例数据');
  const groups = samePlant ? [photos] : photos.map(photo => [photo]);
  const at = new Date().toISOString();
  const observations: Observation[] = groups.map(group => ({
    id: uid('obs'), projectId, photos: group, createdAt: at, isDemo,
    recognitionStatus: 'pending', reviewStatus: 'pending', candidates: [],
    confirmedName: '', confirmedScientificName: '', note: note.trim().slice(0, 500), revision: 0, reviews: [],
  }));
  const job: Job = { id: uid('job'), projectId, observationIds: observations.map(item => item.id), createdAt: at, status: 'queued', processed: 0, engine: 'service' };
  return { ...state, observations: [...observations, ...state.observations], jobs: [job, ...state.jobs] };
}
export function saveReview(state: ForestState, id: string, expectedRevision: number, review: Omit<Review, 'at'>): ForestState {
  const item = state.observations.find(item => item.id === id);
  if (!item) throw new Error('观察记录不存在');
  if (item.revision !== expectedRevision) throw new Error('记录已更新，请重新打开后再保存');
  if (review.decision === 'confirmed' && !review.name.trim()) throw new Error('确认物种前，请填写或选择名称');
  const confirmed = review.decision === 'confirmed';
  const entry: Review = { ...review, name: confirmed ? review.name.trim() : '', scientificName: confirmed ? review.scientificName.trim() : '', note: review.note.trim(), at: new Date().toISOString() };
  return { ...state, observations: state.observations.map(current => current.id !== id ? current : {
    ...current, reviewStatus: review.decision, confirmedName: entry.name, confirmedScientificName: entry.scientificName,
    note: entry.note, revision: current.revision + 1, reviews: [...current.reviews, entry],
  }) };
}
export function displayName(item: Observation): string {
  if (item.reviewStatus === 'undetermined') return '暂未确定';
  return item.confirmedName || item.candidates[0]?.name || '待鉴定植物';
}
export const reviewLabels: Record<ReviewStatus, string> = { pending: '待复核', confirmed: '已确认', undetermined: '暂未确定' };
export function csvCell(value: unknown): string {
  let text = String(value ?? '');
  if (/^\s*[=+\-@]/.test(text)) text = "'" + text;
  return '"' + text.replace(/"/g, '""') + '"';
}
export function exportProjectCsv(state: ForestState, projectId: string): string {
  const project = state.projects.find(item => item.id === projectId);
  if (!project) throw new Error('调查项目不存在');
  const rows: unknown[][] = [['项目', '观察编号', '记录时间', '数据类型', '照片数', '复核状态', '确认名称', '确认学名', '候选名称', '备注']];
  state.observations.filter(item => item.projectId === projectId).forEach(item => rows.push([
    project.name, item.id, item.createdAt, item.isDemo ? '示例数据' : '用户照片', item.photos.length,
    reviewLabels[item.reviewStatus], item.confirmedName, item.confirmedScientificName,
    item.candidates.map(candidate => candidate.name).join('；'), item.note,
  ]));
  return '\uFEFF' + rows.map(row => row.map(csvCell).join(',')).join('\r\n');
}
