import { Signal } from '@lit-labs/signals';

// Module-level effect — first run is immediate; re-runs on a microtask
// when tracked signals change. For element-scoped effects, prefer the
// SignalWatcher mixin's updateEffect() (auto-cleanup on disconnect).
//
// Dependency-tracking caveat: only signals actually `.get()`-ed during a
// run are registered as dependencies. If the body short-circuits on the
// FIRST run before reading a signal (e.g. `if (notReady) return` before
// `data.get()`), that signal is never tracked and the effect won't re-run
// when it changes — even after the guard later turns truthy. Read every
// dependency at the top of the body, before any early-return:
//
//   effect(() => {
//     const a = sigA.get();
//     const b = sigB.get();
//     if (notReadyYet) return;
//     doStuff(a, b);
//   });
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
