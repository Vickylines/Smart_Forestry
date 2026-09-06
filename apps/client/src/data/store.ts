import { ref } from 'vue';
import { emptyState, removeExamples, type ForestState } from '../domain/forest';
import { migrateTasks } from '../domain/recognition';

const KEY = 'forest-observer:state:v1';
export const storageWarning = ref('');
function load(): ForestState {
  try {
    const raw = uni.getStorageSync(KEY);
    if (!raw) return emptyState();
    const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
    if (parsed.schemaVersion !== 1 || !Array.isArray(parsed.projects) || !Array.isArray(parsed.observations) || !Array.isArray(parsed.jobs)) throw new Error('invalid state');
    const migrated = migrateTasks(removeExamples(parsed));
    uni.setStorageSync(KEY, JSON.stringify(migrated));
    return migrated;
  } catch {
    storageWarning.value = '本机资料无法读取或保存，已暂停修改。请重启应用或检查剩余空间。';
    return emptyState();
  }
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
