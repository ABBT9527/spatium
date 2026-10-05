<script setup lang="ts">
/**
 * S0 计数层 · 外壳。
 *
 * 显示层定案（2026-10-03）：参考「寻数之序」的**底部导航四页面** ——
 *   序数 / 升级 / 成就 / 设置，设置与升级同级。
 *
 * 布局定案（2026-10-03）：**三段固定** —— 顶栏（序数资源）+ 内容区 + 底栏（导航）。
 *   只有中间的内容区滚动，顶/底两栏**永不移动、永不隐藏** ⇒
 *   ① 在任何页面都能看见当前进度（自动后继在升级页也看得见 n 在涨）；
 *   ② 切页面时只有中间一块换，消除「整页重排」的撕裂感。
 *
 * 为什么资源栏要上提到外壳：计数 n / 序数 α 不是「序数页的内容」，而是**全局状态**
 * —— 它在升级页、成就页、设置页同样有意义。放在页面里就意味着「切走就看不见」。
 *
 * 戒律：本组件只做页面切换与资源展示，不持有任何游戏状态副本。
 */
import { computed, ref } from 'vue';
import { useGame } from '@/bridge/useGame';
import KatexText from './components/KatexText.vue';
import { fmtLive, fmtNum } from './format';
import { cine, garble, garbleNum } from './ascendCinematic';
import OrdinalPage from './pages/OrdinalPage.vue';
import UpgradePage from './pages/UpgradePage.vue';
import AchievementPage from './pages/AchievementPage.vue';
import SettingsPage from './pages/SettingsPage.vue';

type TabKey = 'ord' | 'up' | 'ach' | 'set';

const game = useGame();
const v = computed(() => game.view.value);
const s0 = computed(() => v.value.s0);

const tab = ref<TabKey>('ord');
const TABS: Array<{ k: TabKey; label: string }> = [
  { k: 'ord', label: '序数' },
  { k: 'up', label: '升级' },
  { k: 'ach', label: '成就' },
  { k: 'set', label: '设置' },
];

function tabLabel(t: { k: TabKey; label: string }): string {
  // 演出期间 / base2 故障态：导航标签 D 乱码；演出期间另由 cine.lock 锁死点击
  return garble(t.label);
}
</script>

<template>
  <div class="shell" v-if="s0">
    <!-- ① 顶栏：序数资源（常驻，不随切页隐藏）
         两行：上行 = 序数 α（独占一整行、可横向滚动）；
               下行 = 计数 n 与 序数计数 a 同行 + 后继/自动速率。 -->
    <header class="resbar">
      <div class="row row-alpha">
        <span class="k">{{ garble('序数 α') }}</span>
        <!-- 可横向滚动：显示长度固定，内容向右扩展 -->
        <div class="alpha-scroll">
          <KatexText class="alpha-tex" :tex="s0.alphaTex" :fallback="s0.alpha" :size="22" />
          <!-- 「(已达硬上限)」单独成段走 garble：KaTeX 里塞乱码会报缺字形，
               故 α 的公式部分保持干净，只让这串中文乱码（格式同其余描述类文本）。 -->
          <span class="cap-note" v-if="s0.alphaNote">({{ garble(s0.alphaNote) }})</span>
        </div>
      </div>
      <div class="row row-nums">
        <div class="res">
          <span class="k">{{ garble('计数 n') }}</span>
          <!-- 计数 n 是**逐帧在动**的数字 ⇒ 走 7 位定宽（fmtLive）：宽度恒定，跳动时不推挤邻格 -->
          <span class="big mono">{{ garbleNum(fmtLive(s0.nShown)) }}</span>
        </div>
        <div class="res">
          <span class="k">{{ garble('序数计数 a') }}</span>
          <!-- 序数计数 a 同属「会一直动」的货币（低基有自动极限时每帧涨）⇒ 同样 7 位定宽 -->
          <span class="big mono">{{ garbleNum(fmtLive(s0.ordinalCount)) }}</span>
        </div>
        <div class="res meta">
          <span class="k">{{ garble('后继') }}</span>
          <span class="v mono">+{{ garbleNum(s0.succGainText) }} / {{ garble('次') }}</span>
          <template v-if="s0.succVelocity > 0">
            <span class="k">{{ garble('自动') }}</span>
            <span class="v mono">+{{ garbleNum(fmtNum(s0.succVelocity)) }} / {{ garble('秒') }}</span>
          </template>
        </div>
      </div>
    </header>

    <!-- ② 内容区：唯一滚动区；KeepAlive 避免切页时的重建抖动 -->
    <div class="body">
      <KeepAlive>
        <OrdinalPage v-if="tab === 'ord'" />
        <UpgradePage v-else-if="tab === 'up'" />
        <AchievementPage v-else-if="tab === 'ach'" />
        <SettingsPage v-else />
      </KeepAlive>
    </div>

    <!-- ③ 底栏：四页面导航（常驻）。演出期间 cine.lock 为真 ⇒ 乱码且不可点（锁在序数页） -->
    <nav class="tabbar">
      <button
        v-for="t in TABS"
        :key="t.k"
        :class="{ on: tab === t.k }"
        :disabled="cine.lock"
        @click="!cine.lock && (tab = t.k)"
      >{{ tabLabel(t) }}</button>
    </nav>

  </div>
</template>

<style scoped>
.shell {
  /* 三段固定：顶/底栏 flex:0 不伸缩，内容区 flex:1 且自己滚 */
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
}

/* ── ① 顶栏（两行：上行 α / 下行 n + a + 速率） ── */
.resbar {
  flex: 0 0 auto;
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 10px 0 12px;
  border-bottom: 1px solid var(--line);
  background: var(--bg);
}
.row {
  display: flex;
  align-items: baseline;
  gap: 24px;
  min-width: 0;
}
/* ⚠️ 标签（`序数 α` / `计数 n` / `序数计数 a` / `后继` …）绝不换行：
   它们是可伸缩 flex 项，α 一变长就会把标签里的最后一个字挤到第二行
   ⇒ 顶栏高度跳动 ⇒ 整页上下抖动（2026-10-04 修）。 */
.row .k,
.res .k {
  flex: 0 0 auto;
  white-space: nowrap;
}
/*
 * 上行：α 独占整行、可横向滚动。
 * **固定 56px 高**：序数最长会到 3 层幂塔（ω^(ω^ω)），KaTeX 嵌套上标比单行高得多；
 * 预留固定纵向空间 ⇒ 无论 α 是 0 还是三层塔，行数/行高都不变 ⇒ 页面不抖。
 */
.row-alpha {
  gap: 10px;
  align-items: center;
  min-height: 56px;
}
/* 下行：n / a 左对齐靠前，速率信息推到右端 */
.row-nums {
  gap: 28px;
}
.res {
  display: flex;
  align-items: baseline;
  gap: 8px;
  min-width: 0;
}
.res .k {
  flex: 0 0 auto;
  font-size: 11px;
  color: var(--dim);
}
.res .v {
  font-size: 13px;
}
.res .big {
  font-size: 24px;
  line-height: 1.15;
  color: var(--text);
  white-space: nowrap;
}
.res.meta {
  /* 速率信息靠右：与 n / a 拉开，避免和数值抢视觉焦点 */
  margin-left: auto;
  flex: 0 0 auto;
  gap: 6px;
}
/* α 滑动栏：显示长度由栅格固定，内容不换行、可左右滚动 */
.alpha-scroll {
  flex: 1 1 auto;
  min-width: 0;
  /* 固定高度 = 为三层幂塔预留的空间（见 .row-alpha 注释）：高度不随 α 变化。
     纵向也留了滚动口 —— 万一哪天冒出更高的塔，宁可滚动也不能被裁掉。 */
  height: 56px;
  display: flex;
  align-items: center;
  overflow: auto;
  white-space: nowrap;
}
.alpha-scroll::-webkit-scrollbar {
  height: 6px;
}
.alpha-scroll::-webkit-scrollbar-thumb {
  background: var(--line);
  border-radius: 3px;
}
.alpha-tex {
  color: var(--accent);
  display: inline-block;
}
/* 「(已达硬上限)」：紧跟在 α 公式后面，与公式同色但字号小一号 */
.cap-note {
  margin-left: 10px;
  flex: 0 0 auto;
  font-size: 12px;
  color: var(--dim);
  white-space: nowrap;
}

/* ── ② 内容区（唯一滚动区） ── */
.body {
  flex: 1 1 auto;
  min-height: 0;
  overflow-y: auto;
  padding: 16px 0;
}

/* ── ③ 底栏 ── */
.tabbar {
  flex: 0 0 auto;
  display: flex;
  gap: 0;
  border: 1px solid var(--line);
  border-radius: 4px;
  overflow: hidden;
  background: var(--panel);
}
.tabbar button {
  flex: 1;
  padding: 12px 8px;
  font-size: 12px;
  color: var(--dim);
  background: none;
  border: none;
  border-right: 1px solid var(--line);
  cursor: pointer;
  transition: color 120ms, background 120ms;
}
.tabbar button:last-child { border-right: none; }
.tabbar button:hover { color: var(--text); }
.tabbar button.on {
  color: var(--accent);
  background: var(--bg);
}
.mono { font-family: var(--font-mono); }

@media (max-width: 620px) {
  .row { gap: 16px; flex-wrap: wrap; }
  .row-nums { gap: 16px; }
  .res.meta { margin-left: 0; }
  .res .big { font-size: 20px; }
}
</style>
