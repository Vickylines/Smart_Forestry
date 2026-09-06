<script setup lang="ts">
import { computed, ref } from 'vue';
import { onLoad } from '@dcloudio/uni-app';
import { forest } from '../../data/store';
import { displayName, projectStats, reviewLabels } from '../../domain/forest';
import AppIcon from '../../components/AppIcon.vue';
import PhotoPreview from '../../components/PhotoPreview.vue';
import LocalNotice from '../../components/LocalNotice.vue';
const mode = ref('projects'), limit = ref(60);
onLoad(options => { mode.value = ['projects','observations','photos'].includes(String(options?.view)) ? String(options?.view) : 'projects'; });
const title = computed(() => ({projects:'调查项目',observations:'观察记录',photos:'照片'}[mode.value]));
const photos = computed(() => forest.value.observations.flatMap(o => o.photos.map(photo => ({photo,observation:o}))));
const totalBytes = computed(() => photos.value.reduce((sum,item) => sum + item.photo.bytes,0));
const size = computed(() => totalBytes.value < 1048576 ? Math.ceil(totalBytes.value/1024)+' KB' : (totalBytes.value/1048576).toFixed(1)+' MB');
const count = computed(() => mode.value==='projects' ? forest.value.projects.length : mode.value==='observations' ? forest.value.observations.length : photos.value.length);
function openProject(id:string) { uni.navigateTo({url:'/pages/project/index?id='+encodeURIComponent(id)}); }
function openObservation(id:string,photoId='') { uni.navigateTo({url:'/pages/observation/index?id='+encodeURIComponent(id)+'&photoId='+encodeURIComponent(photoId)}); }
function goProjects() { uni.switchTab({url:'/pages/projects/index'}); }
</script>
<template>
  <view class="page" data-testid="library">
    <text class="page-title">{{title}}</text>
    <text class="subtitle">{{count}} {{mode==='projects'?'个':mode==='photos'?'张':'条'}}<text v-if="mode==='photos' && count"> · {{size}}</text></text>
    <LocalNotice />
    <view v-if="!count" class="empty section"><text>暂无{{title}}</text><button role="button" tabindex="0" class="plain section" @click="goProjects">前往调查</button></view>
    <view v-else-if="mode==='projects'" class="section card settings-group">
      <button v-for="p in forest.projects.slice(0,limit)" :key="p.id" role="button" tabindex="0" class="settings-row" @click="openProject(p.id)" data-testid="library-project"><view class="grow"><text>{{p.name}}</text><text class="subtitle small">{{projectStats(forest,p.id).observations}} 条观察</text></view><AppIcon name="chevron" :size="16" /></button>
    </view>
    <view v-else-if="mode==='observations'" class="section card settings-group">
      <button v-for="o in forest.observations.slice(0,limit)" :key="o.id" role="button" tabindex="0" class="settings-row" @click="openObservation(o.id)" data-testid="library-observation"><view class="mini-photo"><PhotoPreview :photo="o.photos[0]" /></view><view class="grow"><text>{{displayName(o)}}</text><text class="subtitle small">{{forest.projects.find(p=>p.id===o.projectId)?.name}}</text></view><text class="badge" :class="'status-'+o.reviewStatus">{{reviewLabels[o.reviewStatus]}}</text></button>
    </view>
    <view v-else class="section photo-library">
      <button v-for="entry in photos.slice(0,limit)" :key="entry.observation.id+entry.photo.id" role="button" tabindex="0" class="library-photo" @click="openObservation(entry.observation.id,entry.photo.id)" :aria-label="'查看'+displayName(entry.observation)" data-testid="library-photo"><PhotoPreview :photo="entry.photo" /></button>
    </view>
    <button v-if="count>limit" role="button" tabindex="0" class="plain wide section" @click="limit+=60">加载更多</button>
  </view>
</template>
<style scoped>
.mini-photo { width:48px; height:56px; border-radius:8px; overflow:hidden; flex-shrink:0; }
.photo-library { display:grid; grid-template-columns:repeat(3,minmax(0,1fr)); gap:10px; }
.page .library-photo { padding:0; height:128px; overflow:hidden; background:var(--control); border-radius:12px; }
.settings-row .grow { overflow-wrap:anywhere; }
@media(min-width:700px) { .photo-library { grid-template-columns:repeat(4,minmax(0,1fr)); } .page .library-photo { height:180px; } }
</style>
