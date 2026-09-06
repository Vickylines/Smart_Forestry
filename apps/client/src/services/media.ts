import { uid, type Photo } from '../domain/forest';
import { saveBlobFile } from './archive';
export interface DraftPhoto { uri: string; name: string; bytes: number; isDemo: boolean; }

// #ifdef H5
const objectUrls = new Map<string, string>();
let database: Promise<IDBDatabase> | undefined;
function photoDb(): Promise<IDBDatabase> {
  if (!database) database = new Promise((resolve, reject) => {
    const request = indexedDB.open('forest-observer-photos', 1);
    request.onupgradeneeded = () => request.result.createObjectStore('photos');
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => { database = undefined; reject(new Error('无法打开照片存储，请检查浏览器设置')); };
  });
  return database;
}
async function writeBlob(id: string, blob: Blob): Promise<void> {
  const db = await photoDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('photos', 'readwrite');
    tx.objectStore('photos').put(blob, id);
    tx.oncomplete = () => resolve();
    tx.onabort = tx.onerror = () => reject(new Error('照片保存失败，请检查设备剩余空间'));
  });
}
// #endif

export async function persistPhoto(draft: DraftPhoto): Promise<Photo> {
  const id = uid('photo');
  if (draft.isDemo) return { id, uri: draft.uri, name: draft.name, bytes: 0 };
  if (draft.bytes > 20 * 1024 * 1024) throw new Error('单张照片请控制在20MB以内');
  // #ifdef H5
  const response = await fetch(draft.uri);
  if (!response.ok) throw new Error('照片已失效，请重新选择');
  const blob = await response.blob();
  if (!blob.size || blob.size > 20 * 1024 * 1024) throw new Error('照片为空或超过20MB');
  await writeBlob(id, blob);
  return { id, uri: 'idb:' + id, name: draft.name, bytes: blob.size };
  // #endif
  // #ifndef H5
  return new Promise((resolve, reject) => {
    uni.saveFile({ tempFilePath: draft.uri,
      success: result => resolve({ id, uri: result.savedFilePath, name: draft.name, bytes: draft.bytes }),
      fail: () => reject(new Error('照片保存失败，请重新选择或检查剩余空间')),
    });
  });
  // #endif
}
export async function photoUrl(photo: Photo): Promise<string> {
  // #ifdef H5
  if (photo.uri.startsWith('idb:')) {
    const id = photo.uri.slice(4);
    const existing = objectUrls.get(id);
    if (existing) return existing;
    const db = await photoDb();
    const blob = await new Promise<Blob>((resolve, reject) => {
      const request = db.transaction('photos', 'readonly').objectStore('photos').get(id);
      request.onsuccess = () => request.result ? resolve(request.result) : reject(new Error('照片不可用'));
      request.onerror = () => reject(new Error('照片读取失败'));
    });
    const url = URL.createObjectURL(blob);
    objectUrls.set(id, url);
    return url;
  }
  // #endif
  return photo.uri;
}
export async function removeOwnedPhoto(photo: Photo): Promise<void> {
  if (photo.uri.startsWith('/static/')) return;
  // #ifdef H5
  if (photo.uri.startsWith('idb:')) {
    const id = photo.uri.slice(4);
    const db = await photoDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction('photos', 'readwrite');
      tx.objectStore('photos').delete(id);
      tx.oncomplete = () => resolve();
      tx.onabort = tx.onerror = () => reject(tx.error);
    });
    const url = objectUrls.get(id);
    if (url) URL.revokeObjectURL(url);
    objectUrls.delete(id);
  }
  // #endif
  // #ifndef H5
  await new Promise<void>(resolve => uni.removeSavedFile({filePath: photo.uri, complete: () => resolve()}));
  // #endif
}
export async function saveCsvFile(csv: string, name: string): Promise<void> {
  // #ifdef H5
  const preview = (window as any).ForestAndroidPreview;
  if (preview?.beginFile) {await saveBlobFile(new Blob([csv],{type:'text/csv'}),name+'.csv');return;}
  if (preview?.saveCsv) {preview.saveCsv(csv,name+'.csv');return;}
  const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8;' }));
  const anchor = document.createElement('a');
  anchor.href = url; anchor.download = name + '.csv'; document.body.appendChild(anchor); anchor.click(); anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  return;
  // #endif
  // #ifndef H5
  uni.setClipboardData({ data: csv, success: () => uni.showToast({ title: 'CSV已复制', icon: 'success' }) });
  // #endif
}
