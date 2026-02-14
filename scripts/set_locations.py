#!/usr/bin/env python3
"""
Set locations on Apple Photos items using osxphotos CLI.

Reads JSON array of edits from stdin:
    [{"uuid": "...", "lat": 69.04, "lon": 20.8, "date": "2008:07:09 17:53:13"}, ...]

Sets the location and timezone on each photo/video in Apple Photos.

Requirements:
    - osxphotos: pipx install osxphotos
    - timezonefinder: pip install timezonefinder
    - Photos.app must be running
"""

import json
import os
import shutil
import subprocess
import sys

from export import tz_name_from_coords, tz_offset_from_coords

# osxphotos is installed via pipx into ~/.local/bin which may not be in PATH
# when this script is spawned from a server process
OSXPHOTOS = shutil.which("osxphotos") or os.path.expanduser("~/.local/bin/osxphotos")


def main():
    data = sys.stdin.read()
    edits = json.loads(data)

    if not isinstance(edits, list):
        print("Error: expected JSON array", file=sys.stderr)
        sys.exit(1)

    results = []
    for edit in edits:
        uuid = edit["uuid"]
        lat = edit["lat"]
        lon = edit["lon"]
        date = edit.get("date")

        try:
            # Set location
            result = subprocess.run(
                [
                    OSXPHOTOS,
                    "batch-edit",
                    "--location", str(lat), str(lon),
                    "--uuid", uuid,
                ],
                capture_output=True,
                text=True,
            )
            if result.returncode != 0:
                results.append({"uuid": uuid, "ok": False, "error": result.stderr.strip()})
                continue

            # Set timezone from coordinates
            tz_name = tz_name_from_coords(lat, lon)
            tz_offset = tz_offset_from_coords(lat, lon, date) if date else None
            old_tz = edit.get("tz")

            if tz_name and tz_offset != old_tz:
                tz_result = subprocess.run(
                    [
                        OSXPHOTOS,
                        "timewarp",
                        "--timezone", tz_name,
                        "--uuid", uuid,
                        "--force",
                    ],
                    capture_output=True,
                    text=True,
                )
                if tz_result.returncode != 0:
                    print(f"Warning: failed to set timezone for {uuid}: {tz_result.stderr.strip()}", file=sys.stderr)

            results.append({"uuid": uuid, "ok": True, "tz": tz_offset})
        except Exception as e:
            results.append({"uuid": uuid, "ok": False, "error": str(e)})

    # Restart Photos.app to clear the undo stack so that
    # Cmd+Z in Photos won't accidentally revert these edits
    subprocess.run(["osascript", "-e", 'tell application "Photos" to quit'], capture_output=True)
    subprocess.run(["sleep", "2"])
    subprocess.Popen(["open", "-g", "-a", "Photos"])

    print(json.dumps(results))


if __name__ == "__main__":
    main()
