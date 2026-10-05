/**
 * 全局固定常量。
 *
 * 戒律：这里的每一个数都有 rationale，禁止"拍脑袋"修改。
 * 尤其 r / s / e* 三者在数值上是锁死的（见 MEMORY §3.1 稳定性定理）。
 */

/** 成本比：每买一级，成本 ×2.7 */
export const R_COST = 2.7;

/** 效果比：每买一级，产能 ×2.0 */
export const S_EFFECT = 2.0;

/** 临界弹性 e* = ln(r)/ln(s)。有效弹性必须恒等于它（戒律 N1） */
export const E_STAR = Math.log(R_COST) / Math.log(S_EFFECT); // 1.4330

/** 重置目标领先级数：目标 = 第 (lv + LEAD) 级成本 */
export const LEAD = 1;

/** 基础速率（次/秒），对应 bal-sim 的 manualRate */
export const R0 = 1.2;

/** 逻辑 tick 频率（Hz）。渲染 rAF 60fps 与之解耦 */
export const TICK_HZ = 20;

/** Governor 阻尼系数 */
export const GOV_LAM = 0.6;

/** Governor 单步限速：每轮 Θ 最多变化 ±25%（扫描后最优值，>1.25 无收益） */
export const GOV_RATE_LIM = 1.25;

/**
 * Governor 死区（ln 尺度）：偏差小于 5% 时不修正。
 * 没有死区时，2.5% 的稳态误差会被积分器一直累积 ⇒ Θ 从 1.5 漂到 7.8。
 * 死区让 Θ 真正"隐形"：只要跟踪得住，它就不动。
 */
export const GOV_DEADBAND = 0.05;

/**
 * 双档 tick：主动 / 挂机倍率的**唯一来源**（戒律 Q3）。
 * 禁止在别处再乘一次倍率。
 *
 * 取值依据（headless 冒烟实测，勿手改）：
 *   PHI_HAND = 1.00 —— 参考最优网格摆法可达的 Φ 上界（精确 δ* 口径下必达 1.0）
 *   PHI_IDLE = 0.40 —— 求解器维持的水平（贪心 + 有限候选，不做全局重排）
 *   ⇒ 完美玩家倍率 2.50×，正好落在 Q3 的 2.0–2.5 区间上沿。
 *   典型玩家（Φ 0.70–0.90）的实际倍率是 1.75–2.25× —— 手越稳越接近 2.5。
 */
export const PHI_HAND = 1.0;
export const PHI_IDLE = 0.4;

/** 距上次操作超过该秒数即视为挂机档 */
export const IDLE_WINDOW_SEC = 10;

/**
 * 熵衰时间常数（秒）：停止操作后，Φ 指数衰减回挂机档的速度。
 * 这个值**必须**出现在 solveT 的积分里，否则模型与运行时不一致，
 * 控制器会被迫把 Θ 一路推高去补偿（实测会漂到 7.5×）。
 */
export const PHI_DECAY_TAU = 60;

/** 离线结算上限（秒） */
export const OFFLINE_CAP_SEC = 4 * 3600;

/** 每日注意力预算（秒） */
export const DAILY_ATTN_SEC = 2 * 3600;

/** 单轮耗时上限（秒）—— 超过即纯等待（戒律 N9） */
export const MAX_ROUND_SEC = 200 * 60;
