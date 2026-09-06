import { forest, commit } from '../data/store';
import { deleteProject } from '../domain/forest';
import { activeJob } from './recognition';
import { removeOwnedPhoto } from './media';

export async function removeProject(id: string): Promise<boolean> {
  const photos = [...forest.value.observations.filter(o => o.projectId === id).flatMap(o => o.photos),
    ...(forest.value.drafts || []).filter(d => d.projectId === id).flatMap(d => d.photos)];
  // Commit first: a storage failure must never leave records pointing at deleted photos.
  commit(state => deleteProject(state, id, activeJob.value));
  const referenced = new Set([...forest.value.observations.flatMap(o => o.photos.map(p => p.uri)),
    ...(forest.value.drafts || []).flatMap(d => d.photos.map(p => p.uri))]);
  // #ifdef H5
  const native = (window as any).ForestAndroidPreview;
  try {
    const pending = JSON.parse(native?.pendingCapture?.() || 'null');
    if (pending?.projectId === id) native.releaseCapture(pending.uri);
  } catch { /* Committed deletion remains valid when no capture is pending. */ }
  // #endif
  const unique = [...new Map(photos.filter(p => !referenced.has(p.uri)).map(p => [p.uri,p])).values()];
  const results = await Promise.allSettled(unique.map(removeOwnedPhoto));
  return results.every(result => result.status === 'fulfilled');
}
