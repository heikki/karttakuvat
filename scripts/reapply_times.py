#!/usr/bin/env python3
"""
Compare items.json timestamps with Apple Photos and reapply any that differ.

Uses osxphotos to query current photo dates, then applies timewarp
for photos where items.json has a different date/time.
"""

import json
import os
import shutil
import subprocess
import sys

OSXPHOTOS = shutil.which("osxphotos") or os.path.expanduser("~/.local/bin/osxphotos")


def query_photos_dates(uuids: list[str]) -> dict[str, str]:
    """Query Apple Photos for current dates of given UUIDs."""
    # osxphotos query --uuid can take multiple UUIDs
    # Use --json to get structured output
    cmd = [OSXPHOTOS, "query", "--json"]
    for uuid in uuids:
        cmd.extend(["--uuid", uuid])

    result = subprocess.run(cmd, capture_output=True, text=True)
    if result.returncode != 0:
        print(f"Error querying photos: {result.stderr}", file=sys.stderr)
        sys.exit(1)

    photos = json.loads(result.stdout)
    dates = {}
    for p in photos:
        # osxphotos returns date as ISO format like "2025-08-28T09:09:32+00:00"
        # We need to convert to "YYYY:MM:DD HH:MM:SS" format (no timezone)
        uuid = p["uuid"]
        dt = p["date"]  # e.g. "2025-08-28T09:09:32.000000+00:00"
        # Parse just the date/time part, ignoring timezone
        # Format: YYYY-MM-DDTHH:MM:SS...
        date_part = dt[:19].replace("-", ":").replace("T", " ")
        dates[uuid] = date_part
    return dates


def main():
    with open("public/items.json") as f:
        items = json.load(f)

    all_uuids = [item["uuid"] for item in items if item.get("date")]
    print(f"Total items with dates: {len(all_uuids)}")

    # Query in batches to avoid command line too long
    BATCH_SIZE = 100
    photos_dates: dict[str, str] = {}
    for i in range(0, len(all_uuids), BATCH_SIZE):
        batch = all_uuids[i : i + BATCH_SIZE]
        sys.stdout.write(f"\rQuerying Apple Photos... {i + len(batch)}/{len(all_uuids)}")
        sys.stdout.flush()
        photos_dates.update(query_photos_dates(batch))
    print()

    # Build lookup from items.json
    items_dates = {item["uuid"]: item["date"] for item in items if item.get("date")}

    # Find mismatches
    mismatches = []
    for uuid, items_date in items_dates.items():
        photos_date = photos_dates.get(uuid)
        if photos_date is None:
            continue  # Photo not found in Apple Photos
        if items_date != photos_date:
            mismatches.append((uuid, items_date, photos_date))

    if not mismatches:
        print("All timestamps match. Nothing to do.")
        return

    print(f"\nFound {len(mismatches)} timestamp mismatches:")
    for uuid, want, have in mismatches:
        print(f"  {uuid}: {have} -> {want}")

    print(f"\nApplying {len(mismatches)} corrections...")
    ok_count = 0
    err_count = 0
    for uuid, items_date, _ in mismatches:
        # Parse "YYYY:MM:DD HH:MM:SS" into date and time parts
        parts = items_date.split(" ")
        date_str = parts[0].replace(":", "-")  # YYYY-MM-DD
        time_str = parts[1]  # HH:MM:SS

        result = subprocess.run(
            [
                OSXPHOTOS,
                "timewarp",
                "--date", date_str,
                "--time", time_str,
                "--uuid", uuid,
                "--force",
            ],
            capture_output=True,
            text=True,
        )
        if result.returncode != 0:
            print(f"  FAIL {uuid}: {result.stderr.strip()}")
            err_count += 1
        else:
            print(f"  OK   {uuid}")
            ok_count += 1

    print(f"\nDone: {ok_count} updated, {err_count} errors")


if __name__ == "__main__":
    main()
