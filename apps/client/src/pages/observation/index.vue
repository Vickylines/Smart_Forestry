<script setup lang="ts">
import { fieldValue } from '../../services/fields';
import { computed, ref, watch } from 'vue';
import { onLoad } from '@dcloudio/uni-app';
import { forest, commit } from '../../data/store';
import { displayName, reviewLabels, saveReview, type ReviewStatus } from '../../domain/forest';
import PhotoPreview from '../../components/PhotoPreview.vue';
import LocalNotice from '../../components/LocalNotice.vue';
const id = ref('');
const name = ref('');
const scientificName = ref('');
const note = ref('');
const revision = ref(0);
const selectedPhoto = ref(0);
const decision = ref<ReviewStatus>('confirmed');
const error = ref('');
onLoad(options => {
  id.value = String(options?.id || '');
  selectedPhoto.value = Math.max(0,forest.value.observations.find(o=>o.id===id.value)?.photos.findIndex(p=>p.id===options?.photoId) ?? 0);
});
const observation = computed(() => forest.value.observations.find(item => item.id === id.value));
watch(() => observation.value?.id, () => {
  const item = observation.value;
  if (!item) return;
  name.value = item.confirmedName || item.candidates[0]?.name || '';
  scientificName.value = item.confirmedScientificName || item.candidates[0]?.scientificName || '';
  note.value = item.note; revision.value = item.revision;
  decision.value = item.reviewStatus === 'undetermined' ? 'undetermined' : 'confirmed';
}, {immediate:true});
function submitReview() {
  error.value = '';
  try {
    commit(state => saveReview(state,id.value,revision.value,{decision:decision.value,name:name.value,scientificName:scientificName.value,note:note.value}));
    revision.value = observation.value?.revision ?? revision.value;
    uni.showToast({title:'复核已保存',icon:'success'});
  } catch (reason) { error.value = reason instanceof Error ? reason.message : '保存失败'; }
}
</script>
<template>
  <view v-if="observation" class="page detail-page">
    <view class="row between"><text class="eyebrow">观察记录</text><text class="badge" :class="'status-' + observation.reviewStatus" data-testid="review-status" aria-live="polite">{{ reviewLabels[observation.reviewStatus] }}</text></view>
    <text class="page-title">{{ displayName(observation) }}</text>
    <LocalNotice />
    <view class="detail-photo"><PhotoPreview :photo="observation.photos[selectedPhoto]" /></view>
    <view v-if="observation.photos.length > 1" class="thumbnails">
      <button role="button" tabindex="0" hover-class="control-pressed" :hover-start-time="0" :hover-stay-time="60" v-for="(photo,index) in observation.photos" :key="photo.id" class="thumbnail" :class="{selected:index === selectedPhoto}" :aria-pressed="index === selectedPhoto" @click="selectedPhoto = index" :aria-label="'查看第' + (index + 1) + '张照片'"><PhotoPreview :photo="photo" /></button>
    </view>
    <view v-if="!observation.candidates.length" class="subtitle section">{{observation.recognitionStatus==='succeeded'?(observation.candidates.length?'识别完成，请核对名称。':'未返回植物候选，可补拍或人工填写。'):'可填写名称，或在任务页提交识别。'}}</view>
    <view v-if="observation.candidates.length" class="section">
      <view class="row between"><text class="section-title">识别候选</text><text class="small muted">评分</text></view>
      <button role="button" tabindex="0" hover-class="control-pressed" :hover-start-time="0" :hover-stay-time="60" v-for="(candidate,index) in observation.candidates" :key="candidate.name + index" class="candidate" @click="name = candidate.name; scientificName = candidate.scientificName; decision = 'confirmed'">
        <text class="rank">{{ String(index + 1).padStart(2,'0') }}</text>
        <view class="grow"><text class="candidate-name">{{ candidate.name }}</text><text class="candidate-latin">{{ candidate.scientificName }}</text></view>
        <text class="candidate-score">{{ candidate.score.toFixed(2) }}</text>
      </button>
      <text class="subtitle small">评分用于候选排序，请人工核对。</text>
    </view>
    <view class="section card padded review-form">
      <text class="section-title">人工复核</text>
      <view class="filter-row" role="group" aria-label="复核决定"><button role="button" tabindex="0" hover-class="control-pressed" :hover-start-time="0" :hover-stay-time="60" class="filter" :class="{active:decision === 'confirmed'}" :aria-pressed="decision === 'confirmed'" @click="decision = 'confirmed'" data-testid="decision-confirm">确认名称</button><button role="button" tabindex="0" hover-class="control-pressed" :hover-start-time="0" :hover-stay-time="60" class="filter" :class="{active:decision === 'undetermined'}" :aria-pressed="decision === 'undetermined'" @click="decision = 'undetermined'" data-testid="decision-unknown">暂未确定</button><button role="button" tabindex="0" hover-class="control-pressed" :hover-start-time="0" :hover-stay-time="60" class="filter" :class="{active:decision === 'pending'}" :aria-pressed="decision === 'pending'" @click="decision = 'pending'">待复核</button></view>
      <view v-if="decision === 'confirmed'">
        <text class="field-label">植物名称</text><input v-model="name" @blur="name = fieldValue($event)" class="field" :maxlength="100" placeholder="填写植物名称" aria-label="植物名称" data-testid="review-name" />
        <text class="field-label">学名（选填）</text><input v-model="scientificName" @blur="scientificName = fieldValue($event)" class="field" :maxlength="180" placeholder="填写规范学名" aria-label="学名" data-testid="review-scientific-name" />
      </view>
      <text class="field-label">备注（选填）</text><textarea v-model="note" @blur="note = fieldValue($event)" class="field textarea" :maxlength="500" placeholder="补充鉴定依据" aria-label="复核备注" data-testid="review-note" />
      <view v-if="error" class="error-notice" role="alert">{{ error }}</view>
      <button role="button" tabindex="0" hover-class="control-pressed" :hover-start-time="0" :hover-stay-time="60" class="primary wide section" @click="submitReview" data-testid="save-review">保存复核</button>
    </view>
    <view class="section metadata"><text class="small muted">记录编号</text><text class="record-id">{{ observation.id }}</text><text class="small muted">{{ observation.photos.length }} 张照片 · {{ new Date(observation.createdAt).toLocaleString('zh-CN') }}</text></view>
    <view v-if="observation.reviews.length" class="section">
      <text class="section-title">复核记录</text>
      <view v-for="(entry,index) in [...observation.reviews].reverse()" :key="index" class="review-log"><view class="row between"><text>{{ reviewLabels[entry.decision] }}{{ entry.name ? ' · ' + entry.name : '' }}</text></view><text class="subtitle small">{{ new Date(entry.at).toLocaleString('zh-CN') }}</text><text v-if="entry.note" class="subtitle small">{{ entry.note }}</text></view>
    </view>
  </view>
  <view v-else class="page empty">观察记录不存在</view>
</template>
<style scoped>
.detail-photo { height:280px; border-radius:22px; overflow:hidden; margin-top:24px; }
.thumbnails { display:flex; flex-wrap:wrap; gap:8px; margin-top:10px; }
.page .thumbnail { width:60px; height:60px; padding:0; border:2px solid transparent; border-radius:10px; overflow:hidden; }
.page .thumbnail.selected { border-color:var(--accent); }
.page .candidate { display:flex; align-items:center; gap:12px; padding:18px; text-align:left; background:var(--surface); border:1px solid var(--separator); border-radius:16px; margin-top:12px; width:100%; font-weight:400; }
.rank { color:var(--secondary); font-size:.875rem; font-variant-numeric:tabular-nums; }
.candidate-name { display:block; font-size:1rem; font-weight:600; }
.candidate-latin { display:block; font-size:.8125rem; color:var(--secondary); font-style:italic; margin-top:5px; overflow-wrap:anywhere; }
.candidate-score { font-size:1.125rem; font-weight:500; color:var(--accent); font-variant-numeric:tabular-nums; }
.record-id { display:block; font-size:.8125rem; margin:8px 0; overflow-wrap:anywhere; }
.review-log { padding:18px 0; border-bottom:1px solid var(--separator); font-size:.875rem; }
.review-log .row { align-items:flex-start; flex-wrap:wrap; }
.review-form .filter-row { margin-top:18px; }
@media (min-width:700px) { .detail-photo { height:350px; } }
</style>
