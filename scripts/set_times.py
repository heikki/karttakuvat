#!/usr/bin/env python3
"""
Set photo dates in Apple Photos using osxphotos timewarp.

Reads JSON array of edits from stdin:
    [{"uuid": "...", "date": "YYYY-MM-DD", "time": "HH:MM:SS", "tz": "+03:00"}, ...]

Sets each photo's date and time to the specified values.
Falls back to JXA (JavaScript for Automation) if osxphotos crashes
(e.g. photos with no timezone set).

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


def set_date_jxa(uuid, date, time):
    """Fallback: set photo date via JXA (JavaScript for Automation)."""
    script = f"""
        const Photos = Application("Photos");
        const item = Photos.mediaItems.byId("{uuid}");
        item.date = new Date("{date}T{time}");
    """
    return subprocess.run(
        ["osascript", "-l", "JavaScript", "-e", script],
        capture_output=True,
        text=True,
    )


def set_date_osxphotos(uuid, date, time, tz):
    """Primary: set photo date via osxphotos timewarp."""
    cmd = [
        OSXPHOTOS,
        "timewarp",
        "--date", date,
        "--time", time,
        "--uuid", uuid,
        "--force",
    ]
    if tz:
        cmd.extend(["--timezone", tz])
    return subprocess.run(cmd, capture_output=True, text=True)


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
        tz = edit.get("tz")

        try:
            result = set_date_osxphotos(uuid, date, time, tz)
            if result.returncode != 0:
                # Try JXA fallback
                fallback = set_date_jxa(uuid, date, time)
                if fallback.returncode != 0:
                    results.append({"uuid": uuid, "ok": False, "error": result.stderr.strip()})
                else:
                    results.append({"uuid": uuid, "ok": True})
            else:
                results.append({"uuid": uuid, "ok": True})
        except Exception as e:
            results.append({"uuid": uuid, "ok": False, "error": str(e)})

    # Restart Photos.app to clear the undo stack so that
    # Cmd+Z in Photos won't accidentally revert these edits
    subprocess.run(["osascript", "-e", 'tell application "Photos" to quit'], capture_output=True)

    print(json.dumps(results))


if __name__ == "__main__":
    main()
