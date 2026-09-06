<script setup lang="ts">
import { computed } from 'vue';
import { forest, toastError } from '../../data/store';
import { activeJob, runRecognition, pauseRecognition } from '../../services/recognition';
import type { Job } from '../../domain/forest';
import {directConfigured} from '../../services/baidu';
import LocalNotice from '../../components/LocalNotice.vue';
const running = computed(() => forest.value.jobs.filter(item => item.status === 'running').length);
const labels:Record<Job['status'],string>={queued:'待识别',running:'处理中',paused:'已暂停',failed:'未完成',completed:'已完成'};
function configure(){uni.switchTab({url:'/pages/settings/index'});}
function start(id:string){
  if(!directConfigured.value){configure();return;}
  uni.showModal({title:'提交百度识图',content:'将照片上传至百度，消耗接口额度。结果需人工复核。',confirmText:'开始识别',success:async result=>{
    if(result.confirm)try{await runRecognition(id);}catch(e){toastError(e);}
  }});
}
function photoProgress(job:Job){
  const items=forest.value.observations.filter(o=>job.observationIds.includes(o.id));
  const total=items.reduce((n,o)=>n+o.photos.length,0);
  const done=items.reduce((n,o)=>n+o.photos.filter(p=>o.recognitionPhotos?.[p.id]).length,0);
  return {total,done};
}
function openProject(id: string) { uni.navigateTo({url:'/pages/project/index?id=' + encodeURIComponent(id)}); }
function goProjects() { uni.switchTab({url:'/pages/projects/index'}); }
</script>
<template>
  <view class="page root-page">
    <text class="page-title">批量任务</text>
    <text class="subtitle">{{ running ? running + ' 项处理中' : forest.jobs.length + ' 项任务' }}</text>
    <LocalNotice />
    <view v-if="!forest.jobs.length" class="card empty"><text>暂无任务</text><text class="subtitle">添加照片后，可在此查看。</text><button role="button" tabindex="0" hover-class="control-pressed" :hover-start-time="0" :hover-stay-time="60" class="plain section" @click="goProjects">前往调查</button></view>
    <view v-for="job in forest.jobs" :key="job.id" class="card padded job-card" :data-testid="'job-' + job.id">
      <view class="row between"><text class="job-title">{{ forest.projects.find(item => item.id === job.projectId)?.name || '调查项目' }}</text><text class="badge" :class="job.status === 'completed' ? 'status-confirmed' : 'status-pending'">{{labels[job.status]}}</text></view>
      <view class="progress-track" role="progressbar" :aria-valuenow="job.processed" :aria-valuemin="0" :aria-valuemax="job.observationIds.length" aria-label="任务进度"><view class="progress-fill" :style="{transform:'scaleX(' + (job.processed / Math.max(1,job.observationIds.length)) + ')'}"></view></view>
      <view class="row between"><text class="small muted">{{ job.processed }} / {{ job.observationIds.length }} 条观察</text><text class="small muted">{{ new Date(job.createdAt).toLocaleTimeString('zh-CN',{hour:'2-digit',minute:'2-digit'}) }}</text></view>
      <view v-if="job.engine==='service'">
        <text class="subtitle small">已识别 {{photoProgress(job).done}} / {{photoProgress(job).total}} 张照片</text>
        <text v-if="job.error" class="error-notice">{{job.error}}</text>
        <button v-if="activeJob===job.id" class="secondary wide section" @click="pauseRecognition">暂停识别</button>
        <button v-else-if="job.status!=='completed'" class="primary wide section" :disabled="!!activeJob" @click="start(job.id)" data-testid="start-recognition">{{!directConfigured?'设置密钥':job.status==='queued'?'开始识别':'继续识别'}}</button>
        </view>
      <button role="button" tabindex="0" hover-class="control-pressed" :hover-start-time="0" :hover-stay-time="60" class="plain job-link" @click="openProject(job.projectId)" data-testid="job-open-project">查看结果</button>
    </view>
  </view>
</template>
<style scoped>
.job-card { margin-bottom:16px; }
.job-title { font-size:1rem; font-weight:600; flex:1; min-width:0; overflow-wrap:anywhere; }
.progress-track { height:5px; background:var(--control); border-radius:4px; margin:24px 0 12px; overflow:hidden; }
.progress-fill { width:100%; height:100%; background:var(--accent); border-radius:4px; transform-origin:left center; transition:transform .24s ease-out; }
.page .job-link { margin-top:16px; padding:12px 0 0; font-size:.875rem; justify-content:flex-start; border-radius:0; border-top:1px solid var(--separator); }
.service-pending { display:block; margin-top:16px; font-size:.8125rem; line-height:1.7; color:#815b17; }
</style>
