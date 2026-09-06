<script setup lang="ts">
import { ref, watch } from 'vue';
import type { Photo } from '../domain/forest';
import { photoUrl } from '../services/media';
const props = defineProps<{ photo?: Photo }>();
const url = ref('');
const failed = ref(false);
watch(() => props.photo?.uri, async (uri, previous, onCleanup) => {
  let current = true;
  onCleanup(() => { current = false; });
  url.value = ''; failed.value = false;
  if (!props.photo) return;
  try { const source = await photoUrl(props.photo); if (current) url.value = source; } catch { if (current) failed.value = true; }
}, { immediate: true });
</script>
<template>
  <view class="photo-preview">
    <image v-if="url && !failed" class="photo-image" :src="url" mode="aspectFill" :aria-label="photo?.name || '植物观察照片'" @error="failed = true" />
    <text v-else class="photo-fallback">{{ failed ? '照片不可用' : '载入照片' }}</text>
  </view>
</template>
<style scoped>
.photo-preview { width:100%; height:100%; overflow:hidden; background:var(--tint); display:flex; align-items:center; justify-content:center; }
.photo-image { width:100%; height:100%; }
.photo-fallback { color:var(--secondary); font-size:.8125rem; }
</style>
