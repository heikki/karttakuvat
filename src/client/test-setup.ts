/**
 * Registers happy-dom globals (document, window, customElements, etc.) so
 * Lit components can mount inside bun:test. Loaded via bunfig.toml [test]
 * preload.
 */
import { GlobalRegistrator } from '@happy-dom/global-registrator';

// happy-dom defaults to `about:blank`, where `history.replaceState` no-ops.
// Seeding a real URL lets URL-bound signals and mapView codec round-trip.
GlobalRegistrator.register({ url: 'http://localhost/' });
