<script setup lang="ts">
/**
 * 主界面：简洁 · 克制 · 工业 · 构成。
 * 只读 state 快照 + emit intent；不持有游戏状态副本。
 * 主脊驱动：按 meta.current 在 S0 序数视图 / S1 棋盘之间切换。
 */
import { computed, ref } from 'vue';
import { useGame } from '@/bridge/useGame';
import BoardCanvas from './components/BoardCanvas.vue';
import KatexText from './components/KatexText.vue';
import SettingsCard from './components/SettingsCard.vue';
import EndgameModal from './components/EndgameModal.vue';
import OrdinalView from './OrdinalView.vue';
import { milestoneLabel } from './milestoneLabels';

const game = useGame();
const v = computed(() => game.view.value);
const isS1 = computed(() => v.value.current === 's1');

const showSettings = ref(false);
function openSettings(): void {
  showSettings.value = true;
}

const s1 = computed(() => v.value.s1);

const rows = computed(() => [
  ['轮次 n', `${v.value.round} / ${v.value.runs}`],
  ['产能等级 lv', String(v.value.lv)],
  ['本轮需摆 N', s1.value ? `${s1.value.placed} / ${s1.value.need}` : '—'],
  ['Φ 有效', v.value.phi],
  ['Φ 盘面', s1.value ? s1.value.phiBoard : '—'],
  ['Φ 最佳', v.value.bestPhi],
  ['注意力', s1.value ? s1.value.attnLeft : '—'],
  ['产出 V', v.value.v],
  ['目标 V*', v.value.target],
  ['累计 ε', s1.value ? s1.value.eps : '—'],
  [v.value.resourceLabel, v.value.resourceText],
  ['序 order', v.value.order1Unlocked ? v.value.order1 : '未解锁'],
  ['Θ', v.value.theta],
  ['本轮 / 目标', `${v.value.roundTime} / ${v.value.targetRoundTime}`],
  ['盘面', s1.value ? `${s1.value.boardSize}×${s1.value.boardSize} · ${s1.value.lattice}` : '—'],
]);

const dev = computed(() => {
  const a = v.value.lastRoundTime;
  const b = v.value.lastRoundTarget;
  if (!a || !b) return null;
  return Math.abs(Math.log(a / b)) * 100;
});

function onPick(i: number): void {
  game.place(i);
}
</script>

<template>
  <div class="app">
    <header class="head">
      <span class="tag">00</span>
      <h1>{{ v.layerName }}</h1>
      <span class="sub">量形之度 / SPATIUM — 主脊 {{ v.ascensions > 0 ? '· 已涌升 ' + v.ascensions + ' 次' : '' }}</span>
      <button class="gear" title="设置 · 存档管理" @click="openSettings">⚙ 设置</button>
    </header>

    <!-- S0 时隐藏顶部资源栏：其信息已由序数页承载（显示层定案：删冗余、克制） -->
    <div class="resbar" v-if="isS1">
      <div class="res"><span class="k">维度 D</span><span class="v mono">{{ v.dim }}</span></div>
      <div class="res">
        <span class="k">{{ v.resourceLabel }}</span>
        <KatexText
          v-if="v.resourceTex"
          class="v accent katex-inline"
          :tex="v.resourceTex"
          :fallback="v.resourceText"
        />
        <span v-else class="v mono accent">{{ v.resourceText }}</span>
      </div>
      <div class="res">
        <span class="k">序 order</span>
        <span class="v mono">{{ v.order1Unlocked ? v.order1 : '未解锁' }}</span>
      </div>
      <div class="res"><span class="k">Φ</span><span class="v mono accent">{{ v.phi }}</span></div>
      <div class="res"><span class="k">lv</span><span class="v mono">{{ v.lv }}</span></div>
      <div class="res"><span class="k">轮次</span><span class="v mono">{{ v.round }}</span></div>
      <div class="res" v-if="v.stalled"><span class="k">状态</span><span class="v mono warn">停留</span></div>
    </div>

    <main class="main" v-if="isS1 && s1">
      <BoardCanvas
        :board="game.rt.s1.board"
        :phi-current="Number(s1.phiBoard)"
        :hover-phi="game.hoverPhi"
        :version="v.version"
        @pick="onPick"
      />

      <aside class="side">
        <div class="metrics">
          <template v-for="r in rows" :key="r[0]">
            <div class="k">{{ r[0] }}</div>
            <div class="v mono">{{ r[1] }}</div>
          </template>
        </div>

        <div class="ctl">
          <button @click="game.doReference">参考最优</button>
          <button @click="game.doQuickFill">矩形填充</button>
          <button
            @click="game.toggleAuto"
            :disabled="!s1.autoUnlocked"
            :title="s1.autoUnlocked ? '' : '进度过半（第 65 轮）后解锁'"
          >求解器 {{ s1.auto ? '开' : '关' }}{{ s1.autoUnlocked ? '' : '（未解锁）' }}</button>
          <button @click="game.clearBoard">清空</button>
          <button class="danger" @click="game.forceCycle">周期重置</button>
        </div>

        <div class="ctl" v-if="!s1.hexUnlocked">
          <button
            class="accent"
            :disabled="!s1.canHex"
            @click="game.unlockHex"
            :title="s1.canHex ? `花费 ${s1.hexCost} ε` : 'ε 不足'"
          >解锁三角格 · 花费 {{ s1.hexCost }} ε</button>
        </div>
        <div class="ctl" v-else>
          <span class="k">盘面已升级：三角格</span>
        </div>

        <div class="milestones" v-if="s1.milestones.length">
          <div class="k">里程碑</div>
          <div class="chips">
            <span class="chip" v-for="m in s1.milestones" :key="m">{{ milestoneLabel(m) }}</span>
          </div>
        </div>

        <div class="log" v-if="dev !== null">
          <div class="log-title">上一轮偏差</div>
          <div class="mono" :class="dev < 12 ? 'ok' : 'warn'">{{ dev.toFixed(1) }}%</div>
          <div class="log-sub">实际 {{ v.lastRoundTime.toFixed(0) }}s / 目标 {{ v.lastRoundTarget.toFixed(0) }}s</div>
        </div>
      </aside>
    </main>

    <!-- S0 外壳：自身是「顶栏 + 滚动区 + 底栏」三段固定布局，故这里给它 flex:1 吃满剩余高度 -->
    <OrdinalView v-else class="layer" />

    <SettingsCard :open="showSettings" @close="showSettings = false" />
    <EndgameModal />
  </div>
</template>

<style scoped>
/*
 * 视口高度三段布局（2026-10-03 定案）：
 *   标题栏（固定）→ 内容区（唯一滚动区，flex:1 + min-height:0）→ 无底栏（S1 用文档流）。
 * S0 的 OrdinalView 作为 .layer 吃满剩余高度，其内部再切「顶栏 / 滚动区 / 底栏」。
 * 这样切页面时上下两条栏永远不动 ⇒ 消除切页撕裂感。
 * 100dvh 优先（移动端动态视口），100vh 作旧浏览器回落。
 */
.app {
  display: flex;
  flex-direction: column;
  height: 100vh;
  height: 100dvh;
  max-width: 1120px;
  margin: 0 auto;
  padding: 24px;
}
.head {
  flex: 0 0 auto;
  display: flex;
  align-items: baseline;
  gap: 12px;
  border-bottom: 1px solid var(--line);
  padding-bottom: 12px;
}
.head h1 {
  font-size: 14px;
  font-weight: 500;
  margin: 0;
}
.tag {
  font-family: var(--font-mono);
  font-size: 12px;
  color: var(--dim);
}
.sub {
  margin-left: auto;
  font-size: 12px;
  color: var(--dim);
}
.gear {
  margin-left: 16px;
  padding: 4px 10px;
  font-size: 12px;
  color: var(--text);
  background: var(--panel);
  border: 1px solid var(--line);
  border-radius: 4px;
  cursor: pointer;
  transition: border-color 120ms;
}
.gear:hover {
  border-color: var(--accent);
}
.resbar {
  flex: 0 0 auto;
  display: flex;
  gap: 32px;
  padding: 12px 0;
  border-bottom: 1px solid var(--line);
}
.res {
  display: flex;
  align-items: baseline;
  gap: 8px;
}
.res .k {
  font-size: 12px;
  color: var(--dim);
}
.res .v {
  font-size: 14px;
}
.main {
  /* S1 内容区 = 唯一滚动区 */
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  display: grid;
  grid-template-columns: 560px 1fr;
  gap: 24px;
  margin-top: 24px;
}
/* S0 外壳：吃满剩余高度（子组件根节点会带上父级 scoped 属性，故此处可直接选中） */
.layer {
  flex: 1;
  min-height: 0;
}
.side {
  display: flex;
  flex-direction: column;
  gap: 16px;
}
.metrics {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 4px 16px;
  font-size: 12px;
}
.metrics .k {
  color: var(--dim);
}
.metrics .v {
  text-align: right;
}
.ctl {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}
.ctl button {
  font-size: 12px;
  color: var(--text);
  background: var(--panel);
  border: 1px solid var(--line);
  border-radius: 4px;
  padding: 6px 12px;
  cursor: pointer;
  transition: border-color 120ms;
}
.ctl button:hover {
  border-color: var(--accent);
}
.ctl button.danger:hover {
  border-color: var(--danger);
}
.ctl button.accent {
  border-color: var(--accent);
  color: var(--accent);
}
.ctl button:disabled {
  opacity: 0.4;
  cursor: default;
  border-color: var(--line);
  color: var(--dim);
}
.milestones {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.milestones .k {
  font-size: 12px;
  color: var(--dim);
}
.milestones .chips {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}
.milestones .chip {
  font-family: var(--font-mono);
  font-size: 11px;
  color: var(--text);
  border: 1px solid var(--line);
  border-radius: 4px;
  padding: 2px 8px;
}
.log {
  border: 1px solid var(--line);
  border-radius: 4px;
  padding: 8px 12px;
  background: var(--panel);
}
.log-title {
  font-size: 12px;
  color: var(--dim);
}
.log-sub {
  font-size: 12px;
  color: var(--dim);
  margin-top: 4px;
}
.mono {
  font-family: var(--font-mono);
}
.accent {
  color: var(--accent);
}
.warn {
  color: var(--warn);
}
.ok {
  color: var(--accent);
}
@media (max-width: 1000px) {
  .main {
    grid-template-columns: 1fr;
  }
}
</style>
