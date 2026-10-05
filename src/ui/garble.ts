/**
 * 乱码工具：涌升失败演出的 D / A 两套方案 + 内容 D→A 渐入混合。
 * 与沙盒（ascend-cinematic-demo.html）逐字符对齐，便于项目与演示一致。
 *
 * 戒律：纯函数、零 Vue 依赖，供演出组件与永久故障态（导航/成就）复用。
 */

// ───────────────────────── D 方案（真词打散重组） ─────────────────────────
// 与演示一致：逐字重排 + 30% 偶发形近字替换。
// ⚠️ 「极 / 限 / 后 / 继」是 2026-10-04 补入的（用户定案）：base2 的按钮词就是「极限 / 后继」，
//    而本表原先没有它们 ⇒ 按钮的 D 态**只有换位、没有任何字形损坏**，看起来只是「词被倒过来」。
//    （NEAR 表里其实一直有 极→級 / 限→垠 / 后→後 / 继→断，只是 D 方案读的是本表。）
const SIMILAR: Record<string, string> = {
  '序': '兟', '数': '敳', '升': '昇', '级': '岌', '成': '晟', '就': '蹴',
  '设': '沒', '置': '値', '本': '夲', '次': '吹', '涌': '湧',
  '失': '夨', '败': '敗',
  '极': '級', '限': '垠', '后': '後', '继': '断',
};

/**
 * **换位**概率随**字数**衰减（用户定案 2026-10-04：「字越少，换位概率越小」）。
 *   (n−1)/4，封顶 0.9 ⇒ 2 字 25% / 3 字 50% / 4 字 75% / 5 字及以上 90%。
 * ⚠️ 为什么单拎出换位：Fisher-Yates 在 2 字上就是**50% 互换**，而 2 字正是全站最短、
 *    最常出现在按钮上的词（后继 / 极限 / 涌升 / 序数 / 升级…）。把「极限」倒成「限极」
 *    是最扎眼、也最不像故障的形态（读起来只是一个错的正常词），故 2 字只留 25%。
 *    长串相反：整串一字不差地排列回去的概率本来就极低，换位才是主要观感。
 * ⚠️ 这个数就是「**字序真的被改动**」的概率本身，不是「跑一次洗牌」的概率 ——
 *    洗牌有相当概率原样返回（2 字足有一半），所以下面洗回原样时会补一次相邻对换。
 */
function permuteProb(n: number): number {
  return Math.min(0.9, (n - 1) / 4);
}

export function scramble(s: string): string {
  const arr = [...s];
  const n = arr.length;
  if (n > 1 && Math.random() < permuteProb(n)) {
    for (let i = n - 1; i > 0; i--) {
      const j = (Math.random() * (i + 1)) | 0;
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    // 洗回原样 ⇒ 强制换一对相邻字，保证「决定换位」时字序真的动了。
    // 否则 2 字的实际位移率只有 permuteProb 的一半（探针实测 25% 会缩水成 12.5%）。
    if (arr.join('') === s) { const t = arr[0]; arr[0] = arr[1]; arr[1] = t; }
  }
  for (let i = 0; i < arr.length; i++) {
    if (Math.random() < 0.3) {
      const rep = SIMILAR[arr[i]];
      if (rep) arr[i] = rep;
    }
  }
  return arr.join('');
}

// ───────────────────────── A 方案（CJK 区段随机取字） ─────────────────────────
// 与演示同款生成法；剔除假名段（0x3040–0x30FF）以避免快速跳动时行高抖动。
const CJK_RANGES: ReadonlyArray<readonly [number, number]> = [
  [0x4e00, 0x9fff],
  [0x3400, 0x4dbf],
];

export function rndCJK(): string {
  const r = CJK_RANGES[(Math.random() * CJK_RANGES.length) | 0];
  return String.fromCharCode(r[0] + ((Math.random() * (r[1] - r[0])) | 0));
}

// ───────────────────────── 内容 D 侧用的形近字表（D→A 渐入） ─────────────────────────
export const NEAR: Record<string, string> = {
  '后': '後', '继': '断', '极': '級', '限': '垠', '换': '挽', '基': '甚',
  '计': '計', '成': '诚', '功': '攻', '率': '効', '速': '逑', '动': '勭',
  '升': '弁', '涌': '湧', '失': '夭', '败': '貱', '增': '増', '益': '',
  '自': '臫', '级': '級', '当': '當', '前': '刖', '无': '無', '建': '徤',
  '议': '議', '优': '優', '先': '兇', '点': '點', '满': '滿', '解': '觧',
  '锁': '鎖', '每': '毎', '次': '夾', '并': '倂', '更': '吏', '多': '夛',
  '份': '伒', '副': '冨', '与': '與', '共': '兯', '享': '侕', '同': '仝',
  '节': '節', '拍': '狛',
};

const clamp = (x: number, a: number, b: number) => Math.max(a, Math.min(b, x));
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

/**
 * 内容元素随进度平滑腐蚀：D 错位率(50→80 渐升) + 80→90 逐字交叉淡换成 A。
 * 这样从「勉强能读懂」渐变到「信息完全错乱」，无硬切。
 */
export function garbleText(orig: string, p: number): string {
  const dProb = clamp(lerp(0.15, 0.95, (p - 50) / 30), 0, 0.95); // 50→80
  const aBlend = clamp((p - 80) / 10, 0, 1);                      // 80→90 交叉淡换
  let out = '';
  for (const ch of orig) {
    if (ch === ' ' || ch === '　') { out += ch; continue; }
    const r = Math.random();
    if (r < aBlend) out += rndCJK();                       // A 侧：完全随机汉字
    else if (r < aBlend + dProb) out += (NEAR[ch] || rndCJK()); // D 侧：形近字
    else out += ch;                                        // 保留原字
  }
  return out;
}
