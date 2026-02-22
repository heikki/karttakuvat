#!/usr/bin/env bun
/**
 * Sync metadata from Apple Photos library.
 *
 * Builds items in app.db for all geotagged photos and videos in the library.
 * Images are converted on demand by the server — no pre-export needed.
 *
 * Usage:
 *   bun src/server/sync.ts
 *
 * Requirements:
 *   - Full Disk Access for Terminal in System Settings
 */
import { unlinkSync } from 'node:fs';
import { join } from 'node:path';

import {
  deleteItems,
  getAllItems,
  getItemCount,
  openAppDb,
  upsertItems
} from './app-db';
import { buildItemEntry, sortEntries, type ItemEntry } from './items';
import { openPhotosDb, queryPhotos, queryVideos } from './photos-db';

const PROJECT_ROOT = join(import.meta.dir, '..', '..');
const dataDirArg = process.argv.find((a) => a.startsWith('--data-dir='));
const PUBLIC_DIR =
  dataDirArg === undefined
    ? join(PROJECT_ROOT, 'data')
    : dataDirArg.split('=')[1]!;
const CACHE_FULL_DIR = join(PUBLIC_DIR, 'cache', 'full');
const CACHE_THUMB_DIR = join(PUBLIC_DIR, 'cache', 'thumb');

function cleanOrphans(
  orphanUuids: Set<string>,
  oldItems: Map<string, ItemEntry>
): void {
  console.log(`\n  Deleted from Photos: ${orphanUuids.size}`);
  for (const uuid of [...orphanUuids].sort()) {
    const old = oldItems.get(uuid);
    const albumStr =
      old !== undefined && old.albums.length > 0 ? ` [${old.albums[0]}]` : '';
    console.log(`    ${uuid}${albumStr}`);
    // Clean cached images
    for (const dir of [CACHE_FULL_DIR, CACHE_THUMB_DIR]) {
      try {
        unlinkSync(join(dir, `${uuid}.jpg`));
      } catch {
        /* missing is ok */
      }
    }
  }
  deleteItems([...orphanUuids]);
}

interface CoordsChangedArgs {
  oldLat: number | null;
  oldLon: number | null;
  newLat: number | null;
  newLon: number | null;
}

function coordsChanged(args: CoordsChangedArgs, threshold = 0.0001): boolean {
  const { oldLat, oldLon, newLat, newLon } = args;
  if (
    oldLat === null ||
    oldLon === null ||
    newLat === null ||
    newLon === null
  ) {
    return false;
  }
  return (
    Math.abs(oldLat - newLat) > threshold ||
    Math.abs(oldLon - newLon) > threshold
  );
}

interface LocationChange {
  uuid: string;
  oldLat: number | null;
  oldLon: number | null;
  newLat: number | null;
  newLon: number | null;
  albums: string[];
}

function detectChanges(
  entries: ItemEntry[],
  oldItems: Map<string, ItemEntry>
): { locationChanges: LocationChange[]; skippedNoLocation: number } {
  const locationChanges: LocationChange[] = [];
  let skippedNoLocation = 0;

  for (const entry of entries) {
    const old = oldItems.get(entry.uuid);
    if (entry.lat !== null && entry.lon !== null) {
      if (
        old !== undefined &&
        coordsChanged({
          oldLat: old.lat,
          oldLon: old.lon,
          newLat: entry.lat,
          newLon: entry.lon
        })
      ) {
        locationChanges.push({
          uuid: entry.uuid,
          oldLat: old.lat,
          oldLon: old.lon,
          newLat: entry.lat,
          newLon: entry.lon,
          albums: entry.albums
        });
      }
    } else {
      skippedNoLocation++;
    }
  }

  return { locationChanges, skippedNoLocation };
}

function reportStats(entries: ItemEntry[], skippedNoLocation: number): void {
  const photoCount = entries.filter((e) => e.type === 'photo').length;
  const videoCount = entries.filter((e) => e.type === 'video').length;
  const exifCount = entries.filter((e) => e.gps === 'exif').length;
  const inferredCount = entries.filter((e) => e.gps === 'inferred').length;
  const userCount = entries.filter((e) => e.gps === 'user').length;

  console.log(`\nUpdated items in app.db`);
  console.log(
    `  Total entries: ${entries.length} (${photoCount} photos, ${videoCount} videos)`
  );
  console.log(`  EXIF GPS: ${exifCount}`);
  console.log(`  Inferred location: ${inferredCount}`);
  console.log(`  User modified: ${userCount}`);
  if (skippedNoLocation > 0) {
    console.log(`  Skipped (no location): ${skippedNoLocation}`);
  }
}

function reportLocationChanges(changes: LocationChange[]): void {
  if (changes.length === 0) return;
  console.log(`\n  Location changes detected: ${changes.length}`);
  for (const change of changes) {
    const albumStr = change.albums.length > 0 ? ` [${change.albums[0]}]` : '';
    console.log(`    ${change.uuid}${albumStr}`);
    console.log(
      `      ${change.oldLat?.toFixed(6)}, ${change.oldLon?.toFixed(6)} -> ${change.newLat?.toFixed(6)}, ${change.newLon?.toFixed(6)}`
    );
  }
}

function main(): void {
  openAppDb(PUBLIC_DIR);

  const oldItemsList = getAllItems();
  const oldItems = new Map(oldItemsList.map((i) => [i.uuid, i]));
  console.log(`Loaded ${oldItems.size} existing entries for change detection`);

  const photosDb = openPhotosDb();
  const photos = queryPhotos(photosDb);
  const videos = queryVideos(photosDb);
  photosDb.close();
  console.log(
    `Found ${photos.length} photos, ${videos.length} videos in Apple Photos`
  );

  const entries: ItemEntry[] = [];
  for (const record of [...photos, ...videos]) {
    entries.push(buildItemEntry(record));
  }
  sortEntries(entries);

  upsertItems(entries);

  const { locationChanges, skippedNoLocation } = detectChanges(
    entries,
    oldItems
  );
  reportStats(entries, skippedNoLocation);

  // Clean up entries for photos deleted from library
  const entryUuids = new Set(entries.map((e) => e.uuid));
  const oldUuids = new Set(oldItems.keys());
  const orphanUuids = new Set([...oldUuids].filter((u) => !entryUuids.has(u)));
  if (orphanUuids.size > 0) cleanOrphans(orphanUuids, oldItems);

  reportLocationChanges(locationChanges);
}

try {
  main();
} catch (err: unknown) {
  console.error(err);
  process.exit(1);
}
