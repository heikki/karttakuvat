#!/usr/bin/env python3
"""
Update 2015 Atlantti photo locations from voyage timeline.

The 262 photos had only 6 rough coordinate groups. This script assigns
daily positions from the logbook (misc/timeline.md), updating Apple Photos
via set_locations.py and writing the new coordinates to items.json.

Usage:
    python3 scripts/update_atlantti_locations.py           # dry run
    python3 scripts/update_atlantti_locations.py --apply    # apply changes
"""

import json
import subprocess
import sys
from pathlib import Path

ITEMS_PATH = Path(__file__).parent.parent / "public" / "items.json"


def dms(deg, minutes=0):
    """Convert degrees + decimal minutes to decimal degrees. Sign preserved from deg."""
    sign = -1 if deg < 0 else 1
    return sign * (abs(deg) + minutes / 60)


def interp(a, b, t):
    """Linear interpolation: a + t * (b - a)."""
    return round(a + t * (b - a), 3)


# Date → (lat_dms, lon_dms) from timeline (misc/timeline.md).
# Values use degrees°minutes' notation matching the logbook.
# Dates not listed here keep their existing coordinates (Mar 18–20 pre-departure,
# Apr 6 transit day with no photos).
#
# Interpolated entries are computed from adjacent known positions.
N, W = 1, -1  # sign helpers for readability
TIMELINE_DMS = {
    "2015:03:21": (dms(18, 4.14),  dms(-63, 5.1)),    # St. Maarten
    "2015:03:22": (dms(20, 28),    dms(-63, 39)),      # 20°28'N, 63°39'W
    "2015:03:23": (dms(22, 28.8),  dms(-63, 40.2)),    # 22°28.8'N, 63°40.2'W
    "2015:03:24": (dms(23, 26),    None),               # ~23°26'N, lon unknown
    "2015:03:26": (dms(30, 11.9),  dms(-65, 15.9)),    # 30°11.9'N, 65°15.9'W
    "2015:03:27": (dms(33, 5.9),   dms(-61, 42)),      # 33°05.9'N, 61°42'W
    "2015:03:28": (dms(34, 14),    dms(-57, 4)),        # 34°14'N, 57°04'W
    "2015:03:29": (dms(33, 34),    dms(-53, 14)),       # 33°34'N, 53°14'W
    "2015:03:30": (dms(36, 12.5),  dms(-48, 10.1)),    # 36°12.5'N, 48°10.1'W
    "2015:03:31": (dms(36, 40),    dms(-45, 1)),        # 36°40'N, 45°01'W
    "2015:04:01": (dms(37, 18),    dms(-41, 56)),       # 37°18'N, 41°56'W
    "2015:04:03": (dms(39, 13),    dms(-34, 23)),       # 39°13'N, 34°23'W
    "2015:04:04": (dms(39, 22),    dms(-31, 10)),       # 39°22'N, 31°10'W — Flores
    "2015:04:05": (dms(39, 22.7),  dms(-31, 10.2)),    # Flores (Lajes das Flores)
    "2015:04:07": (dms(38, 40.8),  dms(-28, 12.2)),    # 38°40.8'N, 28°12.2'W — Velas
    "2015:04:08": (dms(38, 32),    dms(-28, 37)),       # 38°32'N, 28°37'W — Horta
    "2015:04:14": (dms(40, 32),    dms(-26, 7)),        # 40°32'N, 26°07'W
    "2015:04:15": (dms(42, 36),    dms(-23, 43)),       # 42°36'N, 23°43'W
    "2015:04:16": (dms(44, 59.1),  dms(-20, 35.6)),    # 44°59.1'N, 20°35.6'W
    "2015:04:17": (dms(45, 50),    dms(-16, 56)),       # 45°50'N, 16°56'W
    "2015:04:18": (dms(47, 13),    dms(-14, 20)),       # 47°13'N, 14°20'W
    "2015:04:19": (dms(49, 23),    dms(-11, 45)),       # 49°23'N, 11°45'W
    "2015:04:20": (dms(51, 14),    dms(-9, 32)),        # 51°14'N, 09°32'W — Ireland
    "2015:04:21": (dms(51, 53.3),  dms(-5, 51.3)),     # 51°53.3'N, 05°51.3'W
    "2015:04:22": (dms(53, 17.9),  dms(-6, 8.3)),      # 53°17.9'N, 06°08.3'W — Dublin
}

# Build final timeline with interpolated values and Horta range
TIMELINE = {}
for date, (lat, lon) in TIMELINE_DMS.items():
    TIMELINE[date] = (round(lat, 3), round(lon, 3) if lon is not None else None)

# Mar 24: lat from timeline, lon interpolated between Mar 23 and Mar 26
lat_24 = TIMELINE["2015:03:24"][0]
lon_24 = interp(TIMELINE["2015:03:23"][1], TIMELINE["2015:03:26"][1], 1/3)
TIMELINE["2015:03:24"] = (lat_24, lon_24)

# Mar 25: fully interpolated between Mar 24 and Mar 26
lat_25 = interp(TIMELINE["2015:03:24"][0], TIMELINE["2015:03:26"][0], 1/2)
lon_25 = interp(TIMELINE["2015:03:24"][1], TIMELINE["2015:03:26"][1], 1/2)
TIMELINE["2015:03:25"] = (lat_25, lon_25)

# Apr 2: interpolated between Apr 1 and Apr 3
lat_02 = interp(TIMELINE["2015:04:01"][0], TIMELINE["2015:04:03"][0], 1/2)
lon_02 = interp(TIMELINE["2015:04:01"][1], TIMELINE["2015:04:03"][1], 1/2)
TIMELINE["2015:04:02"] = (lat_02, lon_02)

# Apr 9–13: Horta (same as Apr 8)
for day in range(9, 14):
    TIMELINE[f"2015:04:{day:02d}"] = TIMELINE["2015:04:08"]

# Threshold for coordinate difference (degrees). ~1 km.
THRESHOLD = 0.01


def main():
    apply = "--apply" in sys.argv

    items = json.loads(ITEMS_PATH.read_text())

    # Find Atlantti photos that need updating
    edits = []
    for item in items:
        if "2015 Atlantti" not in item.get("albums", []):
            continue

        date_key = item["date"][:10]
        target = TIMELINE.get(date_key)
        if target is None:
            continue

        target_lat, target_lon = target
        dlat = abs(item["lat"] - target_lat)
        dlon = abs(item["lon"] - target_lon)

        if dlat > THRESHOLD or dlon > THRESHOLD:
            edits.append({
                "uuid": item["uuid"],
                "lat": target_lat,
                "lon": target_lon,
                "date": item["date"],
                "old_lat": item["lat"],
                "old_lon": item["lon"],
            })

    # Group and print summary
    from collections import defaultdict
    by_date = defaultdict(list)
    for e in edits:
        by_date[e["date"][:10]].append(e)

    print(f"Found {len(edits)} photos to update across {len(by_date)} dates:\n")
    for date_key in sorted(by_date):
        group = by_date[date_key]
        sample = group[0]
        print(
            f"  {date_key}  {len(group):2d} photos  "
            f"({sample['old_lat']:.3f}, {sample['old_lon']:.3f}) → "
            f"({sample['lat']:.3f}, {sample['lon']:.3f})"
        )

    if not apply:
        print(f"\nDry run. Use --apply to update Apple Photos and items.json.")
        return

    # Call set_locations.py to update Apple Photos + timezone
    print(f"\nUpdating {len(edits)} photos in Apple Photos...")
    set_locations_script = Path(__file__).parent / "set_locations.py"
    payload = [
        {"uuid": e["uuid"], "lat": e["lat"], "lon": e["lon"], "date": e["date"]}
        for e in edits
    ]

    result = subprocess.run(
        [sys.executable, str(set_locations_script)],
        input=json.dumps(payload),
        capture_output=True,
        text=True,
        cwd=set_locations_script.parent,
    )

    if result.returncode != 0:
        print(f"set_locations.py failed:\n{result.stderr}", file=sys.stderr)
        sys.exit(1)

    results = json.loads(result.stdout)
    ok_count = sum(1 for r in results if r.get("ok"))
    fail_count = len(results) - ok_count
    print(f"  Apple Photos: {ok_count} OK, {fail_count} failed")

    if fail_count:
        for r in results:
            if not r.get("ok"):
                print(f"    FAIL {r['uuid']}: {r.get('error', '?')}", file=sys.stderr)

    # Build uuid→result lookup for tz offsets
    tz_by_uuid = {r["uuid"]: r.get("tz") for r in results if r.get("ok")}

    # Update items.json
    edit_by_uuid = {e["uuid"]: e for e in edits}
    updated = 0
    for item in items:
        edit = edit_by_uuid.get(item.get("uuid"))
        if edit is None:
            continue
        item["lat"] = edit["lat"]
        item["lon"] = edit["lon"]
        tz = tz_by_uuid.get(item["uuid"])
        if tz is not None:
            item["tz"] = tz
        updated += 1

    ITEMS_PATH.write_text(json.dumps(items, indent=2, ensure_ascii=False) + "\n")
    print(f"  items.json: {updated} items updated")
    print("\nDone!")


if __name__ == "__main__":
    main()
