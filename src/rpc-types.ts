/**
 * Shared RPC type definition for Electrobun communication between
 * the Bun main process and the webview.
 *
 * This file is imported by both bun-side (src/main.ts) and browser-side (src/index.ts).
 * It uses a structural type compatible with ElectrobunRPCSchema without importing
 * from a side-specific module.
 */
export interface AppRPC {
  bun: {
    requests: Record<string, never>;
    messages: Record<string, never>;
  };
  webview: {
    requests: Record<string, never>;
    messages: {
      setApiBase: { url: string };
    };
  };
}
