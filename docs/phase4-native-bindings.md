# Phase 4: Native ObjC Bindings

Replace subprocess calls (`osascript`, `sips`, `qlmanage`) with a compiled `.dylib` loaded via `bun:ffi`. Eliminates process spawn overhead and temp file management.

## Context

Current subprocess calls to replace:
- `sips` — HEIC→JPEG conversion, thumbnail generation (`scripts/export.ts:147-284`)
- `qlmanage` — video frame extraction (`scripts/export.ts:166-195`)
- `osascript` — set photo location/date, quit Photos.app (`scripts/photos-edit.ts:30-122`)

Keep as-is:
- `Bun.spawn(['open', url])` — negligible overhead, no benefit from FFI
- Direct Photos.sqlite reads via `bun:sqlite` — PhotoKit doesn't expose timezone, keep SQLite
- `setTimezone()` direct SQLite write — no PhotoKit equivalent

## Sub-Phase 4A: Image Processing (sips + qlmanage → ImageIO + AVFoundation)

No authorization needed. Highest value — eliminates temp dirs and multi-process overhead.

**New file: `native/karttakuvat-bridge.mm`**

`extern "C"` functions:
- `int convertToJpeg(const char* in, const char* out, float quality)` — CGImageSource → CGImageDestination with kUTTypeJPEG. Replaces `sipsConvert()`.
- `int resizeToJpeg(const char* in, const char* out, int maxDim, float quality)` — CGContext resize + JPEG write. Replaces `createThumbnail()`.
- `int extractVideoFrame(const char* video, const char* out, int maxDim)` — AVAssetImageGenerator.copyCGImage(at:). Replaces `qlmanageToJpeg()`.

**New file: `native/native-bridge.ts`**

TypeScript FFI wrapper using `dlopen`. Dylib discovery:
1. `${Resources}/app/libkarttakuvat.dylib` (electrobun dev + installed)
2. `${projectRoot}/native/libkarttakuvat.dylib` (bun dev)

**Modify: `scripts/export.ts`**
- Replace `sipsConvert()` → `convertToJpeg()`
- Replace `createThumbnail()` → `resizeToJpeg()`
- Replace `qlmanageToJpeg()` → `extractVideoFrame()`
- Remove `run()` shell helper, temp dir management

## Sub-Phase 4B: AppleScript via NSAppleScript (osascript → in-process)

Same AppleScript, no process spawn. Better error capture via error buffer pattern.

**Add to `native/karttakuvat-bridge.mm`:**
- `int photosSetLocation(const char* uuid, double lat, double lon, char* errBuf, int errBufLen)`
- `int photosSetDateTime(const char* uuid, int yr, int mo, int dy, int hr, int mi, int sc, char* errBuf, int errBufLen)`
- `int photosQuit(char* errBuf, int errBufLen)`

All use `NSAppleScript executeAndReturnError:` internally.

**Modify: `scripts/photos-edit.ts`**
- Replace `runAppleScript()` + `spawn(['osascript'])` with FFI calls
- `setLocation`, `setDateTime`, `quitPhotosApp` become synchronous

**Modify: `api-routes.ts`**
- Drop `await` on `setLocation`/`setDateTime`/`quitPhotosApp` calls

## Build Pipeline

```
"build:native": "clang++ -shared -fPIC -O2 -fobjc-arc -framework Foundation -framework ImageIO -framework AVFoundation -framework CoreGraphics -o native/libkarttakuvat.dylib native/karttakuvat-bridge.mm"
"build:app": "bun run build:native && bun run bundle:scripts && electrobun build"
```

Electrobun config copy: `'native/libkarttakuvat.dylib': 'libkarttakuvat.dylib'`

## Implementation Order

1. Create `native/karttakuvat-bridge.mm` with image functions
2. Create `native/native-bridge.ts` with FFI wrapper
3. Add `build:native` to package.json, verify compilation
4. Update `scripts/export.ts` to use native functions
5. Test: run full export, compare output to sips/qlmanage results
6. Add AppleScript functions to bridge
7. Update `scripts/photos-edit.ts` and `api-routes.ts`
8. Test: location/time edits from app UI
9. Bundle dylib into electrobun app, test dev + installed

## Files

| New | Purpose |
|-----|---------|
| `native/karttakuvat-bridge.mm` | ObjC++ — ImageIO, AVFoundation, NSAppleScript |
| `native/native-bridge.ts` | TypeScript FFI wrapper (dlopen + typed exports) |

| Modified | Change |
|----------|--------|
| `scripts/export.ts` | Replace sips/qlmanage with native FFI calls |
| `scripts/photos-edit.ts` | Replace osascript with native NSAppleScript FFI |
| `api-routes.ts` | Sync calls to setLocation/setDateTime/quitPhotosApp |
| `electrobun.config.ts` | Copy dylib into app bundle |
| `package.json` | Add build:native script |

## Risks

- **FFI string lifetime**: Use `Buffer.from(str + "\0")` pattern (same as Electrobun GC patch)
- **HEIC support**: ImageIO on macOS natively reads HEIC since 10.13 — no issue
- **AVAssetImageGenerator threading**: copyCGImage(at:) is thread-safe for reads
- **Bundled scripts + FFI**: `bun build --target bun` inlines native-bridge.ts; dlopen resolves at runtime via process.argv0

## Verification

1. `bun run build:native` compiles without errors
2. Full export produces identical JPEGs to sips/qlmanage output
3. Thumbnail dimensions match (400px max edge)
4. Video frames extracted correctly
5. Location/date edits work from app UI
6. `electrobun dev` and installed app both find dylib
