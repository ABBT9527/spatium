/**
 * 极简事件总线（逻辑 → 渲染的单向通知）。
 * 渲染层只读 state；事件只用于触发动效，不承载数据。
 */

export type GameEvent =
  | { type: 'cycle'; round: number; time: number }
  | { type: 'place'; index: number }
  | { type: 'board-resize'; size: number }
  | { type: 'stalled'; round: number };

type Handler = (e: GameEvent) => void;

const handlers = new Map<string, Set<Handler>>();

export function on(type: GameEvent['type'], h: Handler): () => void {
  let set = handlers.get(type);
  if (!set) {
    set = new Set();
    handlers.set(type, set);
  }
  set.add(h);
  return () => set!.delete(h);
}

export function emit(e: GameEvent): void {
  const set = handlers.get(e.type);
  if (!set) return;
  for (const h of set) h(e);
}
