<script setup lang="ts">
/**
 * S0 · 升级页。
 *
 * 显示层定案（2026-10-03）：资源与升级**分离到各自的页面**；
 * 升级卡片只留一行「名称 · Lv x/y · 当前效果数值 · 价格」，
 * 删除第二行风味/机制描述（如「α ↦ α+1 的步长」）。
 * 升级随换基进度解锁（基 10 时无任何升级），故这里只渲染已解锁者。
 *
 * 基 2（用户定案 2026-10-04）：换**双层对数经济** —— 6 个专属升级，价格按显示单位 D 计
 * （1 / 1.5 / 2 / 2.5 / 3 / 3.5），实际扣除后内部计数向下取整；效果 = 后继倍率累乘。
 * 故障态下文案全部乱码：**名称走 A 方案 @70ms**，**描述走 D 方案 @70ms**，
 * **价格（含数字）走 D 方案 @600~1200ms**（用户定案：数字跳得慢得多）。
 */
import { computed } from 'vue';
import { useGame } from '@/bridge/useGame';
import KatexText from '../components/KatexText.vue';
import { fmtNum } from '../format';
import { garble, garbleSlow, garbleName } from '../ascendCinematic';

const game = useGame();
const s0 = computed(() => game.view.value.s0);
const isB2 = computed(() => s0.value?.base === 2);
</script>

<template>
  <section class="pg" v-if="s0">
    <!-- 基 2：专属的 6 个升级（双层对数经济），文案全乱码但**照常可买** -->
    <div class="up-list" v-if="isB2">
      <button
        class="up"
        v-for="u in s0.base2Ups"
        :key="u.idx"
        :disabled="!u.affordable"
        @click="game.buyBase2Upgrade(u.idx)"
      >
        <span class="up-top">
          <span class="up-name">{{ garbleName('升级 ' + (u.idx + 1)) }}</span>
          <span class="up-lv mono">{{ garble(u.bought ? '已装' : '未装') }}</span>
        </span>
        <span class="up-eff mono">{{ garble('加成后继 ×' + u.mult) }}</span>
        <span class="up-cost" :class="{ ok: u.affordable }">
          <span class="cost-num mono">{{ garbleSlow('价格 ' + u.price) }}</span>
        </span>
      </button>
    </div>

    <!-- base ≥ 3：序数计价升级（价格 = 序数，花费序数计数 a） -->
    <template v-else>
      <div class="up-list" v-if="s0.upgrades.length">
        <button
          class="up"
          v-for="u in s0.upgrades"
          :key="u.id"
          :disabled="!u.affordable"
          @click="game.buyUpgrade(u.id)"
        >
          <span class="up-top">
            <span class="up-name">{{ garble(u.name) }}</span>
            <span class="up-lv mono">Lv {{ u.level }} / {{ u.max }}</span>
          </span>
          <span class="up-eff mono">{{ u.effect }}</span>
          <span class="up-cost" :class="{ ok: u.affordable }">
            <KatexText v-if="u.costTex" :tex="u.costTex" :size="14" />
            <span class="cost-num mono">{{ u.costText }}</span>
          </span>
        </button>
      </div>
      <p class="empty" v-else>
        {{ garble('基 ' + s0.base + ' 时尚无升级 —— 换基后逐步解锁（基 9 起）。') }}
      </p>
      <p class="note">
        {{ garble('升级花费的是序数计数 a') }}（{{ fmtNum(s0.ordinalCount) }}）{{ garble('，价格以序数表示、按当前基折算。') }}
      </p>
    </template>
  </section>
</template>

<style scoped>
.pg {
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.up-list {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
  gap: 8px;
}
.up {
  display: flex;
  flex-direction: column;
  gap: 4px;
  text-align: left;
  font-size: 12px;
  color: var(--text);
  background: var(--panel);
  border: 1px solid var(--line);
  border-radius: 4px;
  padding: 10px 12px;
  cursor: pointer;
  transition: border-color 120ms;
}
.up:hover:not(:disabled) { border-color: var(--accent); }
.up:disabled { color: var(--dim); cursor: default; }
.up-top {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  gap: 8px;
}
.up-name { font-weight: 500; }
.up-lv { font-size: 11px; color: var(--dim); }
.up-eff { font-size: 11px; }
.up-cost {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 11px;
  color: var(--dim);
}
.up-cost.ok { color: var(--accent); }
.empty {
  margin: 0;
  font-size: 12px;
  color: var(--dim);
  line-height: 1.7;
}
.note {
  margin: 0;
  font-size: 11px;
  color: var(--dim);
  line-height: 1.7;
}
.note b { color: var(--text); font-weight: 500; }
.mono { font-family: var(--font-mono); }
.banner {
  margin: 0;
  font-size: 12px;
  color: var(--accent);
  border: 1px solid var(--accent);
  border-radius: 4px;
  padding: 8px 10px;
  background: var(--panel);
}</style>
