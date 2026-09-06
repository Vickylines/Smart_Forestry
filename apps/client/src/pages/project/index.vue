<script setup lang="ts">
import { computed, ref } from 'vue';
import { onLoad } from '@dcloudio/uni-app';
import { forest, toastError } from '../../data/store';
import { projectStats, displayName, reviewLabels, exportProjectCsv } from '../../domain/forest';
import PhotoPreview from '../../components/PhotoPreview.vue';
import LocalNotice from '../../components/LocalNotice.vue';
import AppIcon from '../../components/AppIcon.vue';
import { saveCsvFile } from '../../services/media';
import { projectArchive, saveBlobFile } from '../../services/archive';
import { removeProject } from '../../services/projects';
import { activeJob } from '../../services/recognition';
const exporting = ref(false);
const deleting = ref(false);
const id = ref('');
const filter = ref('all');
const query = ref('');
onLoad(options => { id.value = String(options?.id || ''); });
const project = computed(() => forest.value.projects.find(item => item.id === id.value));
const stats = computed(() => projectStats(forest.value, id.value));
const busy = computed(() => exporting.value || deleting.value || forest.value.jobs.some(j => j.projectId===id.value && (j.id===activeJob.value || j.status==='running')));
const records = computed(() => forest.value.observations.filter(item => item.projectId === id.value)
  .filter(item => filter.value === 'all' || item.reviewStatus === filter.value)
  .filter(item => (displayName(item) + ' ' + item.confirmedScientificName + ' ' + item.id).toLowerCase().includes(query.value.trim().toLowerCase())));
function capture() { uni.navigateTo({ url: '/pages/capture/index?projectId=' + encodeURIComponent(id.value) }); }
function openObservation(observationId: string) { uni.navigateTo({ url: '/pages/observation/index?id=' + encodeURIComponent(observationId) }); }
function goProjects() { uni.switchTab({url:'/pages/projects/index'}); }
function confirmDelete() {
  if (busy.value || !project.value) return;
  uni.showModal({title:'删除项目？',content:'“'+project.value.name+'”及其 '+stats.value.observations+' 条观察、'+stats.value.photos+' 张本机照片将被删除，无法恢复。请先导出需要的资料。',confirmText:'删除',confirmColor:'#b1382e',success:async result=>{
    if (!result.confirm || busy.value) return;
    deleting.value=true;
    try {
      const cleaned=await removeProject(id.value);
      goProjects();
      uni.showToast({title:cleaned?'项目已删除':'项目已删除，部分照片清理失败',icon:'none'});
    } catch(e) { toastError(e); }
    finally { deleting.value=false; }
  }});
}
async function exportCsv() {
  if(exporting.value)return;exporting.value=true;
  try { await saveCsvFile(exportProjectCsv(forest.value, id.value), '植物调查-' + new Date().toISOString().slice(0, 10)); }
  catch (error) { toastError(error); }finally{exporting.value=false;}
}
async function exportPackage() {
  if(exporting.value)return;
  exporting.value=true;
  try {const snapshot=JSON.parse(JSON.stringify(forest.value));const blob=await projectArchive(snapshot,id.value);await saveBlobFile(blob,'植物调查-'+new Date().toISOString().slice(0,10)+'.zip');}
  catch(error){toastError(error);}finally{exporting.value=false;}
}
</script>
<template>
  <view v-if="project" class="page">
    <text class="page-title">{{ project.name }}</text>
    <text v-if="project.location" class="subtitle">{{ project.location }}</text>
    <LocalNotice />
    <view class="stats">
      <view><text class="stat-number">{{ stats.observations }}</text><text class="stat-label">观察记录</text></view>
      <view><text class="stat-number">{{ stats.species }}</text><text class="stat-label">确认名称</text></view>
      <view><text class="stat-number">{{ stats.pending }}</text><text class="stat-label">待复核</text></view>
    </view>
    <view class="row action-row"><button role="button" tabindex="0" hover-class="control-pressed" :hover-start-time="0" :hover-stay-time="60" class="primary grow" @click="capture" data-testid="add-observation">＋ 添加观察</button><button role="button" tabindex="0" hover-class="control-pressed" :hover-start-time="0" :hover-stay-time="60" class="secondary" @click="exportCsv" data-testid="export-csv">导出 CSV</button></view>
    <view class="section"><input v-model="query" class="field search-field" placeholder="搜索名称或编号" aria-label="搜索观察记录" data-testid="search-records" /></view>
    <view class="filter-row" role="group" aria-label="按复核状态筛选">
      <button role="button" tabindex="0" hover-class="control-pressed" :hover-start-time="0" :hover-stay-time="60" v-for="entry in [{key:'all',label:'全部'},{key:'pending',label:'待复核'},{key:'confirmed',label:'已确认'},{key:'undetermined',label:'暂未确定'}]" :key="entry.key" class="filter" :class="{active:filter === entry.key}" :aria-pressed="filter === entry.key" @click="filter = entry.key" :data-testid="'filter-' + entry.key">{{ entry.label }}</button>
    </view>
    <view v-if="!records.length" class="card empty" data-testid="empty-records">{{ stats.observations ? '没有匹配的记录' : '暂无观察' }}<text class="subtitle">{{ stats.observations ? '试试其他筛选。' : '添加照片，开始调查。' }}</text></view>
    <view class="records">
      <button role="button" tabindex="0" hover-class="control-pressed" :hover-start-time="0" :hover-stay-time="60" v-for="item in records" :key="item.id" class="record-card" @click="openObservation(item.id)" :data-testid="'observation-' + item.id">
        <view class="record-photo"><PhotoPreview :photo="item.photos[0]" /></view>
        <view class="record-info">
          <text class="record-name">{{ displayName(item) }}</text>
          <text v-if="item.confirmedScientificName || item.candidates[0]?.scientificName" class="record-latin">{{ item.confirmedScientificName || item.candidates[0]?.scientificName }}</text>
          <view class="record-meta"><text class="badge" :class="'status-' + item.reviewStatus">{{ reviewLabels[item.reviewStatus] }}</text><text>{{ item.photos.length }} 张</text></view>
        </view>
        <AppIcon name="chevron" :size="16" />
      </button>
    </view>
    <button role="button" tabindex="0" class="secondary wide section" :disabled="exporting || !stats.observations" @click="exportPackage" data-testid="export-package">{{ exporting ? '正在准备与保存…' : '导出照片和表格' }}</button>
    <button role="button" tabindex="0" class="plain danger wide section" :disabled="busy" @click="confirmDelete" data-testid="delete-project">{{deleting?'删除中…':'删除项目'}}</button>
  </view>
  <view v-else class="page empty">项目不存在<button role="button" tabindex="0" hover-class="control-pressed" :hover-start-time="0" :hover-stay-time="60" class="plain" @click="goProjects">返回调查项目</button></view>
</template>
<style scoped>
.action-row { align-items:stretch; flex-wrap:wrap; }
.action-row .primary { flex:1 1 9em; }
.action-row .secondary { flex:1 1 7em; }
.action-row .secondary { padding:14px; }
.search-field { background:var(--control); border-color:transparent; }
.records { display:flex; flex-direction:column; gap:12px; }
.page .record-card { display:flex; width:100%; text-align:left; background:var(--surface); border:1px solid var(--separator); padding:14px; border-radius:18px; gap:12px; font-weight:400; }
.record-photo { width:72px; height:86px; flex-shrink:0; overflow:hidden; border-radius:11px; }
.record-info { flex:1; min-width:0; }
.record-name { display:block; font-size:1rem; font-weight:600; overflow-wrap:anywhere; }
.record-latin { display:block; font-size:.8125rem; color:var(--secondary); font-style:italic; margin-top:4px; overflow-wrap:anywhere; }
.record-meta { display:flex; align-items:center; flex-wrap:wrap; gap:8px; font-size:.75rem; color:var(--secondary); margin-top:10px; }
@media (min-width:700px) { .records { display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); } }
@media (max-width:350px) { .page .record-card { padding:12px; gap:8px; } .record-photo { width:62px; height:80px; } }
</style>
