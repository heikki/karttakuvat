#!/usr/bin/env python3
"""
Set locations on Apple Photos items using osxphotos CLI.

Reads JSON array of edits from stdin:
    [{"uuid": "...", "lat": 69.04, "lon": 20.8}, ...]

Sets the location on each photo/video in Apple Photos.

Requirements:
    - osxphotos: pipx install osxphotos
    - Photos.app must be running
"""

import json
import os
import shutil
import subprocess
import sys

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

        try:
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
            else:
                results.append({"uuid": uuid, "ok": True})
        except Exception as e:
            results.append({"uuid": uuid, "ok": False, "error": str(e)})

    print(json.dumps(results))


if __name__ == "__main__":
    main()
