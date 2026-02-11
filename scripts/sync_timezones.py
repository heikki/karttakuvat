#!/usr/bin/env python3
"""
Sync correct timezones to Apple Photos based on photo coordinates.

Reads items.json, computes the IANA timezone for each item from its
coordinates, and applies it to Apple Photos using osxphotos timewarp
--timezone --match-time (preserves local time, fixes tz metadata).

Usage:
    python sync_timezones.py              # Dry run (show what would change)
    python sync_timezones.py --apply      # Apply changes to Apple Photos
"""

import argparse
import json
import os
import shutil
import subprocess
import sys
import time

from export import tz_name_from_coords

OSXPHOTOS = shutil.which("osxphotos") or os.path.expanduser("~/.local/bin/osxphotos")


def query_current_timezones(uuids):
    """Query Apple Photos for current timezone offsets.

    Returns dict of {uuid: offset_seconds}.
    """
    import sqlite3
    from pathlib import Path

    db_path = Path.home() / "Pictures/Photos Library.photoslibrary/database/Photos.sqlite"
    if not db_path.exists():
        print("Error: Photos database not found", file=sys.stderr)
        sys.exit(1)

    db = sqlite3.connect(str(db_path))
    cur = db.cursor()
    cur.execute("""
        SELECT a.ZUUID, aa.ZTIMEZONEOFFSET
        FROM ZASSET a
        JOIN ZADDITIONALASSETATTRIBUTES aa ON a.Z_PK = aa.ZASSET
        WHERE aa.ZTIMEZONEOFFSET IS NOT NULL
    """)
    result = dict(cur.fetchall())
    db.close()
    return result


def offset_seconds_to_str(seconds):
    """Convert offset in seconds to string like '+03:00'."""
    sign = "+" if seconds >= 0 else "-"
    seconds = abs(int(seconds))
    h, m = divmod(seconds // 60, 60)
    return f"{sign}{h:02d}:{m:02d}"


def tz_name_to_offset_seconds(tz_name, date_str):
    """Get UTC offset in seconds for a timezone at a given date."""
    from datetime import datetime
    from zoneinfo import ZoneInfo
    try:
        dt = datetime.strptime(date_str, "%Y:%m:%d %H:%M:%S")
        dt = dt.replace(tzinfo=ZoneInfo(tz_name))
        return int(dt.utcoffset().total_seconds())
    except Exception:
        return None


def main():
    parser = argparse.ArgumentParser(description="Sync timezones to Apple Photos")
    parser.add_argument("--apply", action="store_true", help="Apply changes (default is dry run)")
    args = parser.parse_args()

    with open("public/items.json") as f:
        items = json.load(f)

    # Only items with coordinates
    items_with_coords = [i for i in items if i.get("lat") is not None and i.get("lon") is not None and i.get("date")]
    print(f"Items with coordinates: {len(items_with_coords)}")

    # Get current tz offsets from Apple Photos
    all_uuids = {i["uuid"] for i in items_with_coords}
    current_offsets = query_current_timezones(all_uuids)
    print(f"Items with tz in Apple Photos: {len(current_offsets)}")

    # Find mismatches
    changes = []
    for item in items_with_coords:
        uuid = item["uuid"]
        lat, lon = item["lat"], item["lon"]
        date = item["date"]

        tz_name = tz_name_from_coords(lat, lon)
        if tz_name is None:
            continue

        correct_offset = tz_name_to_offset_seconds(tz_name, date)
        if correct_offset is None:
            continue

        current_offset = current_offsets.get(uuid)
        if current_offset is not None and int(current_offset) == correct_offset:
            continue

        changes.append({
            "uuid": uuid,
            "tz_name": tz_name,
            "current": offset_seconds_to_str(current_offset) if current_offset is not None else "unknown",
            "correct": offset_seconds_to_str(correct_offset),
        })

    if not changes:
        print("All timezones are correct. Nothing to do.")
        return

    print(f"\n{len(changes)} timezone corrections needed:")
    for c in changes[:20]:
        print(f"  {c['uuid']}: {c['current']} -> {c['correct']} ({c['tz_name']})")
    if len(changes) > 20:
        print(f"  ... and {len(changes) - 20} more")

    if not args.apply:
        print(f"\nDry run. Use --apply to apply {len(changes)} changes.")
        return

    print(f"\nApplying {len(changes)} timezone corrections...")
    ok_count = 0
    err_count = 0
    start = time.monotonic()

    for i, c in enumerate(changes, 1):
        result = subprocess.run(
            [
                OSXPHOTOS,
                "timewarp",
                "--timezone", c["tz_name"],
                "--match-time",
                "--uuid", c["uuid"],
                "--force",
            ],
            capture_output=True,
            text=True,
        )
        if result.returncode != 0:
            print(f"  FAIL {c['uuid']}: {result.stderr.strip()}")
            err_count += 1
        else:
            ok_count += 1

        if i % 10 == 0 or i == len(changes):
            elapsed = time.monotonic() - start
            rate = i / elapsed if elapsed > 0 else 0
            remaining = (len(changes) - i) / rate if rate > 0 else 0
            print(f"\r  {i}/{len(changes)} ({ok_count} ok, {err_count} err) ~{int(remaining)}s left", end="\033[K", flush=True)

    print(f"\n\nDone: {ok_count} updated, {err_count} errors")


if __name__ == "__main__":
    main()
