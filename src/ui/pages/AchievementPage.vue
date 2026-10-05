<script setup lang="ts">
/**
 * S0 · 成就页。
 *
 * 用户定案（2026-10-03）：四页面导航（序数 / 升级 / 成就 / 设置），
 * 成就页保留为**干净列表**；删除的只是旧版右侧那堆冗余 chips，而非成就本身。
 * 里程碑是纯记录（不发数值奖励），跨换基/涌升持久。
 */
import { computed } from 'vue';
import { useGame } from '@/bridge/useGame';
import { milestoneLabel, S0_MILESTONE_IDS } from '../milestoneLabels';
import { cine, garble } from '../ascendCinematic';

const game = useGame();
const s0 = computed(() => game.view.value.s0);

// base2 故障态：前三条（ω / ω^ω / cap3）常驻 D 乱码，第四、五条（base2 / ε₀）正常显示
const list = computed(() => {
  void cine.gtick; // 依赖：乱码重掷时重算
  return S0_MILESTONE_IDS.map((id, i) => ({
    id,
    label: i < 3 ? garble(milestoneLabel(id)) : milestoneLabel(id),
    done: !!s0.value?.milestones.includes(id),
  }));
});
const doneCount = computed(() => list.value.filter((a) => a.done).length);
</script>

<template>
  <section class="pg">
    <div class="head">
      <span class="k">已达成</span>
      <span class="v mono">{{ doneCount }} / {{ list.length }}</span>
    </div>
    <ul class="ach">
      <li v-for="a in list" :key="a.id" :class="{ done: a.done }">
        <span class="dot"></span>
        <span class="lab">{{ a.label }}</span>
      </li>
    </ul>
  </section>
</template>

<style scoped>
.pg {
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.head {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  font-size: 12px;
}
.head .k { color: var(--dim); }
.head .v { font-size: 13px; }
.ach {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.ach li {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 10px;
  border: 1px solid var(--line);
  border-radius: 4px;
  font-size: 12px;
  color: var(--dim);
  background: var(--panel);
}
.ach li.done {
  color: var(--text);
  border-color: var(--accent);
}
.dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--line);
  flex: 0 0 auto;
}
.ach li.done .dot { background: var(--accent); }
.lab { flex: 1; }
.mono { font-family: var(--font-mono); }
</style>
