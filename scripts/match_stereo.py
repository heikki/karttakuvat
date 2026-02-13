#!/usr/bin/env python3
"""
Match Apple Photos items to stereoscopic originals in iCloud Drive.

Steps:
  1. Scan 3D folders in iCloud Drive, parse datetime from filenames
  2. Query Apple Photos for all items, compute camera-clock datetime (Finnish time)
  3. Match by datetime
  4. Rename stereo files to normalized format (YYYY-MM-DDTHH-MM-SS)
  5. Update original_filename in Photos.sqlite

Usage:
    python match_stereo.py              # Dry run — show matches and renames
    python match_stereo.py --rename     # Rename stereo files
    python match_stereo.py --update-db  # Update Photos.sqlite original_filename

Requirements:
    - osxphotos: pipx install osxphotos
    - Photos app must be CLOSED when using --update-db
"""

import argparse
import json
import re
import sqlite3
import subprocess
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path
from zoneinfo import ZoneInfo

STEREO_ROOT = Path.home() / "Library/Mobile Documents/com~apple~CloudDocs/3D"
PHOTOS_DB = Path.home() / "Pictures/Photos Library.photoslibrary/database/Photos.sqlite"
FINNISH_TZ = ZoneInfo("Europe/Helsinki")

# Pattern: old format "2014-07-29 22:29:40.jpg fullsbs.jpg" or new "2014-07-29T22-29-40 fullsbs.jpg"
STEREO_OLD_RE = re.compile(
    r"^(\d{4}-\d{2}-\d{2}) (\d{2}:\d{2}:\d{2})"  # date and time
    r"(?:\.jpg)?"                                    # optional .jpg in middle
    r"(?: (fullsbs))?"                               # optional fullsbs suffix
    r"\.(jpg|mov|mp4)$"                              # final extension
)
STEREO_NEW_RE = re.compile(
    r"^(\d{4}-\d{2}-\d{2})T(\d{2})-(\d{2})-(\d{2})"  # date and time
    r"(?: (fullsbs))?"                                   # optional fullsbs suffix
    r"\.(jpg|mov|mp4)$"                                  # final extension
)


def scan_stereo_files():
    """Scan 3D folder tree and parse datetime from filenames.

    Returns dict: {datetime_str: [(path, suffix, ext), ...]}
    where datetime_str is "YYYY-MM-DD HH:MM:SS"
    """
    files = {}
    for path in STEREO_ROOT.rglob("*"):
        if not path.is_file():
            continue
        # Try old format: "2014-07-29 22:29:40.jpg fullsbs.jpg"
        m = STEREO_OLD_RE.match(path.name)
        if m:
            date_part, time_part, suffix, ext = m.groups()
            dt_str = f"{date_part} {time_part}"
            suffix = suffix or ""
            files.setdefault(dt_str, []).append((path, suffix, ext))
            continue
        # Try new format: "2014-07-29T22-29-40 fullsbs.jpg"
        m = STEREO_NEW_RE.match(path.name)
        if m:
            date_part, h, mi, s, suffix, ext = m.groups()
            dt_str = f"{date_part} {h}:{mi}:{s}"
            suffix = suffix or ""
            files.setdefault(dt_str, []).append((path, suffix, ext))
            continue
        if not path.name.startswith("."):
            print(f"  Skipped (no match): {path.relative_to(STEREO_ROOT)}")
    return files


def parse_stereo_dt_parts(path):
    """Extract (date_part, time_hms, suffix, ext) from a stereo filename."""
    m = STEREO_OLD_RE.match(path.name)
    if m:
        date_part, time_part, suffix, ext = m.groups()
        return date_part, time_part, suffix or "", ext
    m = STEREO_NEW_RE.match(path.name)
    if m:
        date_part, h, mi, s, suffix, ext = m.groups()
        return date_part, f"{h}:{mi}:{s}", suffix or "", ext
    return None


def compute_new_name(path, suffix, ext):
    """Compute the normalized filename for a stereo file."""
    parts = parse_stereo_dt_parts(path)
    if parts:
        date_part, time_part, _, _ = parts
    else:
        # Fallback: use suffix/ext as passed
        return path.name
    dt_norm = f"{date_part}T{time_part.replace(':', '-')}"
    if suffix:
        return f"{dt_norm} {suffix}.{ext}"
    return f"{dt_norm}.{ext}"


def query_all_items():
    """Query Apple Photos for all non-hidden items with JSON metadata."""
    items = []
    for kind in ["--only-photos", "--only-movies"]:
        cmd = ["osxphotos", "query", "--not-hidden", kind, "--json"]
        result = subprocess.run(cmd, capture_output=True, text=True)
        if result.returncode != 0:
            print(f"Error querying {kind}: {result.stderr}")
            sys.exit(1)
        if result.stdout.strip():
            items.extend(json.loads(result.stdout))
    return items


def item_to_exif_dt(item):
    """Get the EXIF date as-is (camera clock time).

    The exif_info.date field preserves the original camera time with timezone,
    e.g. "2015-03-20T21:01:18+02:00". We just need the local time part
    since stereo files are named by camera clock time.
    """
    exif = item.get("exif_info") or {}
    date_str = exif.get("date")
    if date_str:
        try:
            dt = datetime.fromisoformat(date_str)
            return dt.strftime("%Y-%m-%d %H:%M:%S")
        except Exception:
            pass
    return None


def item_to_finnish_dt(item):
    """Convert a Photos item's date to Finnish time datetime string.

    Fallback when EXIF date is not available. Photos stores date as ISO:
    "2015-03-18T12:06:32-04:00" -> Finnish time: "2015-03-18 18:06:32"
    """
    date_str = item.get("date")
    if not date_str:
        return None
    try:
        dt = datetime.fromisoformat(date_str)
        dt_fi = dt.astimezone(FINNISH_TZ)
        return dt_fi.strftime("%Y-%m-%d %H:%M:%S")
    except Exception:
        return None


def original_filename_to_dt(filename):
    """Parse datetime from original_filename if it contains one.

    Handles: "2015-03-29T13-50-47.mov" -> "2015-03-29 13:50:47"
    """
    if not filename:
        return None
    m = re.match(r"(\d{4}-\d{2}-\d{2})T(\d{2})-(\d{2})-(\d{2})\.\w+$", filename)
    if m:
        return f"{m.group(1)} {m.group(2)}:{m.group(3)}:{m.group(4)}"
    return None


def match_items(items, stereo_files):
    """Match Photos items to stereo files by datetime.

    Tries exact Finnish time first, then ±1h and ±2h offsets to account
    for the camera clock being set to EET (UTC+2) without DST adjustment.

    Returns list of (item, stereo_path, new_name) tuples.
    """
    matched = []

    for item in items:
        uuid = item["uuid"]
        orig_fn = item.get("original_filename", "")

        # Try these sources in order of reliability:
        # 1. EXIF date (raw camera clock time — best match)
        # 2. Original filename (videos with datetime in name)
        # 3. Photos date converted to Finnish time (fallback)
        dt_candidates = []

        exif_dt = item_to_exif_dt(item)
        if exif_dt:
            dt_candidates.append(exif_dt)

        orig_dt = original_filename_to_dt(orig_fn)
        if orig_dt and orig_dt not in dt_candidates:
            dt_candidates.append(orig_dt)

        fi_dt = item_to_finnish_dt(item)
        if fi_dt and fi_dt not in dt_candidates:
            dt_candidates.append(fi_dt)

        for dt_str in dt_candidates:
            if dt_str in stereo_files:
                for path, suffix, ext in stereo_files[dt_str]:
                    new_name = compute_new_name(path, suffix, ext)
                    matched.append((item, path, new_name))
                break

    return matched


def rename_all_stereo_files(stereo_files, dry_run=True):
    """Rename all stereo files to normalized format (not just matched ones)."""
    renames = []
    for dt_str, entries in stereo_files.items():
        for path, suffix, ext in entries:
            new_name = compute_new_name(path, suffix, ext)
            if path.name != new_name:
                renames.append((path, path.parent / new_name))

    if not renames:
        print("No renames needed.")
        return

    print(f"\n{'Would rename' if dry_run else 'Renaming'} {len(renames)} files:")
    for old, new in renames:
        print(f"  {old.name} -> {new.name}")
        if not dry_run:
            old.rename(new)

    if not dry_run:
        print(f"Renamed {len(renames)} files.")


def update_original_filenames(matched, dry_run=True):
    """Update ZORIGINALFILENAME in Photos.sqlite."""
    updates = []
    for item, path, new_name in matched:
        uuid = item["uuid"]
        old_fn = item.get("original_filename", "")
        if old_fn != new_name:
            updates.append((uuid, old_fn, new_name))

    if not updates:
        print("No database updates needed.")
        return

    print(f"\n{'Would update' if dry_run else 'Updating'} {len(updates)} original_filenames:")
    for uuid, old_fn, new_fn in updates[:20]:
        albums = item.get("albums", [])
        print(f"  {uuid}: {old_fn} -> {new_fn}")
    if len(updates) > 20:
        print(f"  ... and {len(updates) - 20} more")

    if dry_run:
        return

    db = sqlite3.connect(str(PHOTOS_DB))
    cur = db.cursor()
    for uuid, old_fn, new_fn in updates:
        cur.execute("""
            UPDATE ZADDITIONALASSETATTRIBUTES
            SET ZORIGINALFILENAME = ?
            WHERE ZASSET = (SELECT Z_PK FROM ZASSET WHERE ZUUID = ?)
        """, (new_fn, uuid))
    db.commit()
    print(f"Updated {db.total_changes} rows in Photos.sqlite.")
    db.close()


def main():
    parser = argparse.ArgumentParser(description="Match Photos to stereoscopic originals")
    parser.add_argument("--rename", action="store_true", help="Rename stereo files (default: dry run)")
    parser.add_argument("--update-db", action="store_true", help="Update Photos.sqlite original_filename")
    args = parser.parse_args()

    dry_run = not args.rename and not args.update_db

    # Step 1: Scan stereo files
    print(f"Scanning {STEREO_ROOT}...")
    stereo_files = scan_stereo_files()
    total_stereo = sum(len(v) for v in stereo_files.values())
    print(f"Found {total_stereo} stereo files across {len(stereo_files)} timestamps\n")

    # Step 2: Query Photos
    print("Querying Apple Photos...")
    items = query_all_items()
    print(f"Found {len(items)} items in Photos\n")

    # Step 3: Match
    matched = match_items(items, stereo_files)

    matched_dts = {path.parent / path.name for _, path, _ in matched}
    unmatched_stereo = []
    for dt_str, entries in stereo_files.items():
        for path, suffix, ext in entries:
            if path not in matched_dts:
                unmatched_stereo.append((dt_str, path))

    print(f"Matched: {len(matched)}")
    print(f"Unmatched stereo files: {len(unmatched_stereo)}")

    if unmatched_stereo:
        print("\nUnmatched stereo files:")
        for dt_str, path in sorted(unmatched_stereo)[:30]:
            print(f"  {dt_str}  {path.relative_to(STEREO_ROOT)}")
        if len(unmatched_stereo) > 30:
            print(f"  ... and {len(unmatched_stereo) - 30} more")

    # Show sample matches
    if matched:
        print("\nSample matches:")
    for item, path, new_name in matched[:10]:
        uuid = item["uuid"]
        albums = item.get("albums", [])
        album_str = f" [{albums[0]}]" if albums else ""
        print(f"  {uuid}{album_str}: {path.name} -> {new_name}")

    # Step 4: Rename all stereo files (not just matched)
    if args.rename:
        rename_all_stereo_files(stereo_files, dry_run=False)
    elif dry_run:
        rename_all_stereo_files(stereo_files, dry_run=True)

    # Step 5: Update database
    if args.update_db:
        update_original_filenames(matched, dry_run=False)
    elif dry_run:
        update_original_filenames(matched, dry_run=True)

    if dry_run:
        print("\nDry run. Use --rename to rename files, --update-db to update Photos.sqlite.")


if __name__ == "__main__":
    main()
