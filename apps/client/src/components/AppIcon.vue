<script setup lang="ts">
withDefaults(defineProps<{ name: 'leaf' | 'folder' | 'plus' | 'chevron' | 'camera' | 'info' | 'close'; size?: number }>(), { size:24 });
</script>

<template>
  <image class="app-icon" :src="'/static/icons/' + name + '.svg'" :style="{width:size + 'px',height:size + 'px'}" mode="aspectFit" aria-hidden="true" />
</template>

<style scoped>
.app-icon { display:block; flex-shrink:0; }
</style>
