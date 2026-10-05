<script setup lang="ts">
/**
 * 设置正文（存档管理 + 刷新频率）。
 *
 * 抽出来的原因：同一份正文要服务两种外壳 ——
 *   - SettingsCard.vue：右上角齿轮打开的**弹窗**（S1 / 通用）
 *   - SettingsPage.vue ：底部导航「设置」页（S0 四页面导航之一）
 *
 * 只做五件事（用户定案）：
 *   ① 刷新频率 —— 序数增长「每次刷新即变动」的频率（ms/次，最小 20）
 *   ② 导出 —— 当前进度 → Base64 文本，可复制保存（硬重置前的备份）
 *   ③ 导入 —— 粘贴 Base64 → 完全覆盖当前进度
 *   ④ 硬重置 —— 清空本地存档、重新开始（回到 S0）
 *   ⑤ **调试模式**（2026-10-04）—— 开关后才展开：用输入框直接把计数推到任意位置，
 *      省去「手动点几千次后继」才能验证后期平衡。输入框支持 `1e12` / `3^27` 写法。
 *
 * 纯 UI：只经 useGame() 暴露的动作读写，不直接碰 state（三层分离戒律）。
 */
import { computed, ref } from 'vue';
import { useGame } from '@/bridge/useGame';
import { fmtNum } from '@/ui/format';

const game = useGame();
const v = computed(() => game.view.value);

const exportText = ref('');
const importText = ref('');
const status = ref('');
const statusKind = ref<'ok' | 'err' | 'warn'>('ok');
const confirmReset = ref(false);
const exportEl = ref<HTMLTextAreaElement | null>(null);
const fileEl = ref<HTMLInputElement | null>(null);

/** 调试模式开关：默认跟随「终局后解锁调试」持久标记（调试的两条注入口理论上绕过所有玩法规则） */
const debugOn = ref(v.value.debugUnlocked);
const addN = ref('');
const addA = ref('');

/**
 * 解析输入框：支持普通数字、`逗号` / 下划线分隔、`1e12` 科学计数、以及 **`3^27` 幂**。
 * 后期数量级动辄 10¹²～10¹³（基 3 门槛是 3²⁷），纯数字得数半天 —— `a^b` 写法最省事。
 * 非法输入返回 NaN，由调用方提示。
 */
function parseAmount(raw: string): number {
  const s = raw.trim().replace(/[,_\s]/g, '');
  if (!s) return NaN;
  const pow = /^(-?\d+(?:\.\d+)?(?:e[+-]?\d+)?)\^(-?\d+(?:\.\d+)?)$/i.exec(s);
  if (pow) {
    const b = Number(pow[1]);
    const e = Number(pow[2]);
    if (!Number.isFinite(b) || !Number.isFinite(e)) return NaN;
    const r = Math.pow(b, e);
    return Number.isFinite(r) ? r : NaN;
  }
  const x = Number(s);
  return Number.isFinite(x) ? x : NaN;
}

const num = (x: number): string => fmtNum(x);

function applyAdd(kind: 'n' | 'a'): void {
  const raw = kind === 'n' ? addN.value : addA.value;
  const x = parseAmount(raw);
  if (!Number.isFinite(x) || x <= 0) {
    say('请输入正数（支持 1e12 / 3^27 写法）', 'err');
    return;
  }
  if (kind === 'n') {
    game.debugAddCount(x);
    say(`计数 n += ${num(x)}`, 'ok');
  } else {
    game.debugAddOrdinalCount(x);
    say(`序数计数 a += ${num(x)}`, 'ok');
  }
}

/** 一键把序数计数 a 补到当前基的换基门槛（调试时最常用的跳线） */
function fillGate(): void {
  const s0 = v.value.s0;
  if (!s0 || s0.rebaseNeed <= 0) return say('当前基数无换基门槛', 'warn');
  const gap = s0.rebaseNeed - s0.ordinalCount;
  if (gap <= 0) return say('序数计数已满门槛（可直接换基）', 'warn');
  game.debugAddOrdinalCount(gap);
  say(`补到换基门槛：a += ${num(gap)}`, 'ok');
}

function say(msg: string, kind: 'ok' | 'err' | 'warn' = 'ok'): void {
  status.value = msg;
  statusKind.value = kind;
}

function selectAll(e: Event): void {
  (e.target as HTMLTextAreaElement).select();
}

/** 刷新频率（序数增长频率）：20–200 ms/次，默认 20（最小值 20） */
function onTick(e: Event): void {
  const ms = Number((e.target as HTMLInputElement).value);
  game.setTickMs(ms);
}

function doExport(): void {
  exportText.value = game.exportSave();
  confirmReset.value = false;
  say(`已生成存档串（${exportText.value.length} 字符），请复制保存`, 'ok');
}

async function doCopy(): Promise<void> {
  const text = exportText.value;
  if (!text) return;
  if (navigator.clipboard && window.isSecureContext) {
    try {
      await navigator.clipboard.writeText(text);
      say('已复制到剪贴板', 'ok');
      return;
    } catch {
      /* 落到 execCommand 兜底 */
    }
  }
  exportEl.value?.focus();
  exportEl.value?.select();
  try {
    document.execCommand('copy');
    say('已复制到剪贴板', 'ok');
  } catch {
    say('复制失败：请手动全选文本后复制', 'err');
  }
}

function doImport(): void {
  const res = game.importSave(importText.value);
  if (res.ok) {
    importText.value = '';
    exportText.value = '';
    confirmReset.value = false;
    say('导入成功，当前进度已被覆盖', 'ok');
  } else {
    say(`导入失败：${res.error ?? '无效存档'}`, 'err');
  }
}

/** 导出存档文件名：SPATIUM_yyyymmdd_hhmmss_.txt */
function saveFileName(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, '0');
  const ymd = `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}`;
  const hms = `${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
  return `SPATIUM_${ymd}_${hms}_.txt`;
}

/** 导出到文件：把 Base64 存档串写成 .txt 并触发浏览器下载 */
function exportToFile(): void {
  const text = game.exportSave();
  const name = saveFileName();
  const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  say(`已导出存档文件：${name}`, 'ok');
}

/** 从文件导入：读取选中文件文本，交给现有 importSave 流程（覆盖当前进度） */
function importFromFile(e: Event): void {
  const input = e.target as HTMLInputElement;
  const file = input.files?.[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    const text = String(reader.result ?? '');
    const res = game.importSave(text);
    if (res.ok) {
      importText.value = '';
      exportText.value = '';
      confirmReset.value = false;
      say('从文件导入成功，当前进度已被覆盖', 'ok');
    } else {
      say(`导入失败：${res.error ?? '无效存档'}`, 'err');
    }
    input.value = ''; // 重置以便再次选择同一文件
  };
  reader.onerror = () => say('读取文件失败', 'err');
  reader.readAsText(file);
}

function doHardReset(): void {
  if (!confirmReset.value) {
    confirmReset.value = true;
    say('硬重置会清空全部进度，请先导出备份；再点一次确认', 'warn');
    return;
  }
  game.hardReset();
}
</script>

<template>
  <div class="body">
    <section class="sec">
      <div class="sec-title">存档信息</div>
      <div class="kv"><span class="k">存档版本</span><span class="v mono">v{{ v.saveVersion }}</span></div>
      <div class="kv"><span class="k">当前层</span><span class="v mono">{{ v.layerName }}</span></div>
      <div class="kv"><span class="k">已涌升</span><span class="v mono">{{ v.ascensions }} 次</span></div>
      <div class="kv"><span class="k">游戏时间</span><span class="v mono">{{ v.playTime }}</span></div>
    </section>

    <section class="sec">
      <div class="sec-title">刷新频率</div>
      <div class="tick">
        <input
          class="slider"
          type="range"
          min="20"
          max="200"
          step="1"
          :value="v.tickMs"
          @input="onTick"
        />
        <span class="v mono">{{ v.tickMs }} ms</span>
      </div>
    </section>

    <section class="sec">
      <div class="sec-title">导出存档</div>
      <p class="hint">把当前进度导出为 Base64 文本，可复制保存。<b>建议在硬重置前先导出备份。</b></p>
      <button class="btn" @click="doExport">生成导出串</button>
      <button class="btn" @click="exportToFile">导出到文件</button>
      <textarea
        v-if="exportText"
        ref="exportEl"
        class="ta mono"
        readonly
        :value="exportText"
        @focus="selectAll"
        @click="selectAll"
      ></textarea>
      <button v-if="exportText" class="btn" @click="doCopy">复制到剪贴板</button>
    </section>

    <section class="sec">
      <div class="sec-title">导入存档</div>
      <p class="hint">粘贴 Base64 存档文本，或从文件导入。导入会<b>完全覆盖</b>当前进度，可在硬重置后用此恢复。</p>
      <textarea
        class="ta mono"
        v-model="importText"
        placeholder="在此粘贴存档 Base64…"
      ></textarea>
      <button class="btn accent" :disabled="!importText.trim()" @click="doImport">导入并覆盖</button>
      <button class="btn accent" @click="fileEl?.click()">从文件导入</button>
      <input
        ref="fileEl"
        type="file"
        accept=".txt,.json,.b64,text/*"
        style="display: none"
        @change="importFromFile"
      />
    </section>

    <section class="sec">
      <div class="sec-title">调试模式</div>
      <p class="hint">
        打开后可<b>直接注入计数</b>，跳过手动操作来验证后期平衡。输入框支持 <b>1e12</b> / <b>3^27</b> 写法；
        注入<b>不写入存档外的新逻辑</b>，即刻生效并参与普通游戏流程。
      </p>
      <label class="sw">
        <input type="checkbox" v-model="debugOn" />
        <span>{{ debugOn ? '调试模式：开' : '调试模式：关' }}</span>
      </label>
      <template v-if="debugOn">
        <div class="dbg" v-if="v.s0">
          <div class="dbg-now">
            <span class="k">当前</span>
            <span class="v mono">
              基 {{ v.s0.base }} · n {{ fmtNum(v.s0.n) }} · a
              {{ fmtNum(v.s0.ordinalCount) }} · 门槛
              {{ fmtNum(v.s0.rebaseNeed) }}
            </span>
          </div>
          <div class="dbg-row">
            <span class="k">计数 n</span>
            <input class="ipt mono" v-model="addN" placeholder="例如 1000 / 1e12 / 3^27" @keyup.enter="applyAdd('n')" />
            <button class="btn" @click="applyAdd('n')">加上</button>
          </div>
          <div class="dbg-row">
            <span class="k">序数计数 a</span>
            <input class="ipt mono" v-model="addA" placeholder="例如 7625597484987 / 3^27" @keyup.enter="applyAdd('a')" />
            <button class="btn" @click="applyAdd('a')">加上</button>
          </div>
          <div class="dbg-row">
            <button class="btn accent" @click="fillGate">补满换基门槛</button>
          </div>
        </div>
        <p class="hint" v-else>当前层（S1）不支持计数注入 —— 调试面板只对序数层生效。</p>
      </template>
    </section>

    <section class="sec last">
      <div class="sec-title danger">硬重置</div>
      <p class="hint">清空本地存档并重新开始（回到 S0 序数层）。<b>不可撤销。</b></p>
      <button class="btn danger" @click="doHardReset">
        {{ confirmReset ? '确认重置？再点一次' : '硬重置' }}
      </button>
    </section>

    <div class="foot" v-if="status">
      <span class="status" :class="statusKind">{{ status }}</span>
    </div>
  </div>
</template>

<style scoped>
.body {
  padding: 2px 16px 16px;
}
.sec {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 14px 0;
  border-bottom: 1px solid var(--line);
}
.sec.last {
  border-bottom: none;
}
.sec-title {
  font-size: 12px;
  letter-spacing: 0.04em;
  color: var(--dim);
}
.sec-title.danger {
  color: var(--danger);
}
.kv {
  display: flex;
  justify-content: space-between;
  font-size: 12px;
}
.kv .k { color: var(--dim); }
.hint {
  margin: 0;
  font-size: 12px;
  line-height: 1.7;
  color: var(--dim);
}
.hint b {
  color: var(--text);
  font-weight: 500;
}
.tick {
  display: flex;
  align-items: center;
  gap: 12px;
}
.tick .slider {
  flex: 1;
  min-width: 0;
  accent-color: var(--accent);
}
.tick .v {
  font-size: 12px;
  min-width: 56px;
  text-align: right;
}
.btn {
  align-self: flex-start;
  padding: 6px 12px;
  font-size: 12px;
  color: var(--text);
  background: var(--panel);
  border: 1px solid var(--line);
  border-radius: 4px;
  cursor: pointer;
  transition: border-color 120ms;
}
.btn:hover { border-color: var(--accent); }
.btn.accent { border-color: var(--accent); color: var(--accent); }
.btn.danger { border-color: var(--danger); color: var(--danger); }
.btn:disabled {
  opacity: 0.4;
  color: var(--dim);
  border-color: var(--line);
  cursor: default;
}
.ta {
  width: 100%;
  min-height: 76px;
  padding: 8px;
  font-size: 11px;
  line-height: 1.5;
  color: var(--text);
  background: var(--bg);
  border: 1px solid var(--line);
  border-radius: 4px;
  outline: none;
  resize: vertical;
}
.ta:focus { border-color: var(--accent); }

/* ── 调试模式 ── */
.sw {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 12px;
  color: var(--text);
  cursor: pointer;
}
.sw input {
  accent-color: var(--accent);
  cursor: pointer;
}
.dbg {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 10px 12px;
  border: 1px dashed var(--line);
  border-radius: 4px;
  background: var(--bg);
}
.dbg-now,
.dbg-row {
  display: flex;
  align-items: center;
  gap: 10px;
  font-size: 12px;
}
.dbg-now .k,
.dbg-row .k {
  flex: 0 0 auto;
  white-space: nowrap;
  color: var(--dim);
}
.dbg-now .v {
  color: var(--text);
  word-break: break-all;
}
.dbg-row .ipt {
  flex: 1 1 auto;
  min-width: 0;
  padding: 6px 8px;
  font-size: 12px;
  color: var(--text);
  background: var(--panel);
  border: 1px solid var(--line);
  border-radius: 4px;
  outline: none;
}
.dbg-row .ipt:focus { border-color: var(--accent); }
.dbg-row .btn {
  align-self: stretch;
  padding: 4px 10px;
}
.foot {
  padding: 10px 0 0;
}
.status { font-size: 12px; }
.status.ok { color: var(--accent); }
.status.err { color: var(--danger); }
.status.warn { color: var(--warn); }
.mono { font-family: var(--font-mono); }
</style>
