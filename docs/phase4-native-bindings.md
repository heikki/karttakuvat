# Phase 4: Native ObjC Bindings

Replace subprocess calls (`osascript`, `sips`, `qlmanage`) with a compiled `.dylib` loaded via `bun:ffi`. Eliminates process spawn overhead and temp file management.

## Context

Current subprocess calls to replace:

- ~~`sips` — HEIC→JPEG conversion, thumbnail generation~~ **Done (4A)**
- ~~`qlmanage` — video frame extraction~~ **Done (4A)**
- ~~`osascript` — set photo location/date, quit Photos.app~~ **Done (4B)**

Keep as-is:

- `Bun.spawn(['open', url])` — negligible overhead, no benefit from FFI
- Direct Photos.sqlite reads via `bun:sqlite` — PhotoKit doesn't expose timezone, keep SQLite
- `setTimezone()` direct SQLite write — no PhotoKit equivalent

## Sub-Phase 4A: Image Processing — DONE

Replaced `sips` and `qlmanage` with native ImageIO/AVFoundation via `bun:ffi`.

**`native/karttakuvat-bridge.mm`** — ObjC++ dylib with three `extern "C"` functions:

- `convertToJpeg()` — CGImageSource → CGImageDestination. Handles HEIC, TIFF, PNG, etc.
- `resizeToJpeg()` — CGImageSource thumbnail API → CGImageDestination. 400px max edge for thumbnails.
- `extractVideoFrame()` — AVAssetImageGenerator → CGImageDestination. First frame at max 1920px.

**`native/native-bridge.ts`** — TypeScript FFI wrapper using `dlopen`. Dylib search order:

1. `native/libkarttakuvat.dylib` next to source file (bun dev)
2. `Resources/app/libkarttakuvat.dylib` (electrobun installed)
3. Project root `native/` via path traversal (electrobun dev)

**`scripts/image-cache.ts`** — on-demand image conversion now uses native functions. All conversion functions are synchronous (no subprocess spawning, no temp directories).

**`scripts/export.ts`** — removed. All image serving is on-demand via the image cache.

Build: `bun run build:native` compiles the dylib. Wired into `build:app` and `build:app:stable`.

## Sub-Phase 4B: AppleScript via NSAppleScript — DONE

Replaced `osascript` subprocess spawning with in-process `NSAppleScript` via the existing dylib.

**`native/karttakuvat-bridge.mm`** — one generic function:

- `runAppleScript(const char* script, char* errBuf, int errBufLen)` — `NSAppleScript executeAndReturnError:`. Returns 0 on success, 1 on error with message in errBuf. Covers all three use cases (setLocation, setDateTime, quit) since the AppleScript strings are built in TypeScript.

**`native/native-bridge.ts`** — FFI binding + typed wrapper:

- `runAppleScript(script: string): void` — allocates 1024-byte error buffer, throws on failure with the error message.

**`scripts/photos-edit.ts`**:

- `setLocation`, `setDateTime`, `quitPhotosApp` are now synchronous — call native `runAppleScript()` directly
- Removed `spawn` import and async `runAppleScript()` helper

**`api-routes.ts`**:

- `processLocationEdits()`, `processTimeEdits()` are no longer async
- `handleSaveEdits()` calls them synchronously (no `await`)

## Build Pipeline

```
"build:native": "clang++ -shared -fPIC -O2 -fobjc-arc -Wno-deprecated-declarations -framework Foundation -framework ImageIO -framework AVFoundation -framework CoreGraphics -framework CoreMedia -o native/libkarttakuvat.dylib native/karttakuvat-bridge.mm"
"build:app": "bun run build:native && bun run bundle:scripts && electrobun build"
```

Electrobun config copy: `'native/libkarttakuvat.dylib': 'libkarttakuvat.dylib'`

## Files

| New                            | Purpose                                                  |
| ------------------------------ | -------------------------------------------------------- |
| `native/karttakuvat-bridge.mm` | ObjC++ — ImageIO, AVFoundation, NSAppleScript            |
| `native/native-bridge.ts`      | TypeScript FFI wrapper (dlopen + typed exports)          |

| Modified                  | Change                                             |
| ------------------------- | -------------------------------------------------- |
| `scripts/image-cache.ts`  | Native FFI calls instead of sips/qlmanage          |
| `scripts/photos-edit.ts`  | Native FFI calls instead of osascript subprocess   |
| `api-routes.ts`           | Sync edit pipeline (no async/await for AppleScript)|
| `electrobun.config.ts`    | Copy dylib into app bundle                         |
| `package.json`            | Add build:native script                            |

| Removed             | Reason                                  |
| ------------------- | --------------------------------------- |
| `scripts/export.ts` | Replaced by on-demand image cache       |

## Risks

- **FFI string lifetime**: Use `TextEncoder.encode(str + "\0")` pattern to ensure null-terminated C strings stay alive during FFI calls
- **HEIC support**: ImageIO on macOS natively reads HEIC since 10.13 — no issue
- **AVAssetImageGenerator threading**: copyCGImage(at:) is thread-safe for reads
- **Dylib discovery**: Three search paths cover bun dev, electrobun dev, and installed app contexts
