<script setup lang="ts">
import { fieldValue } from '../../services/fields';
import { computed, ref, watch } from 'vue';
import { onLoad } from '@dcloudio/uni-app';
import { forest, commit } from '../../data/store';
import { displayName, reviewLabels, saveReview, observationTaxonomy, taxonomyText, type Candidate, type ReviewStatus } from '../../domain/forest';
import PhotoPreview from '../../components/PhotoPreview.vue';
import LocalNotice from '../../components/LocalNotice.vue';
import { enrichObservation, lookupTaxonomy, taxonomyBusy } from '../../services/taxonomy';
import { taxonomyKey, taxonomyMessage } from '../../domain/taxonomy';
const id = ref('');
const name = ref('');
const scientificName = ref('');
const family = ref('');
const genus = ref('');
const note = ref('');
const revision = ref(0);
const selectedPhoto = ref(0);
const decision = ref<ReviewStatus>('confirmed');
const error = ref('');
const checking = ref(false);
const lookupMessage = ref('');
let selectedKey = '', pristine = '';
const fingerprint = () => JSON.stringify([name.value,scientificName.value,family.value,genus.value,decision.value]);
onLoad(options => {
  id.value = String(options?.id || '');
  selectedPhoto.value = Math.max(0,forest.value.observations.find(o=>o.id===id.value)?.photos.findIndex(p=>p.id===options?.photoId) ?? 0);
});
const observation = computed(() => forest.value.observations.find(item => item.id === id.value));
watch(() => observation.value?.id, () => {
  const item = observation.value;
  if (!item) return;
  const identified = item.reviewStatus === 'confirmed';
  name.value = identified ? item.confirmedName : item.candidates[0]?.name || '';
  scientificName.value = identified ? item.confirmedScientificName : item.candidates[0]?.scientificName || item.candidates[0]?.taxonomyScientificName || '';
  const taxonomy = observationTaxonomy(item);
  family.value = taxonomy.family || ''; genus.value = taxonomy.genus || '';
  note.value = item.note; revision.value = item.revision;
  decision.value = item.reviewStatus === 'undetermined' ? 'undetermined' : 'confirmed';
  selectedKey = identified ? '' : taxonomyKey(item.candidates[0]?.name || '',item.candidates[0]?.scientificName || '');
  pristine = fingerprint();
  void enrichObservation(item.id).catch(reason => { error.value = reason instanceof Error ? reason.message : '补查保存失败'; });
}, {immediate:true});
watch(() => observation.value?.candidates, candidates => {
  if (observation.value?.reviewStatus !== 'pending' || fingerprint() !== pristine) return;
  const candidate = candidates?.find(c => taxonomyKey(c.name,c.scientificName) === selectedKey);
  if (candidate) selectCandidate(candidate);
});
function selectCandidate(candidate: Candidate) {
  name.value = candidate.name; scientificName.value = candidate.scientificName || candidate.taxonomyScientificName || '';
  family.value = candidate.family || ''; genus.value = candidate.genus || '';
  decision.value = 'confirmed';
  selectedKey = taxonomyKey(candidate.name,candidate.scientificName); pristine = fingerprint();
}
async function checkFormTaxonomy() {
  if (checking.value || (!name.value.trim() && !scientificName.value.trim())) return;
  checking.value = true; lookupMessage.value = '正在按名称补查科属…';
  const before = fingerprint(), recordId = id.value;
  try {
    const result = await lookupTaxonomy(name.value,scientificName.value,true);
    if (id.value !== recordId || fingerprint() !== before) { lookupMessage.value = '输入已改变，请按新名称重查'; return; }
    if (result.family) family.value = result.family;
    if (result.genus) genus.value = result.genus;
    if (!scientificName.value && result.taxonomyScientificName) scientificName.value = result.taxonomyScientificName;
    lookupMessage.value = taxonomyMessage(result) || '已补全，请核对后保存复核';
  } catch { lookupMessage.value = '补查失败，请稍后重试'; }
  finally { checking.value = false; }
}
async function retryTaxonomy() {
  try { await enrichObservation(id.value,true); } catch (reason) { error.value = reason instanceof Error ? reason.message : '补查失败'; }
}
function submitReview() {
  error.value = '';
  try {
    commit(state => saveReview(state,id.value,revision.value,{decision:decision.value,name:name.value,scientificName:scientificName.value,family:family.value,genus:genus.value,note:note.value}));
    revision.value = observation.value?.revision ?? revision.value;
    uni.showToast({title:'复核已保存',icon:'success'});
  } catch (reason) { error.value = reason instanceof Error ? reason.message : '保存失败'; }
}
</script>
<template>
  <view v-if="observation" class="page detail-page">
    <view class="row between"><text class="eyebrow">观察记录</text><text class="badge" :class="'status-' + observation.reviewStatus" data-testid="review-status" aria-live="polite">{{ reviewLabels[observation.reviewStatus] }}</text></view>
    <text class="page-title">{{ displayName(observation) }}</text>
    <text v-if="taxonomyText(observationTaxonomy(observation))" class="subtitle" data-testid="observation-taxonomy">{{ taxonomyText(observationTaxonomy(observation)) }}</text>
    <LocalNotice />
    <view class="detail-photo"><PhotoPreview :photo="observation.photos[selectedPhoto]" /></view>
    <view v-if="observation.photos.length > 1" class="thumbnails">
      <button role="button" tabindex="0" hover-class="control-pressed" :hover-start-time="0" :hover-stay-time="60" v-for="(photo,index) in observation.photos" :key="photo.id" class="thumbnail" :class="{selected:index === selectedPhoto}" :aria-pressed="index === selectedPhoto" @click="selectedPhoto = index" :aria-label="'查看第' + (index + 1) + '张照片'"><PhotoPreview :photo="photo" /></button>
    </view>
    <view v-if="!observation.candidates.length" class="subtitle section">{{observation.recognitionStatus==='succeeded'?(observation.candidates.length?'识别完成，请核对名称。':'未返回植物候选，可补拍或人工填写。'):'可填写名称，或在任务页提交识别。'}}</view>
    <view v-if="observation.candidates.length" class="section">
      <view class="row between"><text class="section-title">识别候选</text><text class="small muted">评分</text></view>
      <button role="button" tabindex="0" hover-class="control-pressed" :hover-start-time="0" :hover-stay-time="60" v-for="(candidate,index) in observation.candidates" :key="candidate.name + index" class="candidate" @click="selectCandidate(candidate)">
        <text class="rank">{{ String(index + 1).padStart(2,'0') }}</text>
        <view class="grow"><text class="candidate-name">{{ candidate.name }}</text><text v-if="candidate.scientificName || candidate.taxonomyScientificName" class="candidate-latin">{{ candidate.scientificName || candidate.taxonomyScientificName }}</text><text class="subtitle small" data-testid="candidate-taxonomy">{{ taxonomyText(candidate) || '科、属待补查' }}</text><text v-if="candidate.taxonomySource" class="subtitle small">{{ candidate.taxonomySource }} · 待核对</text><text v-if="taxonomyMessage(candidate)" class="subtitle small">{{ taxonomyMessage(candidate) }}</text></view>
        <text class="candidate-score">{{ candidate.score.toFixed(2) }}</text>
      </button>
      <text class="subtitle small">评分用于候选排序，请人工核对。</text>
      <text class="subtitle small">科属按名称查询公共分类库；园艺品种可沿用基础种或属的分类，品种本身仍需核对。查不到时可手填。</text>
      <button class="plain" :disabled="taxonomyBusy[id]" @click="retryTaxonomy" data-testid="retry-taxonomy">{{ taxonomyBusy[id] ? '正在补查科属…' : '重新补查科属' }}</button>
    </view>
    <view class="section card padded review-form">
      <text class="section-title">人工复核</text>
      <view class="filter-row" role="group" aria-label="复核决定"><button role="button" tabindex="0" hover-class="control-pressed" :hover-start-time="0" :hover-stay-time="60" class="filter" :class="{active:decision === 'confirmed'}" :aria-pressed="decision === 'confirmed'" @click="decision = 'confirmed'" data-testid="decision-confirm">确认名称</button><button role="button" tabindex="0" hover-class="control-pressed" :hover-start-time="0" :hover-stay-time="60" class="filter" :class="{active:decision === 'undetermined'}" :aria-pressed="decision === 'undetermined'" @click="decision = 'undetermined'" data-testid="decision-unknown">暂未确定</button><button role="button" tabindex="0" hover-class="control-pressed" :hover-start-time="0" :hover-stay-time="60" class="filter" :class="{active:decision === 'pending'}" :aria-pressed="decision === 'pending'" @click="decision = 'pending'">待复核</button></view>
      <view v-if="decision === 'confirmed'">
        <text class="field-label">植物名称</text><input v-model="name" @blur="name = fieldValue($event)" class="field" :maxlength="100" placeholder="填写植物名称" aria-label="植物名称" data-testid="review-name" />
        <text class="field-label">学名（选填）</text><input v-model="scientificName" @blur="scientificName = fieldValue($event)" class="field" :maxlength="180" placeholder="填写规范学名" aria-label="学名" data-testid="review-scientific-name" />
        <button class="plain" :disabled="checking || (!name.trim() && !scientificName.trim())" @click="checkFormTaxonomy" data-testid="lookup-form-taxonomy">{{ checking ? '正在补查…' : '按填写的名称补全科属' }}</button>
        <text v-if="lookupMessage" class="subtitle small" role="status">{{ lookupMessage }}</text>
        <text class="field-label">科（选填）</text><input v-model="family" @blur="family = fieldValue($event)" class="field" :maxlength="100" placeholder="填写科名" aria-label="科" data-testid="review-family" />
        <text class="field-label">属（选填）</text><input v-model="genus" @blur="genus = fieldValue($event)" class="field" :maxlength="100" placeholder="填写属名" aria-label="属" data-testid="review-genus" />
      </view>
      <text class="field-label">备注（选填）</text><textarea v-model="note" @blur="note = fieldValue($event)" class="field textarea" :maxlength="500" placeholder="补充鉴定依据" aria-label="复核备注" data-testid="review-note" />
      <view v-if="error" class="error-notice" role="alert">{{ error }}</view>
      <button role="button" tabindex="0" hover-class="control-pressed" :hover-start-time="0" :hover-stay-time="60" class="primary wide section" @click="submitReview" data-testid="save-review">保存复核</button>
    </view>
    <view class="section metadata"><text class="small muted">记录编号</text><text class="record-id">{{ observation.id }}</text><text class="small muted">{{ observation.photos.length }} 张照片 · {{ new Date(observation.createdAt).toLocaleString('zh-CN') }}</text></view>
    <view v-if="observation.reviews.length" class="section">
      <text class="section-title">复核记录</text>
      <view v-for="(entry,index) in [...observation.reviews].reverse()" :key="index" class="review-log"><view class="row between"><text>{{ reviewLabels[entry.decision] }}{{ entry.name ? ' · ' + entry.name : '' }}</text></view><text v-if="taxonomyText(entry)" class="subtitle small">{{ taxonomyText(entry) }}</text><text class="subtitle small">{{ new Date(entry.at).toLocaleString('zh-CN') }}</text><text v-if="entry.note" class="subtitle small">{{ entry.note }}</text></view>
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
