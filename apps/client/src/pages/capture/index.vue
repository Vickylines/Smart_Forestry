<script setup lang="ts">
import { fieldValue } from '../../services/fields';
import { computed, ref } from 'vue';
import { onLoad, onShow, onUnload } from '@dcloudio/uni-app';
import { forest, commit } from '../../data/store';
import { captureDraft, updateCaptureDraft, saveCaptureDraft, type CaptureDraft, type Photo } from '../../domain/forest';
import { persistPhoto, removeOwnedPhoto, type DraftPhoto } from '../../services/media';
import LocalNotice from '../../components/LocalNotice.vue';
import AppIcon from '../../components/AppIcon.vue';
import PhotoPreview from '../../components/PhotoPreview.vue';
const projectId = ref('');
const saving = ref(false);
const importing = ref(false);
const busy = computed(() => saving.value || importing.value);
const error = ref('');
onLoad(options => { projectId.value = String(options?.projectId || ''); });
const project = computed(() => forest.value.projects.find(item => item.id === projectId.value));
const draft = computed(() => captureDraft(forest.value, projectId.value));
const photos = computed(() => draft.value.photos);
function updateDraft(update: Partial<Omit<CaptureDraft, 'projectId'>>) {
  commit(state => updateCaptureDraft(state, projectId.value, update));
}
function updateField(update: Partial<Omit<CaptureDraft, 'projectId'>>) {
  try { updateDraft(update); } catch (reason) { error.value = reason instanceof Error ? reason.message : '草稿保存失败'; }
}
const samePlant = computed({get: () => draft.value.samePlant, set: value => updateField({samePlant:value})});
const note = computed({get: () => draft.value.note, set: value => updateField({note:value})});
const recordCount = computed(() => samePlant.value && photos.value.length ? 1 : photos.value.length);
function releaseCapture(uri: string) {
  // #ifdef H5
  (window as any).ForestAndroidPreview?.releaseCapture?.(uri);
  // #endif
}
async function importPhoto(photo: DraftPhoto, sourceUri?: string) {
  if (sourceUri && photos.value.some(p => p.sourceUri === sourceUri)) { releaseCapture(sourceUri); return; }
  if (photos.value.length >= 9) throw new Error('每次最多9张，请先保存。');
  const saved = await persistPhoto(photo);
  try { updateDraft({photos:[...photos.value, {...saved, ...(sourceUri ? {sourceUri} : {})}]}); }
  catch (reason) { await removeOwnedPhoto(saved).catch(() => {}); throw reason; }
  // Acknowledge only after both bytes and the draft reference are durable.
  if (sourceUri) releaseCapture(sourceUri);
}
async function recoverPhoto() {
  // #ifdef H5
  if (busy.value || !project.value) return;
  const raw=(window as any).ForestAndroidPreview?.pendingCapture?.();
  if (!raw) return;
  importing.value = true;
  try {
    const photo=JSON.parse(raw);
    if (photo.projectId !== projectId.value) return;
    if (photo.bytes > 20 * 1024 * 1024) { releaseCapture(photo.uri); throw new Error('单张照片请控制在20MB以内'); }
    await importPhoto({...photo,isDemo:false},photo.uri);
  } catch (reason) { error.value=reason instanceof Error ? reason.message : '拍摄恢复失败，请重试'; }
  finally { importing.value = false; }
  // #endif
}
onShow(recoverPhoto);
// #ifdef H5
window.addEventListener('forest-capture-ready',recoverPhoto);
onUnload(()=>window.removeEventListener('forest-capture-ready',recoverPhoto));
// #endif
function changeGrouping(event: Event) { samePlant.value = Boolean((event as unknown as {detail:{value:boolean}}).detail.value); }

function choose(source: 'album' | 'camera') {
  if (busy.value) return;
  error.value = '';
  // #ifdef H5
  const raw = (window as any).ForestAndroidPreview?.pendingCapture?.();
  if (raw) {
    try {
      const pending = JSON.parse(raw);
      if (pending.projectId === projectId.value) { void recoverPhoto(); return; }
      const owner = forest.value.projects.find(p => p.id === pending.projectId);
      if (owner) {
        uni.showModal({title:'照片尚未保存',content:'请先返回“'+owner.name+'”保存上一张照片。',confirmText:'返回处理',success:result=>{
          if (result.confirm) uni.navigateTo({url:'/pages/capture/index?projectId='+encodeURIComponent(owner.id)});
        }});
        return;
      }
      releaseCapture(pending.uri);
      return;
    } catch { error.value='拍摄恢复失败，请重启应用'; return; }
  }
  if (source==='camera') (window as any).ForestAndroidPreview?.setCaptureProject?.(projectId.value);
  // #endif
  if (photos.value.length >= 9) { error.value = '每次最多9张，请先保存。'; return; }
  importing.value = true;
  uni.chooseImage({
    count: source === 'camera' ? 1 : 9 - photos.value.length,
    sizeType:['compressed'], sourceType:[source],
    success: async result => {
      const files = result.tempFiles as Array<{path:string;size:number;name?:string}>;
      const selected = files.map((file,index) => ({uri:file.path,name:file.name || '植物照片 ' + (photos.value.length + index + 1),bytes:file.size,isDemo:false}));
      try {
        // The native URI remains recoverable across renderer loss. Do not tie a
        // camera draft to the temporary WebView File returned by the chooser.
        // #ifdef H5
        const raw = source === 'camera' && (window as any).ForestAndroidPreview?.pendingCapture?.();
        if (raw) {
          const pending = JSON.parse(raw);
          if (pending.projectId === projectId.value) { await importPhoto({...pending,isDemo:false},pending.uri); return; }
        }
        // #endif
        for (const photo of selected.slice(0,9-photos.value.length)) {
          if (photo.bytes > 20 * 1024 * 1024) { error.value='已跳过大于20MB的照片。'; continue; }
          await importPhoto(photo);
        }
      } catch (reason) { error.value = reason instanceof Error ? reason.message : '照片保存失败，请重试'; }
      finally { importing.value = false; void recoverPhoto(); }
    },
    fail: result => {
      importing.value = false;
      if (!result.errMsg?.toLowerCase().includes('cancel')) error.value = '无法读取照片，请检查相机或相册权限后重试。';
      void recoverPhoto();
    },
  });
}
async function removePhoto(photo: Photo) {
  if (busy.value) return;
  try {
    updateDraft({photos:photos.value.filter(p => p.id !== photo.id)});
    await removeOwnedPhoto(photo);
  } catch (reason) { error.value = reason instanceof Error ? reason.message : '照片移除失败'; }
}
async function save() {
  if (busy.value) return;
  error.value = '';
  if (!photos.value.length) { error.value = '请先选择照片。'; return; }
  saving.value = true;
  try {
    commit(state => saveCaptureDraft(state, projectId.value));
    uni.switchTab({url:'/pages/tasks/index'});
  } catch (reason) {
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
      <view class="row picker-actions"><button role="button" :aria-disabled="busy" :tabindex="busy ? -1 : 0" hover-class="control-pressed" :hover-start-time="0" :hover-stay-time="60" class="primary grow" @click="choose('album')" :disabled="busy" data-testid="choose-photos">选择照片</button><button role="button" :aria-disabled="busy" :tabindex="busy ? -1 : 0" hover-class="control-pressed" :hover-start-time="0" :hover-stay-time="60" class="secondary grow" @click="choose('camera')" :disabled="busy" data-testid="take-photo">拍照</button></view>
    </view>
    <view v-if="photos.length" class="section">
      <view class="row between"><text class="section-title">已选 {{ photos.length }} 张</text><text class="small muted">最多 9 张</text></view>
      <view class="photo-grid">
        <view v-for="(photo,index) in photos" :key="photo.id" class="photo-cell">
          <PhotoPreview :photo="photo" />
          <button role="button" :aria-disabled="busy" :tabindex="busy ? -1 : 0" hover-class="control-pressed" :hover-start-time="0" :hover-stay-time="60" class="remove-photo" :aria-label="'移除第' + (index + 1) + '张照片'" @click="removePhoto(photo)" :disabled="busy"><view class="remove-symbol"><AppIcon name="close" :size="16" /></view></button>
          <text class="photo-index">{{ index + 1 }}</text>
        </view>
      </view>
      <view class="grouping card padded">
        <view class="row between"><view class="grow"><text class="group-title">同一株植物</text><text class="subtitle small">合为一条观察</text></view><switch :checked="samePlant" :disabled="busy" color="#236447" @change="changeGrouping" aria-label="同一株植物" /></view>
      </view>
    </view>
    <text class="field-label">调查备注（选填）</text>
    <textarea v-model="note" @blur="note = fieldValue($event)" class="field textarea" :disabled="busy" :maxlength="500" placeholder="补充位置或植物特征" aria-label="调查备注" data-testid="capture-note" />
    <view v-if="error" class="error-notice" role="alert" data-testid="capture-error">{{ error }}</view>
    <view class="save-section">
      <text class="subtitle small">{{ photos.length }} 张照片 · {{ recordCount }} 条观察</text>
      <button role="button" :aria-disabled="busy || !photos.length" :tabindex="(busy || !photos.length) ? -1 : 0" hover-class="control-pressed" :hover-start-time="0" :hover-stay-time="60" class="primary wide" @click="save" :disabled="busy || !photos.length" :loading="saving" data-testid="save-observations">{{ saving ? '保存中…' : '保存观察' }}</button>
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
.photo-grid { display:grid; grid-template-columns:repeat(3,minmax(0,1fr)); gap:10px; margin:18px 0; }
.photo-cell { position:relative; height:110px; border-radius:13px; overflow:hidden; background:var(--control); }
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
