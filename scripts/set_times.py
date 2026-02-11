#!/usr/bin/env python3
"""
Set photo dates in Apple Photos using osxphotos timewarp.

Reads JSON array of edits from stdin:
    [{"uuid": "...", "date": "YYYY-MM-DD", "time": "HH:MM:SS"}, ...]

Sets each photo's date and time to the specified values.

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
        date = edit["date"]
        time = edit["time"]

        try:
            result = subprocess.run(
                [
                    OSXPHOTOS,
                    "timewarp",
                    "--date", date,
                    "--time", time,
                    "--uuid", uuid,
                    "--force",
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
