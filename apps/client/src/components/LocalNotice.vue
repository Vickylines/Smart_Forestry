<script setup lang="ts">
import { storageWarning } from '../data/store';
</script>
<template>
  <view v-if="storageWarning" class="error-notice" role="alert">{{ storageWarning }}</view>
</template>
