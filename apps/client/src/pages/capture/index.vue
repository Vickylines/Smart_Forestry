<script setup lang="ts">
import { fieldValue } from '../../services/fields';
import { computed, ref } from 'vue';
import { onLoad, onShow, onUnload } from '@dcloudio/uni-app';
import { forest, commit } from '../../data/store';
import { addBatch, type Photo } from '../../domain/forest';
import { persistPhoto, removeOwnedPhoto, type DraftPhoto } from '../../services/media';
import LocalNotice from '../../components/LocalNotice.vue';
import AppIcon from '../../components/AppIcon.vue';
const projectId = ref('');
const photos = ref<DraftPhoto[]>([]);
const samePlant = ref(false);
const saving = ref(false);
const error = ref('');
const note = ref('');
onLoad(options => { projectId.value = String(options?.projectId || ''); });
const project = computed(() => forest.value.projects.find(item => item.id === projectId.value));
const recordCount = computed(() => samePlant.value && photos.value.length ? 1 : photos.value.length);
function recoverPhoto() {
  // #ifdef H5
  const raw=(window as any).ForestAndroidPreview?.pendingCapture?.();
  if (!raw) return;
  try {
    const photo=JSON.parse(raw);
    if (photo.projectId===projectId.value && !photos.value.some(p=>p.uri===photo.uri)) photos.value.push({...photo,isDemo:false});
  } catch { error.value='拍摄恢复失败，请重新拍照'; }
  // #endif
}
onShow(recoverPhoto);
// #ifdef H5
window.addEventListener('forest-capture-ready',recoverPhoto);
onUnload(()=>window.removeEventListener('forest-capture-ready',recoverPhoto));
// #endif
function changeGrouping(event: Event) { samePlant.value = Boolean((event as unknown as {detail:{value:boolean}}).detail.value); }

function choose(source: 'album' | 'camera') {
  if (saving.value) return;
  error.value = '';
  // #ifdef H5
  if (source==='camera') (window as any).ForestAndroidPreview?.setCaptureProject?.(projectId.value);
  // #endif
  if (photos.value.length >= 9) { error.value = '每次最多9张，请先保存。'; return; }
  uni.chooseImage({
    count: source === 'camera' ? 1 : 9 - photos.value.length,
    sizeType:['compressed'], sourceType:[source],
    success: result => {
      const files = result.tempFiles as Array<{path:string;size:number;name?:string}>;
      const selected = files.map((file,index) => ({uri:file.path,name:file.name || '植物照片 ' + (photos.value.length + index + 1),bytes:file.size,isDemo:false}));
      const oversized = selected.filter(file => file.bytes > 20 * 1024 * 1024);
      photos.value = [...photos.value, ...selected.filter(file => file.bytes <= 20 * 1024 * 1024)].slice(0,9);
      if (oversized.length) error.value = '已跳过大于20MB的照片。';
    },
    fail: result => { if (!result.errMsg?.toLowerCase().includes('cancel')) error.value = '无法读取照片，请检查相机或相册权限后重试。'; },
  });
}
async function save() {
  if (saving.value) return;
  error.value = '';
  if (!photos.value.length) { error.value = '请先选择照片。'; return; }
  saving.value = true;
  const saved: Photo[] = [];
  let committed = false;
  try {
    for (const photo of photos.value) saved.push(await persistPhoto(photo));
    commit(state => addBatch(state, projectId.value, saved, samePlant.value, false, note.value));
    committed = true;
    uni.switchTab({url:'/pages/tasks/index'});
  } catch (reason) {
    if (!committed) await Promise.allSettled(saved.map(removeOwnedPhoto));
    error.value = reason instanceof Error ? reason.message : '保存失败，请重试';
  } finally { saving.value = false; }
}
</script>
<template>
  <view v-if="project" class="page">
    <text class="page-title">添加观察</text>
    <text class="subtitle">{{ project.name }}</text>
    <LocalNotice />
    <view class="capture-zone section">
      <view class="capture-focus"><AppIcon name="camera" :size="32" /></view>
      <text class="capture-title">添加植物照片</text>
      <text class="subtitle">拍清叶片、花或果实。</text>
      <view class="row picker-actions"><button role="button" :aria-disabled="saving" :tabindex="(saving) ? -1 : 0" hover-class="control-pressed" :hover-start-time="0" :hover-stay-time="60" class="primary grow" @click="choose('album')" :disabled="saving" data-testid="choose-photos">选择照片</button><button role="button" :aria-disabled="saving" :tabindex="(saving) ? -1 : 0" hover-class="control-pressed" :hover-start-time="0" :hover-stay-time="60" class="secondary grow" @click="choose('camera')" :disabled="saving" data-testid="take-photo">拍照</button></view>
    </view>
    <view v-if="photos.length" class="section">
      <view class="row between"><text class="section-title">已选 {{ photos.length }} 张</text><text class="small muted">最多 9 张</text></view>
      <view class="photo-grid">
        <view v-for="(photo,index) in photos" :key="photo.uri" class="photo-cell">
          <image :src="photo.uri" mode="aspectFill" class="selected-photo" />
          <button role="button" :aria-disabled="saving" :tabindex="(saving) ? -1 : 0" hover-class="control-pressed" :hover-start-time="0" :hover-stay-time="60" class="remove-photo" :aria-label="'移除第' + (index + 1) + '张照片'" @click="photos.splice(index,1)" :disabled="saving"><view class="remove-symbol"><AppIcon name="close" :size="16" /></view></button>
          <text class="photo-index">{{ index + 1 }}</text>
        </view>
      </view>
      <view class="grouping card padded">
        <view class="row between"><view class="grow"><text class="group-title">同一株植物</text><text class="subtitle small">合为一条观察</text></view><switch :checked="samePlant" :disabled="saving" color="#236447" @change="changeGrouping" aria-label="同一株植物" /></view>
      </view>
    </view>
    <text class="field-label">调查备注（选填）</text>
    <textarea v-model="note" @blur="note = fieldValue($event)" class="field textarea" :disabled="saving" :maxlength="500" placeholder="补充位置或植物特征" aria-label="调查备注" data-testid="capture-note" />
    <view v-if="error" class="error-notice" role="alert" data-testid="capture-error">{{ error }}</view>
    <view class="save-section">
      <text class="subtitle small">{{ photos.length }} 张照片 · {{ recordCount }} 条观察</text>
      <button role="button" :aria-disabled="saving || !photos.length" :tabindex="(saving || !photos.length) ? -1 : 0" hover-class="control-pressed" :hover-start-time="0" :hover-stay-time="60" class="primary wide" @click="save" :disabled="saving || !photos.length" :loading="saving" data-testid="save-observations">{{ saving ? '保存中…' : '保存观察' }}</button>
    </view>
  </view>
  <view v-else class="page empty">请先选择调查项目</view>
</template>
<style scoped>
.capture-zone { border:1px solid var(--separator); border-radius:22px; padding:28px 20px 16px; text-align:center; background:var(--surface); }
.capture-focus { width:68px; height:68px; margin:0 auto 18px; border-radius:22px; display:flex; align-items:center; justify-content:center; background:var(--tint); }
.capture-title { display:block; font-size:1.125rem; font-weight:600; }
.capture-zone .subtitle { font-size:.875rem; }
.picker-actions { margin-top:24px; flex-wrap:wrap; }
.page .sample-button { margin:12px auto 0; font-size:.8125rem; font-weight:500; }
.photo-grid { display:grid; grid-template-columns:repeat(3,minmax(0,1fr)); gap:10px; margin:18px 0; }
.photo-cell { position:relative; height:110px; border-radius:13px; overflow:hidden; background:var(--control); }
.selected-photo { width:100%; height:100%; }
.page .remove-photo { position:absolute; top:0; right:0; width:44px; height:44px; padding:0; border-radius:0; background:transparent; }
.remove-symbol { display:flex; align-items:center; justify-content:center; width:27px; height:27px; border-radius:50%; background:#fff; box-shadow:0 1px 4px #152e2920; }
.photo-index { position:absolute; left:8px; bottom:8px; background:#294337; color:#fff; padding:2px 7px; border-radius:5px; font-size:.75rem; }
.group-title { font-size:.9375rem; font-weight:500; }
.grouping .subtitle { margin-top:4px; }
.save-section { margin-top:24px; }
.save-section .primary { margin-top:12px; }
@media (min-width:700px) { .photo-cell { height:180px; } }
@media (prefers-contrast:more) { .capture-zone { border-color:#829187; } }
</style>
