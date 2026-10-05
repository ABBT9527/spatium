<script setup lang="ts">
/**
 * 设置弹窗（齿轮入口）—— 正文抽到 SettingsBody.vue，此处只提供弹窗外壳。
 *
 * 正文复用的原因：底部导航的「设置」页（SettingsPage.vue）与这里共用同一份正文，
 * 避免两处各维护一套导出/导入/硬重置逻辑（单一来源）。
 */
import { onMounted, onUnmounted } from 'vue';
import SettingsBody from './SettingsBody.vue';

const props = defineProps<{ open: boolean }>();
const emit = defineEmits<{ (e: 'close'): void }>();

function onKey(e: KeyboardEvent): void {
  if (e.key === 'Escape' && props.open) emit('close');
}
onMounted(() => window.addEventListener('keydown', onKey));
onUnmounted(() => window.removeEventListener('keydown', onKey));
</script>

<template>
  <div class="overlay" v-if="open" @click.self="emit('close')">
    <div class="card" role="dialog" aria-modal="true" aria-label="设置 · 存档管理">
      <div class="card-head">
        <span class="title">设置 · 存档管理</span>
        <button class="x" title="关闭" @click="emit('close')">✕</button>
      </div>
      <SettingsBody />
    </div>
  </div>
</template>

<style scoped>
.overlay {
  position: fixed;
  inset: 0;
  z-index: 100;
  display: flex;
  align-items: flex-start;
  justify-content: center;
  padding: 48px 16px;
  overflow-y: auto;
  background: rgba(0, 0, 0, 0.62);
}
.card {
  width: 100%;
  max-width: 560px;
  background: var(--panel);
  border: 1px solid var(--line);
  border-radius: 6px;
}
.card-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 14px 16px;
  border-bottom: 1px solid var(--line);
}
.card-head .title {
  font-size: 13px;
}
.card-head .x {
  padding: 2px 8px;
  font-size: 13px;
  color: var(--dim);
  background: none;
  border: none;
  cursor: pointer;
}
.card-head .x:hover { color: var(--text); }
@media (max-width: 620px) {
  .overlay { padding: 16px 8px; }
}
</style>
