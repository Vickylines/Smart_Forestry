<script setup lang="ts">
import { computed, ref } from 'vue';
import { forest, commit } from '../../data/store';
import { makeProject, projectStats } from '../../domain/forest';
import LocalNotice from '../../components/LocalNotice.vue';
import AppIcon from '../../components/AppIcon.vue';
const creating = ref(false);
const name = ref('');
const location = ref('');
const validation = ref('');
const stats = computed(() => projectStats(forest.value));
function createProject() {
  validation.value = '';
  try {
    commit(state => makeProject(state, name.value, location.value));
    const id = forest.value.projects[0].id;
    name.value = ''; location.value = ''; creating.value = false;
    uni.navigateTo({ url: '/pages/project/index?id=' + encodeURIComponent(id) });
  } catch (error) {
    validation.value = error instanceof Error ? error.message : '创建失败';
  }
}
function toggleCreating() { creating.value = !creating.value; validation.value = ''; }
function openProject(id: string) { uni.navigateTo({ url: '/pages/project/index?id=' + encodeURIComponent(id) }); }
</script>

<template>
  <view class="page root-page">
    <view class="row between home-heading">
      <view class="grow"><text class="page-title">智慧林业</text></view>
      <view class="app-mark" aria-hidden="true"><AppIcon name="leaf" :size="30" /></view>
    </view>
    <LocalNotice />
    <view v-if="forest.projects.length" class="stats overview-stats">
      <view><text class="stat-number">{{ forest.projects.length }}</text><text class="stat-label">调查项目</text></view>
      <view><text class="stat-number">{{ stats.observations }}</text><text class="stat-label">观察记录</text></view>
      <view><text class="stat-number">{{ stats.pending }}</text><text class="stat-label">待复核</text></view>
    </view>
    <view class="row between section-heading">
      <text class="section-title">调查项目</text>
      <button role="button" tabindex="0" hover-class="control-pressed" :hover-start-time="0" :hover-stay-time="60" class="primary new-project" @click="toggleCreating" :aria-expanded="creating" aria-controls="project-form" data-testid="new-project"><AppIcon name="plus" :size="18" />新建项目</button>
    </view>
    <view v-if="creating" id="project-form" class="card padded project-form" data-testid="project-form">
      <view class="row between"><text class="section-title">新建项目</text><button role="button" tabindex="0" hover-class="control-pressed" :hover-start-time="0" :hover-stay-time="60" class="plain" @click="creating = false">取消</button></view>
      <text class="field-label">项目名称</text>
      <input v-model="name" class="field" placeholder="例如：公园植物调查" :maxlength="40" aria-label="项目名称" data-testid="project-name" />
      <text class="field-label">调查地点（选填）</text>
      <input v-model="location" class="field" placeholder="校园、公园或样地名称" :maxlength="80" aria-label="调查地点" data-testid="project-location" @confirm="createProject" />
      <view v-if="validation" class="error-notice" role="alert">{{ validation }}</view>
      <button role="button" tabindex="0" hover-class="control-pressed" :hover-start-time="0" :hover-stay-time="60" class="primary wide section" @click="createProject" data-testid="create-project">创建项目</button>
    </view>
    <view class="project-list">
      <button role="button" tabindex="0" hover-class="control-pressed" :hover-start-time="0" :hover-stay-time="60" v-for="project in forest.projects" :key="project.id" class="project-card" @click="openProject(project.id)" :data-testid="'project-' + project.id">
        <view class="row project-card-heading">
          <view class="project-symbol" aria-hidden="true"><AppIcon name="folder" :size="22" /></view>
          <view class="grow"><text class="project-name">{{ project.name }}</text><text v-if="project.location" class="project-location">{{ project.location }}</text></view>
          <AppIcon name="chevron" :size="18" />
        </view>
        <view class="row between project-foot">
          <text>{{ projectStats(forest, project.id).observations }} 条观察<text class="meta-dot">·</text>{{ projectStats(forest, project.id).photos }} 张照片</text>
          <text class="small muted">{{ projectStats(forest, project.id).pending }} 条待复核</text>
        </view>
      </button>
    </view>
    <view v-if="!forest.projects.length && !creating" class="empty home-empty" data-testid="empty-projects">
      <view class="empty-icon"><AppIcon name="folder" :size="36" /></view>
      <text class="section-title">开始一场植物调查</text>
      <text class="subtitle">新建项目，记录身边的植物。</text>
    </view>
  </view>
</template>

<style scoped>
.home-empty { padding:64px 20px; }
.empty-icon { display:flex; justify-content:center; margin-bottom:20px; }
.home-heading { align-items:center; }
.app-mark { width:56px; height:56px; display:flex; align-items:center; justify-content:center; border-radius:18px; background:var(--tint); }
.overview-stats { padding:28px 0; margin-top:8px; border-bottom:1px solid var(--separator); }
.overview-stats > view + view { padding-left:20px; border-left:1px solid var(--separator); }
.section-heading { margin:24px 0 16px; flex-wrap:wrap; }
.page .new-project { flex-shrink:0; padding:11px 14px; font-size:.875rem; border-radius:12px; }
.project-form { margin-bottom:16px; }
.project-list { display:flex; flex-direction:column; gap:14px; }
.page .project-card { display:block; width:100%; text-align:left; padding:20px; border:1px solid var(--separator); background:var(--surface); border-radius:20px; font-weight:400; }
.project-card-heading { align-items:flex-start; }
.project-symbol { flex-shrink:0; display:flex; align-items:center; justify-content:center; width:42px; height:42px; border-radius:12px; background:var(--tint); }
.project-name { display:block; font-size:1.0625rem; line-height:1.45; font-weight:600; overflow-wrap:anywhere; }
.project-location { display:block; color:var(--secondary); font-size:.8125rem; margin-top:4px; line-height:1.6; overflow-wrap:anywhere; }
.project-foot { margin-top:18px; padding-top:14px; border-top:1px solid var(--separator); color:var(--secondary); font-size:.8125rem; flex-wrap:wrap; }
.meta-dot { margin:0 8px; }
.field-tip { display:flex; align-items:flex-start; gap:12px; margin-top:28px; padding:4px; }
.tip-title { display:block; font-size:.9375rem; font-weight:500; }
.field-tip .subtitle { margin-top:4px; }
.local-caption { margin-top:28px; padding-top:20px; border-top:1px solid var(--separator); color:var(--secondary); font-size:.8125rem; }
.local-caption .row { gap:6px; }
.local-caption .subtitle { margin-top:6px; }
@media (min-width:700px) { .project-list { display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); } .overview-stats { max-width:520px; } }
@media (max-width:350px) { .page .project-card { padding:16px; } .overview-stats > view + view { padding-left:12px; } .project-symbol { width:36px; height:36px; } }
</style>
