import { Signal } from '@lit-labs/signals';

// Module-level effect: runs `fn` once immediately, then re-runs on a microtask
// whenever any signal read inside `fn` changes. Returns a dispose function.
//
// For element-scoped effects, prefer the `updateEffect()` method that the
// SignalWatcher mixin adds to elements — it cleans up on disconnect.
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
