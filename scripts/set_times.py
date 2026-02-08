#!/usr/bin/env python3
"""
Adjust photo times in Apple Photos using osxphotos timewarp.

Reads JSON array of edits from stdin:
    [{"uuid": "...", "hours": 1}, ...]

Shifts each photo's time by the given number of hours (positive or negative).

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
        hours = edit["hours"]

        # Format as ±HH:MM:SS for osxphotos timewarp --time-delta
        sign = "+" if hours >= 0 else "-"
        abs_hours = abs(hours)
        delta = f"{sign}{abs_hours:02d}:00:00"

        try:
            result = subprocess.run(
                [
                    OSXPHOTOS,
                    "timewarp",
                    "--time-delta", delta,
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
