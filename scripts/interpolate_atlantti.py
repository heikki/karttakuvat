#!/usr/bin/env python3
"""
Intra-day coordinate interpolation for 2015 Atlantti photos.

Uses anchor positions, departure/arrival times, and noon logbook positions
to compute per-photo coordinates based on actual time of day.

Model:
  - Anchor periods (port stays): fixed coordinates
  - Under sail: linear interpolation between consecutive waypoints
  - Noon positions at solar noon UTC (12:00 - lon/15)

Usage:
    python3 scripts/interpolate_atlantti.py           # dry run
    python3 scripts/interpolate_atlantti.py --apply    # apply changes
"""

import json
import subprocess
import sys
from bisect import bisect_right
from datetime import datetime, timedelta, timezone
from pathlib import Path

ITEMS_PATH = Path(__file__).parent.parent / "public" / "items.json"

def utc_dt(year, month, day, hour=0, minute=0):
    """Create a UTC datetime."""
    return datetime(year, month, day, hour, minute, tzinfo=timezone.utc)


def solar_noon(year, month, day, lon):
    """UTC time of solar noon at given longitude (negative for W)."""
    offset_h = -lon / 15
    base = utc_dt(year, month, day, 12)
    return base + timedelta(hours=offset_h)


def dms(deg, minutes=0):
    """Degrees + decimal minutes to decimal degrees."""
    sign = -1 if deg < 0 else 1
    return round(sign * (abs(deg) + minutes / 60), 3)


def parse_tz_hours(tz_str):
    """Parse '+03:00' or '-04:00' to hours."""
    sign = -1 if tz_str[0] == "-" else 1
    h, m = tz_str.lstrip("+-").split(":")
    return sign * (int(h) + int(m) / 60)


def photo_utc(date_str, tz_str):
    """Convert photo local time + tz offset to UTC datetime."""
    dt = datetime.strptime(date_str, "%Y:%m:%d %H:%M:%S")
    tz_h = parse_tz_hours(tz_str)
    return dt.replace(tzinfo=timezone.utc) - timedelta(hours=tz_h)


# === Anchor coordinates ===

ST_MAARTEN = (dms(18, 4.14), dms(-63, 5.1))
ANGUILLA = (18.201, -63.096)
PRICKLY_PEAR = (18.263, -63.180)
FLORES = (dms(39, 22.7), dms(-31, 10.2))
VELAS = (38.680, -28.203)
HORTA = (dms(38, 32), dms(-28, 37))
DUBLIN = (dms(53, 17.9), dms(-6, 8.3))

# === Noon positions from logbook (degrees + minutes) ===

NOON = [
    (3, 22, dms(20, 28), dms(-63, 39)),
    (3, 23, dms(22, 28.8), dms(-63, 40.2)),
    # Mar 24, 25: no logbook noon — naturally interpolated between 23 and 26
    (3, 26, dms(30, 11.9), dms(-65, 15.9)),
    (3, 27, dms(33, 5.9), dms(-61, 42)),
    (3, 28, dms(34, 14), dms(-57, 4)),
    (3, 29, dms(33, 34), dms(-53, 14)),
    (3, 30, dms(36, 12.5), dms(-48, 10.1)),
    (3, 31, dms(36, 40), dms(-45, 1)),
    (4, 1, dms(37, 18), dms(-41, 56)),
    # Apr 2: no logbook noon — interpolated between 1 and 3
    (4, 3, dms(39, 13), dms(-34, 23)),
    # Leg 2
    (4, 14, dms(40, 32), dms(-26, 7)),
    (4, 15, dms(42, 36), dms(-23, 43)),
    (4, 16, dms(44, 59.1), dms(-20, 35.6)),
    (4, 17, dms(45, 50), dms(-16, 56)),
    (4, 18, dms(47, 13), dms(-14, 20)),
    (4, 19, dms(49, 23), dms(-11, 45)),
    (4, 20, dms(51, 14), dms(-9, 32)),
    (4, 21, dms(51, 53.3), dms(-5, 51.3)),
]

# === Build chronological waypoint list: (utc_datetime, lat, lon) ===


def build_waypoints():
    W = []

    # St. Maarten anchor (start after Mar 18 Dominica photos)
    W.append((utc_dt(2015, 3, 19), *ST_MAARTEN))
    W.append((utc_dt(2015, 3, 20, 19, 0), *ST_MAARTEN))  # depart 15:00 UTC-4

    # Transit to Anguilla — west of Anguilla, then around south coast
    W.append((utc_dt(2015, 3, 20, 20, 0), 18.15, -63.197))   # 18°09.0'N, 63°11.8'W
    W.append((utc_dt(2015, 3, 20, 20, 45), 18.203, -63.138))  # 18°12.2'N, 63°08.3'W
    W.append((utc_dt(2015, 3, 20, 21, 30), *ANGUILLA))  # arrive ~17:30 UTC-4
    W.append((utc_dt(2015, 3, 21, 11, 0), *ANGUILLA))  # depart 07:00 UTC-4

    # Transit to Prickly Pear (~45min)
    W.append((utc_dt(2015, 3, 21, 11, 45), *PRICKLY_PEAR))  # arrive ~07:45 UTC-4
    W.append((utc_dt(2015, 3, 21, 17, 45), *PRICKLY_PEAR))  # depart 13:45 UTC-4

    # Clear west of Anguilla before heading north
    W.append((utc_dt(2015, 3, 21, 18, 30), 18.268, -63.197))  # 18°16.1'N, 63°11.8'W

    # Noon positions at sea (Leg 1)
    for month, day, lat, lon in NOON:
        if month < 4 or (month == 4 and day <= 3):
            W.append((solar_noon(2015, month, day, lon), lat, lon))

    # Flores anchor
    W.append((utc_dt(2015, 4, 4, 16, 15), *FLORES))  # arrive 16:15 UTC+0
    W.append((utc_dt(2015, 4, 6, 16, 0), *FLORES))  # depart 16:00 UTC+0

    # Velas anchor (Flores→Velas 16h)
    W.append((utc_dt(2015, 4, 7, 8, 0), *VELAS))  # arrive 08:00 UTC+0
    W.append((utc_dt(2015, 4, 8, 15, 22), *VELAS))  # depart 15:22 UTC+0

    # Horta anchor
    W.append((utc_dt(2015, 4, 8, 19, 45), *HORTA))  # arrive 19:45 UTC+0
    W.append((utc_dt(2015, 4, 13, 12, 45), *HORTA))  # depart 12:45 UTC+0

    # Noon positions at sea (Leg 2)
    for month, day, lat, lon in NOON:
        if month == 4 and day >= 14:
            W.append((solar_noon(2015, month, day, lon), lat, lon))

    # Dublin arrival
    W.append((utc_dt(2015, 4, 22, 9, 0), *DUBLIN))  # arrive 10:00 UTC+1
    W.append((utc_dt(2015, 4, 23), *DUBLIN))

    W.sort(key=lambda w: w[0])
    return W


def interpolate(waypoints, t):
    """Interpolate (lat, lon) at UTC time t."""
    times = [w[0] for w in waypoints]

    i = bisect_right(times, t)
    if i == 0:
        return None  # before first waypoint
    if i >= len(waypoints):
        return None  # after last waypoint

    t0, lat0, lon0 = waypoints[i - 1]
    t1, lat1, lon1 = waypoints[i]

    span = (t1 - t0).total_seconds()
    if span == 0:
        return (lat0, lon0)

    frac = (t - t0).total_seconds() / span
    lat = lat0 + frac * (lat1 - lat0)
    lon = lon0 + frac * (lon1 - lon0)
    return (round(lat, 3), round(lon, 3))


CLUSTER_GAP = 300  # seconds — photos within 5 min of each other share position


def main():
    apply = "--apply" in sys.argv
    waypoints = build_waypoints()

    items = json.loads(ITEMS_PATH.read_text())

    # Collect Atlantti photos with UTC times
    photos = []
    for item in items:
        if "2015 Atlantti" not in item.get("albums", []):
            continue
        tz_str = item.get("tz")
        if not tz_str:
            continue
        t = photo_utc(item["date"], tz_str)
        photos.append((t, item))

    # Sort by UTC time and cluster: photos within CLUSTER_GAP of their
    # neighbour share the same interpolated position
    photos.sort(key=lambda p: p[0])
    clusters = []
    for t, item in photos:
        if clusters and (t - clusters[-1][-1][0]).total_seconds() <= CLUSTER_GAP:
            clusters[-1].append((t, item))
        else:
            clusters.append([(t, item)])

    # Interpolate once per cluster using median timestamp
    edits = []
    for cluster in clusters:
        times = [t for t, _ in cluster]
        median_t = times[len(times) // 2]
        result = interpolate(waypoints, median_t)
        if result is None:
            continue

        target_lat, target_lon = result
        for _, item in cluster:
            if round(item["lat"], 3) != target_lat or round(item["lon"], 3) != target_lon:
                edits.append({
                    "uuid": item["uuid"],
                    "lat": target_lat,
                    "lon": target_lon,
                    "date": item["date"],
                    "old_lat": item["lat"],
                    "old_lon": item["lon"],
                })

    # Summary
    from collections import defaultdict

    by_date = defaultdict(list)
    for e in edits:
        by_date[e["date"][:10]].append(e)

    print(f"Found {len(edits)} photos to update across {len(by_date)} dates:\n")
    for date_key in sorted(by_date):
        group = by_date[date_key]
        # Group photos within 1 minute of each other
        clusters = []
        for e in group:
            t = datetime.strptime(e["date"], "%Y:%m:%d %H:%M:%S")
            if clusters and (t - clusters[-1][-1][1]).total_seconds() <= 300:
                clusters[-1].append((e, t))
            else:
                clusters.append([(e, t)])
        for cluster in clusters:
            first = cluster[0][0]
            last = cluster[-1][0]
            n = len(cluster)
            time_range = first["date"][11:16]
            if n > 1 and first["date"][11:16] != last["date"][11:16]:
                time_range += f"–{last['date'][11:16]}"
            count = f" x{n}" if n > 1 else ""
            print(
                f"  {first['date'][:10]} {time_range}{count}  "
                f"({first['old_lat']:.3f}, {first['old_lon']:.3f}) → "
                f"({first['lat']:.3f}, {first['lon']:.3f})"
            )

    if not apply:
        print(f"\nDry run. Use --apply to update Apple Photos and items.json.")
        return

    # Apply location-only changes via osxphotos (no timezone change to keep
    # UTC computation stable across reruns)
    import os
    import shutil

    OSXPHOTOS = shutil.which("osxphotos") or os.path.expanduser(
        "~/.local/bin/osxphotos"
    )

    print(f"\nUpdating {len(edits)} photos in Apple Photos...")
    ok_count = 0
    fail_count = 0
    for e in edits:
        result = subprocess.run(
            [
                OSXPHOTOS,
                "batch-edit",
                "--location",
                str(e["lat"]),
                str(e["lon"]),
                "--uuid",
                e["uuid"],
            ],
            capture_output=True,
            text=True,
        )
        if result.returncode != 0:
            print(f"    FAIL {e['uuid']}: {result.stderr.strip()}", file=sys.stderr)
            fail_count += 1
        else:
            ok_count += 1

    print(f"  Apple Photos: {ok_count} OK, {fail_count} failed")

    # Update items.json (coords only, preserve tz)
    edit_by_uuid = {e["uuid"]: e for e in edits}
    updated = 0
    for item in items:
        edit = edit_by_uuid.get(item.get("uuid"))
        if edit is None:
            continue
        item["lat"] = edit["lat"]
        item["lon"] = edit["lon"]
        updated += 1

    ITEMS_PATH.write_text(json.dumps(items, indent=2, ensure_ascii=False) + "\n")
    print(f"  items.json: {updated} items updated")
    print("\nDone!")


if __name__ == "__main__":
    main()
