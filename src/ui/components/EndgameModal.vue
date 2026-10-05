<script setup lang="ts">
/**
 * v0.1 版本终局弹窗。
 *
 * 触发：base2 涌升完成（α 抵达 ε₀）且 S1 尚未实装 ⇒ useGame.ascend 拦截、置 meta.endgame，
 * 不再进入 S1。弹出后玩家二选一：
 *   ① 重置游戏 —— 清档重来（game.hardReset）；
 *   ② 解锁调试模式 —— 持久开启调试注入（game.unlockDebug），可继续在终态探索。
 *
 * 仅在「终局且尚未解锁调试」时显示；一旦解锁调试即隐藏（玩家选择继续探索）。
 */
import { computed } from 'vue';
import { useGame } from '@/bridge/useGame';

const game = useGame();
const v = computed(() => game.view.value);
const show = computed(() => v.value.endgame && !v.value.debugUnlocked);

function onReset(): void {
  game.hardReset();
}
function onUnlock(): void {
  game.unlockDebug();
}
</script>

<template>
  <div class="overlay" v-if="show">
    <div class="card" role="dialog" aria-modal="true" aria-label="v0.1 版本终局">
      <div class="tag">END · v0.1</div>
      <h2 class="title">已达 v0.1 版本终局</h2>
      <p class="desc">
        你已令 α 抵达 ε₀，走完序数层的全部循环。S1 及之后的内容尚未实装 ——
        这一版本到此为止。你可以重置游戏重新挑战，或解锁调试模式继续探索。
      </p>
      <div class="btns">
        <button class="btn danger" @click="onReset">重置游戏</button>
        <button class="btn accent" @click="onUnlock">解锁调试模式</button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.overlay {
  position: fixed;
  inset: 0;
  z-index: 100;
  display: flex;
  align-items: center;
  justify-content: center;
  background: color-mix(in srgb, var(--bg) 78%, transparent);
  backdrop-filter: blur(3px);
}
.card {
  width: min(440px, calc(100vw - 40px));
  padding: 28px 28px 24px;
  background: var(--panel);
  border: 1px solid var(--line);
  border-radius: 8px;
  box-shadow: 0 12px 40px rgba(0, 0, 0, 0.35);
}
.tag {
  font-family: var(--font-mono);
  font-size: 11px;
  letter-spacing: 0.12em;
  color: var(--dim);
}
.title {
  margin: 8px 0 12px;
  font-size: 20px;
  font-weight: 600;
  color: var(--text);
}
.desc {
  margin: 0 0 22px;
  font-size: 13px;
  line-height: 1.8;
  color: var(--dim);
}
.btns {
  display: flex;
  gap: 12px;
}
.btn {
  flex: 1;
  padding: 10px 14px;
  font-size: 13px;
  color: var(--text);
  background: var(--bg);
  border: 1px solid var(--line);
  border-radius: 5px;
  cursor: pointer;
  transition: border-color 120ms;
}
.btn:hover { border-color: var(--accent); }
.btn.accent { border-color: var(--accent); color: var(--accent); }
.btn.danger { border-color: var(--danger); color: var(--danger); }
</style>
