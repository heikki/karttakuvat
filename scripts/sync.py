#!/usr/bin/env python3
"""
Sync metadata from Apple Photos library without re-exporting images.

Updates items.json with current metadata (location, date, albums, GPS, etc.)
for all items that already have exported images in full/.

Usage:
    python sync.py

Requirements:
    - osxphotos: pipx install osxphotos
    - Full Disk Access for Terminal in System Settings
"""

import json
import subprocess
import sys
from pathlib import Path

from export import determine_gps_source, extract_tz_offset, format_duration, query_gps_accuracy, query_video_durations, round_accuracy


def get_output_dir():
    """Get the output directory (project root, parent of scripts/)."""
    return Path(__file__).parent.parent


def load_existing_items(json_path):
    """Load existing items.json if it exists."""
    if json_path.exists():
        with open(json_path) as f:
            data = json.load(f)
            return {p["uuid"]: p for p in data}
    return {}


def get_exported_uuids(full_dir):
    """Get UUIDs from exported files in full/ directory."""
    return {f.stem for f in full_dir.glob("*.jpg")}


def query_photos_by_uuids(uuids):
    """Query Apple Photos for specific UUIDs."""
    if not uuids:
        return []

    # Write UUIDs to temp file for osxphotos
    uuid_file = Path("/tmp/photo_uuids.txt")
    uuid_file.write_text("\n".join(uuids))

    cmd = [
        "osxphotos", "query",
        "--uuid-from-file", str(uuid_file),
        "--json"
    ]

    print(f"Querying metadata for {len(uuids)} items...")
    result = subprocess.run(cmd, capture_output=True, text=True)

    if result.returncode != 0:
        print(f"Error querying items: {result.stderr}")
        sys.exit(1)

    if not result.stdout.strip():
        return []

    return json.loads(result.stdout)


def format_date(date_str):
    """Format date from osxphotos format to our format."""
    if not date_str:
        return None
    # osxphotos returns ISO format: "2013-09-20T13:56:27+03:00"
    # We want: "2013:09:20 13:56:27"
    try:
        date_str = date_str.replace("T", " ")
        parts = date_str.split(" ")
        if len(parts) >= 1:
            date_part = parts[0].replace("-", ":")
            time_part = parts[1] if len(parts) > 1 else "00:00:00"
            # Remove timezone info if present
            time_part = time_part.split("+")[0].split("-")[0].split(".")[0]
            return f"{date_part} {time_part}"
    except Exception:
        pass
    return date_str


def coords_changed(old_lat, old_lon, new_lat, new_lon, threshold=0.0001):
    """Check if coordinates changed beyond threshold (~11m at equator)."""
    if old_lat is None or old_lon is None:
        return False
    return abs(old_lat - new_lat) > threshold or abs(old_lon - new_lon) > threshold


def is_video(item):
    """Check if an osxphotos item is a video (has duration or ismovie flag)."""
    if item.get("ismovie"):
        return True
    if item.get("duration") and item["duration"] > 0:
        return True
    return False


def build_items_json(items, full_dir, json_path, old_items):
    """Build items.json from queried items and exported files."""
    exported_uuids = get_exported_uuids(full_dir)
    gps_accuracy = query_gps_accuracy()
    video_durations = query_video_durations()

    entries = []
    skipped_no_location = 0
    location_changes = []

    for item in items:
        uuid = item["uuid"]

        # Skip if not exported
        if uuid not in exported_uuids:
            continue

        lat = item.get("latitude")
        lon = item.get("longitude")

        # Check for location changes
        old_item = old_items.get(uuid)
        if lat is not None and lon is not None:
            location_changed = old_item and coords_changed(old_item.get("lat"), old_item.get("lon"), lat, lon)

            if location_changed:
                location_changes.append({
                    "uuid": uuid,
                    "old_lat": old_item.get("lat"),
                    "old_lon": old_item.get("lon"),
                    "new_lat": lat,
                    "new_lon": lon,
                    "albums": item.get("albums", [])
                })
        else:
            skipped_no_location += 1

        gps_source = determine_gps_source(item, gps_accuracy) if lat is not None else None

        albums = item.get("albums", [])
        album_info = item.get("album_info", [])

        item_is_video = is_video(item)

        if album_info:
            album_uuid = album_info[0].get("uuid", "")
        else:
            album_uuid = "81938C84-C5B0-4258-BC19-0B3EFA9BF296"
        photos_url = f"photos:albums?albumUuid={album_uuid}&assetUuid={uuid}"

        acc = gps_accuracy.get(uuid)

        entry = {
            "uuid": uuid,
            "type": "video" if item_is_video else "photo",
            "full": f"full/{uuid}.jpg",
            "thumb": f"thumb/{uuid}.jpg",
            "lat": lat,
            "lon": lon,
            "date": format_date(item.get("date")),
            "tz": extract_tz_offset(item.get("date")),
        }

        if item_is_video:
            entry["duration"] = format_duration(video_durations.get(uuid))

        entry.update({
            "gps": gps_source,
            "gps_accuracy": round_accuracy(acc) if acc is not None else None,
            "albums": albums,
            "photos_url": photos_url
        })

        entries.append(entry)

    # Sort by date, then UUID for deterministic order
    entries.sort(key=lambda p: (p.get("date") or "", p.get("uuid") or ""))

    with open(json_path, "w") as f:
        json.dump(entries, f, indent=2, ensure_ascii=False)

    return entries, skipped_no_location, location_changes


def main():
    output_dir = get_output_dir()
    public_dir = output_dir / "public"
    full_dir = public_dir / "full"
    json_path = public_dir / "items.json"

    if not full_dir.exists():
        print(f"Error: {full_dir} does not exist. Run export.py first.")
        sys.exit(1)

    # Get UUIDs from exported files
    exported_uuids = get_exported_uuids(full_dir)
    print(f"Found {len(exported_uuids)} exported images in full/")

    if not exported_uuids:
        print("No exported images found.")
        return

    # Load existing items for change detection
    old_items = load_existing_items(json_path)
    print(f"Loaded {len(old_items)} existing entries for change detection")

    # Query Photos library for metadata (both photos and videos)
    items = query_photos_by_uuids(exported_uuids)
    print(f"Got metadata for {len(items)} items from Apple Photos")

    # Build items.json
    entries, skipped, location_changes = build_items_json(items, full_dir, json_path, old_items)

    # Count types and GPS sources
    photo_count = sum(1 for e in entries if e["type"] == "photo")
    video_count = sum(1 for e in entries if e["type"] == "video")
    exif_count = sum(1 for e in entries if e["gps"] == "exif")
    inferred_count = sum(1 for e in entries if e["gps"] == "inferred")
    user_count = sum(1 for e in entries if e["gps"] == "user")

    print(f"\nUpdated {json_path}")
    print(f"  Total entries: {len(entries)} ({photo_count} photos, {video_count} videos)")
    print(f"  EXIF GPS: {exif_count}")
    print(f"  Inferred location: {inferred_count}")
    print(f"  User modified: {user_count}")
    if skipped:
        print(f"  Skipped (no location): {skipped}")

    # Clean up orphan files (deleted from Apple Photos)
    entry_uuids = {e["uuid"] for e in entries}
    orphan_uuids = exported_uuids - entry_uuids
    if orphan_uuids:
        thumb_dir = public_dir / "thumb"
        print(f"\n  Deleted from Photos: {len(orphan_uuids)}")
        for uuid in sorted(orphan_uuids):
            album_str = ""
            old = old_items.get(uuid)
            if old and old.get("albums"):
                album_str = f" [{old['albums'][0]}]"
            print(f"    {uuid}{album_str}")
            for d in [full_dir, thumb_dir]:
                f = d / f"{uuid}.jpg"
                if f.exists():
                    f.unlink()
            mov = full_dir / f"{uuid}.mov"
            if mov.exists():
                mov.unlink()

    # Report location changes
    if location_changes:
        print(f"\n  Location changes detected: {len(location_changes)}")
        for change in location_changes:
            album_str = f" [{change['albums'][0]}]" if change.get('albums') else ""
            print(f"    {change['uuid']}{album_str}")
            print(f"      {change['old_lat']:.6f}, {change['old_lon']:.6f} -> {change['new_lat']:.6f}, {change['new_lon']:.6f}")


if __name__ == "__main__":
    main()
