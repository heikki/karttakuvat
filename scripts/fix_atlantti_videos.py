#!/usr/bin/env python3
"""
Fix 2015 Atlantti video dates from original filenames.

The videos were imported with wrong dates (all 2015-03-18 18:xx).
Original filenames like '2015-04-06T14-09-31.mov' contain better dates.

Usage:
    python fix_atlantti_videos.py              # Dry run
    python fix_atlantti_videos.py --apply      # Apply to Apple Photos
"""

import argparse
import json
import os
import re
import shutil
import subprocess
import sys

OSXPHOTOS = shutil.which("osxphotos") or os.path.expanduser("~/.local/bin/osxphotos")
FN_DATE_RE = re.compile(r"(\d{4})-(\d{2})-(\d{2})T(\d{2})-(\d{2})-(\d{2})")


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--apply", action="store_true")
    args = parser.parse_args()

    with open("public/items.json") as f:
        items = json.load(f)

    atlantti = [i for i in items if "2015 Atlantti" in i.get("albums", [])]
    uuids = [i["uuid"] for i in atlantti]

    # Query Apple Photos for original filenames
    cmd = [OSXPHOTOS, "query", "--json"]
    for uuid in uuids:
        cmd.extend(["--uuid", uuid])

    print("Querying Apple Photos...")
    result = subprocess.run(cmd, capture_output=True, text=True)
    apple_photos = json.loads(result.stdout)
    apple_by_uuid = {p["uuid"]: p for p in apple_photos}

    # Find videos with filename dates that differ from current dates
    fixes = []
    for item in atlantti:
        ap = apple_by_uuid.get(item["uuid"])
        if not ap or not ap.get("ismovie"):
            continue

        orig = ap.get("original_filename") or ""
        m = FN_DATE_RE.search(orig)
        if not m:
            continue

        fn_date = f"{m.group(1)}:{m.group(2)}:{m.group(3)} {m.group(4)}:{m.group(5)}:{m.group(6)}"
        if fn_date != item["date"]:
            fixes.append({
                "uuid": item["uuid"],
                "filename": orig,
                "current_date": item["date"],
                "new_date": fn_date,
            })

    if not fixes:
        print("No fixes needed.")
        return

    print(f"\n{len(fixes)} videos to fix:\n")
    for f in fixes:
        print(f"  {f['filename']:35s}  {f['current_date']}  ->  {f['new_date']}")

    if not args.apply:
        print(f"\nDry run. Use --apply to fix {len(fixes)} videos.")
        return

    print(f"\nApplying {len(fixes)} date fixes...")
    ok = 0
    err = 0
    for f in fixes:
        # Parse new date into date and time parts
        parts = f["new_date"].split(" ")
        date_str = parts[0].replace(":", "-")
        time_str = parts[1]

        result = subprocess.run(
            [
                OSXPHOTOS, "timewarp",
                "--date", date_str,
                "--time", time_str,
                "--uuid", f["uuid"],
                "--force",
            ],
            capture_output=True,
            text=True,
        )
        if result.returncode != 0:
            print(f"  FAIL {f['uuid']}: {result.stderr.strip()}")
            err += 1
        else:
            ok += 1

    print(f"\nDone: {ok} fixed, {err} errors")
    if ok > 0:
        print("Run 'python scripts/sync.py' to update items.json")


if __name__ == "__main__":
    main()
