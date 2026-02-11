#!/usr/bin/env python3
"""
Fix 2015 Dominica photo/video timestamps.

The camera was set to Finnish time (UTC+2) but photos have location-based
timezone (UTC-4). This script adjusts the stored local times by -6 hours.

Verified against daylight analysis:
  - 423 photos: shifted times form 06:00–18:00 bell curve
  - 7 dark photos confirmed as evening arrival on Feb 5

Usage:
    python3 scripts/fix_dominica_times.py           # dry run
    python3 scripts/fix_dominica_times.py --apply    # apply changes
"""

import json
import os
import shutil
import subprocess
import sys
from collections import defaultdict
from datetime import datetime, timedelta
from pathlib import Path

ITEMS_PATH = Path(__file__).parent.parent / "public" / "items.json"
OSXPHOTOS = shutil.which("osxphotos") or os.path.expanduser("~/.local/bin/osxphotos")

CAMERA_TZ = 2  # UTC+2 (Finnish time)


def parse_tz(tz_str):
    """Parse '+03:00' or '-04:00' to hours as float."""
    sign = -1 if tz_str[0] == "-" else 1
    parts = tz_str.lstrip("+-").split(":")
    return sign * (int(parts[0]) + int(parts[1]) / 60)


def adjust_date(date_str, delta_hours):
    """Adjust a date string by delta_hours."""
    dt = datetime.strptime(date_str, "%Y:%m:%d %H:%M:%S")
    dt += timedelta(hours=delta_hours)
    return dt.strftime("%Y:%m:%d %H:%M:%S")


def main():
    apply = "--apply" in sys.argv

    items = json.loads(ITEMS_PATH.read_text())

    edits = []
    for item in items:
        if "2015 Dominica" not in item.get("albums", []):
            continue

        tz_str = item.get("tz")
        if not tz_str:
            continue

        tz_offset = parse_tz(tz_str)
        delta = tz_offset - CAMERA_TZ

        if delta == 0:
            continue

        new_date = adjust_date(item["date"], delta)
        edits.append({
            "uuid": item["uuid"],
            "old_date": item["date"],
            "new_date": new_date,
            "tz": tz_str,
            "delta": delta,
        })

    # Group by delta for summary and batched osxphotos calls
    by_delta = defaultdict(list)
    for e in edits:
        by_delta[e["delta"]].append(e)

    print(f"Found {len(edits)} items to adjust:\n")
    for delta in sorted(by_delta):
        group = by_delta[delta]
        sign = "+" if delta >= 0 else ""
        print(f"  {sign}{delta:.0f}h (tz {group[0]['tz']}): {len(group)} items")
        for e in group[:3]:
            print(f"    {e['old_date']} → {e['new_date']}")
        if len(group) > 3:
            print(f"    ... and {len(group) - 3} more")

    if not apply:
        print(f"\nDry run. Use --apply to update Apple Photos and items.json.")
        return

    # Apply using osxphotos timewarp --time-delta for each delta group
    print(f"\nUpdating {len(edits)} items in Apple Photos...")

    total_ok = 0
    total_fail = 0

    for delta in sorted(by_delta):
        group = by_delta[delta]

        abs_h = int(abs(delta))
        abs_m = int((abs(delta) - abs_h) * 60)
        sign = "+" if delta >= 0 else "-"
        delta_str = f"{sign}{abs_h}:{abs_m:02d}:00"

        cmd = [OSXPHOTOS, "timewarp", "--time-delta", delta_str]
        for e in group:
            cmd.extend(["--uuid", e["uuid"]])
        cmd.append("--force")

        print(f"  Shifting {len(group)} items by {delta_str}...")
        result = subprocess.run(cmd, capture_output=True, text=True)

        if result.returncode != 0:
            print(f"    FAILED: {result.stderr.strip()}", file=sys.stderr)
            total_fail += len(group)
        else:
            total_ok += len(group)

    print(f"  Apple Photos: {total_ok} OK, {total_fail} failed")

    # Update items.json
    edit_by_uuid = {e["uuid"]: e for e in edits}
    updated = 0
    for item in items:
        edit = edit_by_uuid.get(item.get("uuid"))
        if edit is None:
            continue
        item["date"] = edit["new_date"]
        updated += 1

    ITEMS_PATH.write_text(json.dumps(items, indent=2, ensure_ascii=False) + "\n")
    print(f"  items.json: {updated} items updated")
    print("\nDone!")


if __name__ == "__main__":
    main()
