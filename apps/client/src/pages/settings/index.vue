<script setup lang="ts">
import { computed, ref } from 'vue';
import { onShow, onHide } from '@dcloudio/uni-app';
import { activeJob } from '../../services/recognition';
import { forest } from '../../data/store';
import { projectStats } from '../../domain/forest';
import { directAvailable, directConfigured, saveBaidu, requestBaidu } from '../../services/baidu';
import LocalNotice from '../../components/LocalNotice.vue';
import AppIcon from '../../components/AppIcon.vue';
const stats = computed(() => projectStats(forest.value));
const baiduKey = ref(''), baiduSecret = ref(''), message = ref(''), checking = ref(false);
const inputVersion = ref(0);
const locked = computed(() => checking.value || !!activeJob.value);
onShow(() => { if (directAvailable) directConfigured.value = !!(window as any).ForestAndroidPreview.baiduConfigured(); });
function clearInputs() { baiduKey.value=''; baiduSecret.value=''; inputVersion.value++; }
onHide(clearInputs);
function storeKey() {
  if (locked.value) return;
  message.value = '';
  try {
    saveBaidu(baiduKey.value, baiduSecret.value);
    clearInputs();
    message.value = '密钥已加密保存';
  } catch(e) { message.value = e instanceof Error ? e.message : '保存失败'; }
}
async function verifyKey() {
  if (locked.value) return;
  checking.value = true; message.value = '';
  try {
    const result = await requestBaidu();
    message.value = result.needsPhoto ? '请在任务页提交一张照片验证识别权限' : '验证通过';
  } catch(e) { message.value = e instanceof Error ? e.message : '验证失败'; }
  finally { checking.value = false; }
}
function clearKey() {
  uni.showModal({ title:'移除密钥？', content:'之后识别需重新填写，已有资料会保留。', confirmText:'移除', confirmColor:'#b1382e',
    success: result => {
      if (!result.confirm || locked.value) return;
      try { saveBaidu('',''); clearInputs(); message.value='已移除密钥'; }
      catch(e) { message.value=e instanceof Error?e.message:'移除失败'; }
    }
  });
}
function openLibrary(view:string) { uni.navigateTo({ url:'/pages/library/index?view='+view }); }
function privacy() {
  uni.showModal({title:'存储与隐私',content:'资料保存在当前设备。识别时才上传照片至百度。密钥由 Android 系统密钥库加密保存，不包含在导出包中。卸载或清除应用数据会删除本机资料，请先在项目中导出 ZIP 备份。',showCancel:false,confirmText:'知道了'});
}
</script>
<template>
  <view class="page root-page">
    <text class="page-title">设置</text>
    <LocalNotice />
    <view class="section card padded">
      <view class="row between"><text class="section-title">百度识图</text><text class="badge" :class="{'status-confirmed':directConfigured}" data-testid="key-status">{{directConfigured?'已保存':'未设置'}}</text></view>
      <text class="field-label">API Key</text>
      <input :key="'api-'+inputVersion" v-model="baiduKey" password class="field" :maxlength="4096" :disabled="locked" :placeholder="directConfigured?'填写以更换 API Key':'填写百度 API Key'" aria-label="API Key" data-testid="baidu-key" autocomplete="off" />
      <text class="field-label">Secret Key</text>
      <input :key="'secret-'+inputVersion" v-model="baiduSecret" password class="field" :maxlength="1024" :disabled="locked" placeholder="填写百度 Secret Key" aria-label="Secret Key" data-testid="baidu-secret" autocomplete="off" />
      <text class="subtitle small">{{directAvailable?'密钥加密保存在本机。':'请在 Android 应用中保存密钥。'}}</text>
      <button role="button" tabindex="0" class="primary wide section" :disabled="locked || !baiduKey.trim()" @click="storeKey" data-testid="baidu-save">保存密钥</button>
      <view class="row key-actions">
        <button role="button" :tabindex="locked || !directConfigured ? -1 : 0" class="plain grow" :disabled="locked || !directConfigured" @click="verifyKey" data-testid="baidu-test">{{checking?'验证中…':'验证密钥'}}</button>
        <button role="button" :tabindex="locked || !directConfigured ? -1 : 0" class="plain danger grow" :disabled="locked || !directConfigured" @click="clearKey" data-testid="baidu-remove">移除密钥</button>
      </view>
      <text v-if="message" class="subtitle" aria-live="polite" data-testid="baidu-message">{{message}}</text>
    </view>
    <view class="section">
      <text class="settings-heading">本机资料</text>
      <view class="card settings-group">
        <button role="button" tabindex="0" class="settings-row" @click="openLibrary('projects')" data-testid="local-projects"><text class="grow">调查项目</text><text class="muted">{{forest.projects.length}}</text><AppIcon name="chevron" :size="16" /></button>
        <button role="button" tabindex="0" class="settings-row" @click="openLibrary('observations')" data-testid="local-observations"><text class="grow">观察记录</text><text class="muted">{{stats.observations}}</text><AppIcon name="chevron" :size="16" /></button>
        <button role="button" tabindex="0" class="settings-row" @click="openLibrary('photos')" data-testid="local-photos"><text class="grow">照片</text><text class="muted">{{stats.photos}}</text><AppIcon name="chevron" :size="16" /></button>
      </view>
    </view>
    <view class="section card settings-group">
      <button role="button" tabindex="0" class="settings-row" @click="privacy" data-testid="privacy"><text class="grow">存储与隐私</text><AppIcon name="chevron" :size="16" /></button>
    </view>
    <text class="version">智慧林业 · 0.3.0 Beta 2</text>
  </view>
</template>
<style scoped>
.key-actions { margin-top:8px; }
.version { display:block; margin-top:32px; text-align:center; color:var(--secondary); font-size:.75rem; }
</style>
