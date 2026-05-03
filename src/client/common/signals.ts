import { Signal } from '@lit-labs/signals';

// Module-level effect — first run is immediate; re-runs on a microtask
// when tracked signals change. For element-scoped effects, prefer the
// SignalWatcher mixin's updateEffect() (auto-cleanup on disconnect).
export function effect(fn: () => void): () => void {
  const c = new Signal.Computed(fn);
  const w = new Signal.subtle.Watcher(() => {
    queueMicrotask(() => {
      c.get();
      w.watch();
    });
  });
  w.watch(c);
  c.get();
  return () => {
    w.unwatch(c);
  };
}
