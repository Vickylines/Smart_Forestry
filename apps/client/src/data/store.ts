import { ref } from 'vue';
import { emptyState, removeExamples, type ForestState } from '../domain/forest';
import { migrateTasks } from '../domain/recognition';

const KEY = 'forest-observer:state:v1';
export const storageWarning = ref('');
function load(): ForestState {
  let migrated: ForestState;
  try {
    let raw: unknown;
    // uni.getStorageSync suppresses read errors on H5. Preserve the distinction
    // between an empty installation and inaccessible existing storage.
    // #ifdef H5
    raw = localStorage.getItem(KEY);
    // #endif
    // #ifndef H5
    raw = uni.getStorageSync(KEY);
    // #endif
    if (!raw) return emptyState();
    let parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
    if (parsed && typeof parsed === 'object' && 'type' in parsed && 'data' in parsed) {
      parsed = typeof parsed.data === 'string' ? JSON.parse(parsed.data) : parsed.data;
    }
    if (parsed.schemaVersion !== 1 || !Array.isArray(parsed.projects) || !Array.isArray(parsed.observations) || !Array.isArray(parsed.jobs)) throw new Error('invalid state');
    migrated = migrateTasks(removeExamples(parsed));
    if (JSON.stringify(migrated) === JSON.stringify(parsed)) return migrated;
  } catch {
    storageWarning.value = '本机资料无法读取，已暂停修改。请重启应用或检查存储权限。';
    return emptyState();
  }
  try { uni.setStorageSync(KEY, JSON.stringify(migrated)); }
  catch { storageWarning.value = '资料升级暂未保存，已暂停修改。仍可查看和导出，请释放空间后重启。'; }
  return migrated;
}
export const forest = ref<ForestState>(load());
export function commit(update: (current: ForestState) => ForestState): void {
  if (storageWarning.value) throw new Error(storageWarning.value);
  const next = update(forest.value);
  if (next === forest.value) return;
  try { uni.setStorageSync(KEY, JSON.stringify(next)); }
  catch { throw new Error('本机存储空间不足，未保存修改。请释放空间后重试。'); }
  forest.value = next;
}
export function toastError(error: unknown): void {
  uni.showToast({ title: error instanceof Error ? error.message : '操作失败，请重试', icon: 'none', duration: 3000 });
}
