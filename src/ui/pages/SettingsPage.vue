<script setup lang="ts">
/**
 * S0 · 设置页（底部导航四页面之一）。
 *
 * 用户定案（2026-10-03）：设置与升级**同级**，作为底部导航的一页
 * （参考「寻数之序」的四页面：序数 / 升级 / 成就 / 设置）。
 * 正文复用 SettingsBody.vue（与齿轮弹窗同一份，单一来源）。
 */
import SettingsBody from '../components/SettingsBody.vue';
</script>

<template>
  <section class="pg">
    <div class="card">
      <div class="card-head">
        <span class="title">设置 · 存档管理</span>
      </div>
      <SettingsBody />
    </div>
  </section>
</template>

<style scoped>
.pg {
  display: flex;
  flex-direction: column;
}
.card {
  width: 100%;
  background: var(--panel);
  border: 1px solid var(--line);
  border-radius: 6px;
}
.card-head {
  padding: 14px 16px;
  border-bottom: 1px solid var(--line);
}
.card-head .title {
  font-size: 13px;
}
</style>
