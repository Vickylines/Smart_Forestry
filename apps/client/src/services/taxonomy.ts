import { ref } from 'vue';
import { forest, commit } from '../data/store';
import { applyCandidateTaxonomy, createTaxonomyCache, resolveTaxonomy, taxonomyKey, taxonomyUrl, type TaxonomyOperation, type TaxonomyResult } from '../domain/taxonomy';
import type { Candidate } from '../domain/forest';

// One request at a time, at most one request per second. Cool down a source on
// HTTP 429; never retry in a tight loop. The cache stores public taxonomy only.
let tail: Promise<unknown> = Promise.resolve(), nextRequest = 0;
const cooldown = new Map<string, number>();
function request(operation: TaxonomyOperation, query: string): Promise<any> {
  const source = operation.split('-')[0];
  const work = tail.catch(() => {}).then(async () => {
    if ((cooldown.get(source) || 0) > Date.now()) throw new Error('分类库繁忙');
    await new Promise(resolve => setTimeout(resolve,Math.max(0,nextRequest - Date.now())));
    nextRequest = Date.now() + 1050;
    try {
      const url = taxonomyUrl(operation,query);
      const native = typeof window !== 'undefined' ? (window as any).ForestAndroidPreview : undefined;
      if (native) {
        if (!native.requestTaxonomy) throw new Error('请更新 Android 安装包后补查科属');
        return await new Promise((resolve,reject) => {
          const id = 'tax-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2);
          const cleanup = () => { clearTimeout(timer); window.removeEventListener('forest-taxonomy-result',handler); };
          const handler = (event: Event) => { const data = (event as CustomEvent).detail; if (data?.id !== id) return; cleanup(); if (data.error) reject(new Error(data.error)); else resolve(data.result); };
          const timer = setTimeout(() => { cleanup(); reject(new Error('分类库响应超时')); },25000);
          window.addEventListener('forest-taxonomy-result',handler);
          try { native.requestTaxonomy(id,operation,query); } catch (error) { cleanup(); reject(error); }
        });
      }
      const controller = new AbortController(), timer = setTimeout(() => controller.abort(),18000);
      try {
        const response = await fetch(url,{signal:controller.signal,credentials:'omit',redirect:'error',referrerPolicy:'no-referrer'});
        if (!response.ok) throw new Error(String(response.status));
        const body = await response.text();
        if (body.length > 2 * 1024 * 1024) throw new Error('分类库响应过大');
        return JSON.parse(body);
      } finally { clearTimeout(timer); }
    } catch (e) {
      if (e instanceof Error && e.message.includes('429')) cooldown.set(source,Date.now() + 60000);
      throw e;
    }
  });
  tail = work; return work;
}
const CACHE = 'forest-observer:taxonomy:v1';
// Queue whole name resolutions so a large photo batch cannot exhaust every
// lookup's deadline while its requests wait behind other observations.
const lookupQueue: Array<{run: () => Promise<TaxonomyResult>; resolve: (value: TaxonomyResult) => void; reject: (reason: unknown) => void}> = [];
let resolving = false;
async function drainLookups() {
  if (resolving) return;
  resolving = true;
  try {
    while (lookupQueue.length) {
      const next = lookupQueue.shift()!;
      try { next.resolve(await next.run()); } catch (error) { next.reject(error); }
    }
  } finally { resolving = false; }
}
export const lookupTaxonomy = createTaxonomyCache((name,scientificName,urgent) => new Promise<TaxonomyResult>((resolve,reject) => {
  const entry = {run:() => resolveTaxonomy(name,scientificName,request),resolve,reject};
  if (urgent) lookupQueue.unshift(entry); else lookupQueue.push(entry);
  void drainLookups();
}), {
  read:() => uni.getStorageSync(CACHE), write:value => uni.setStorageSync(CACHE,value)
});
export const taxonomyBusy = ref<Record<string, boolean>>({});
export const taxonomyProgress = ref('');
const observations = new Map<string, Promise<void>>();
const recent = (candidate: Candidate) => candidate.taxonomyCheckedAt && Date.now() - Date.parse(candidate.taxonomyCheckedAt) < (candidate.taxonomyStatus === 'unavailable' ? 60000 : ['matched','genus'].includes(candidate.taxonomyStatus || '') ? 30 * 86400000 : 10 * 60000);
export function enrichObservation(id: string, refresh = false): Promise<void> {
  const current = observations.get(id); if (current) return current;
  const work = (async () => {
    taxonomyBusy.value = {...taxonomyBusy.value,[id]:true};
    try {
      // Highest-scoring candidates first. Resume after interruption from the
      // persisted per-candidate timestamps; no photo-recognition request is made.
      const visited = new Set<string>();
      for (;;) {
        const candidate = forest.value.observations.find(o => o.id === id)?.candidates.find(c => !visited.has(taxonomyKey(c.name,c.scientificName)));
        if (!candidate) break;
        visited.add(taxonomyKey(candidate.name,candidate.scientificName));
        if (!refresh && recent(candidate)) continue;
        const result = await lookupTaxonomy(candidate.name,candidate.scientificName,refresh);
        commit(state => applyCandidateTaxonomy(state,id,taxonomyKey(candidate.name,candidate.scientificName),result));
      }
    } finally { const busy = {...taxonomyBusy.value}; delete busy[id]; taxonomyBusy.value = busy; }
  })().finally(() => observations.delete(id));
  observations.set(id,work); return work;
}
let stop = false;
export function stopTaxonomy() { stop = true; }
export async function enrichProject(projectId: string) {
  if (taxonomyProgress.value) return;
  stop = false;
  const ids = forest.value.observations.filter(o => o.projectId === projectId && o.candidates.length).map(o => o.id);
  try {
    for (let index = 0; index < ids.length; index++) {
      if (stop) break;
      taxonomyProgress.value = `补查科属 ${index + 1} / ${ids.length}`;
      await enrichObservation(ids[index]);
    }
  } finally { taxonomyProgress.value = ''; }
}
