/**
 * TypeScript FFI wrapper for libkarttakuvat.dylib.
 *
 * Provides convertToJpeg, resizeToJpeg, and extractVideoFrame as typed
 * functions matching the old subprocess-based signatures.
 */
import { dlopen, FFIType, ptr } from 'bun:ffi';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';

function findDylib(): string {
  // 1. Relative to this script's source location (bun dev + bundled scripts)
  const candidates = [
    join(dirname(import.meta.path), 'libkarttakuvat.dylib'),
    // 2. Relative to process.argv[0] for installed app (electrobun)
    join(dirname(process.argv[0] ?? '.'), 'libkarttakuvat.dylib')
  ];
  for (const path of candidates) {
    if (existsSync(path)) return path;
  }
  throw new Error(
    `libkarttakuvat.dylib not found. Searched:\n${candidates.join('\n')}\nRun: bun run build:native`
  );
}

function toCString(s: string): Uint8Array {
  return new TextEncoder().encode(`${s}\0`);
}

const lib = dlopen(findDylib(), {
  convertToJpeg: {
    args: [FFIType.ptr, FFIType.ptr, FFIType.float],
    returns: FFIType.i32
  },
  resizeToJpeg: {
    args: [FFIType.ptr, FFIType.ptr, FFIType.i32, FFIType.float],
    returns: FFIType.i32
  },
  extractVideoFrame: {
    args: [FFIType.ptr, FFIType.ptr, FFIType.i32],
    returns: FFIType.i32
  }
});

export function convertToJpeg(
  input: string,
  output: string,
  quality = 0.9
): boolean {
  const inBuf = toCString(input);
  const outBuf = toCString(output);
  return lib.symbols.convertToJpeg(ptr(inBuf), ptr(outBuf), quality) === 0;
}

export function resizeToJpeg(
  input: string,
  output: string,
  maxDim: number,
  quality = 0.8
): boolean {
  const inBuf = toCString(input);
  const outBuf = toCString(output);
  return (
    lib.symbols.resizeToJpeg(ptr(inBuf), ptr(outBuf), maxDim, quality) === 0
  );
}

export function extractVideoFrame(
  videoPath: string,
  output: string,
  maxDim = 1920
): boolean {
  const inBuf = toCString(videoPath);
  const outBuf = toCString(output);
  return lib.symbols.extractVideoFrame(ptr(inBuf), ptr(outBuf), maxDim) === 0;
}
