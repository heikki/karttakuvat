#!/usr/bin/env python3
"""
Sync photo metadata from Apple Photos library without re-exporting images.

Updates photos.json with current metadata (location, date, albums, etc.)
for all photos that already have exported images in full/.

Usage:
    python sync_metadata.py

Requirements:
    - osxphotos: pipx install osxphotos
    - Full Disk Access for Terminal in System Settings
"""

import json
import subprocess
import sys
from pathlib import Path


def get_output_dir():
    """Get the output directory (project root, parent of scripts/)."""
    return Path(__file__).parent.parent


def load_existing_photos(json_path):
    """Load existing photos.json if it exists."""
    if json_path.exists():
        with open(json_path) as f:
            data = json.load(f)
            return {p["uuid"]: p for p in data}
    return {}


def get_exported_uuids(full_dir):
    """Get UUIDs from exported files in full/ directory."""
    uuids = set()
    for f in full_dir.glob("*.jpg"):
        uuids.add(f.stem)
    for f in full_dir.glob("*.JPG"):
        uuids.add(f.stem)
    return uuids


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

    print(f"Querying metadata for {len(uuids)} photos...")
    result = subprocess.run(cmd, capture_output=True, text=True)

    if result.returncode != 0:
        print(f"Error querying photos: {result.stderr}")
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


def build_photos_json(photos, full_dir, json_path, old_photos):
    """Build photos.json from queried photos and exported files."""
    exported_uuids = get_exported_uuids(full_dir)

    entries = []
    skipped_no_location = 0
    location_changes = []

    for photo in photos:
        uuid = photo["uuid"]

        # Skip if not exported
        if uuid not in exported_uuids:
            continue

        lat = photo.get("latitude")
        lon = photo.get("longitude")

        if lat is None or lon is None:
            skipped_no_location += 1
            continue

        # Determine GPS source: exif, user, or inferred
        exif_info = photo.get("exif_info", {})
        exif_lat = exif_info.get("latitude")
        exif_lon = exif_info.get("longitude")
        has_exif_gps = exif_lat is not None

        # Check for location changes
        old_photo = old_photos.get(uuid)
        location_changed = old_photo and coords_changed(old_photo.get("lat"), old_photo.get("lon"), lat, lon)

        if location_changed:
            location_changes.append({
                "uuid": uuid,
                "old_lat": old_photo.get("lat"),
                "old_lon": old_photo.get("lon"),
                "new_lat": lat,
                "new_lon": lon,
                "albums": photo.get("albums", [])
            })

        # Determine gps field value
        if has_exif_gps:
            # Has EXIF GPS - check if user moved it
            if coords_changed(exif_lat, exif_lon, lat, lon):
                gps_source = "user"  # User moved photo from original EXIF location
            else:
                gps_source = "exif"  # Still at original EXIF location
        else:
            # No EXIF GPS - check if previously marked as user or if location changed
            old_gps = old_photo.get("gps") if old_photo else None
            if location_changed or old_gps == "user":
                gps_source = "user"  # User assigned/modified location
            else:
                gps_source = "inferred"  # Apple Photos inferred

        # Get albums
        albums = photo.get("albums", [])
        album_info = photo.get("album_info", [])

        # Build photos_url with album UUID if available
        # Use "Not in album" smart album (81938C84-C5B0-4258-BC19-0B3EFA9BF296) as fallback
        if album_info:
            album_uuid = album_info[0].get("uuid", "")
        else:
            album_uuid = "81938C84-C5B0-4258-BC19-0B3EFA9BF296"  # "Not in album" smart album
        photos_url = f"photos:albums?albumUuid={album_uuid}&assetUuid={uuid}"

        entries.append({
            "uuid": uuid,
            "full": f"full/{uuid}.jpg",
            "thumb": f"thumb/{uuid}.jpg",
            "lat": lat,
            "lon": lon,
            "date": format_date(photo.get("date")),
            "gps": gps_source,
            "albums": albums,
            "photos_url": photos_url
        })

    # Sort by date, then UUID for deterministic order
    entries.sort(key=lambda p: (p.get("date") or "", p.get("uuid") or ""))

    with open(json_path, "w") as f:
        json.dump(entries, f, indent=2)

    return entries, skipped_no_location, location_changes


def main():
    output_dir = get_output_dir()
    public_dir = output_dir / "public"
    full_dir = public_dir / "full"
    json_path = public_dir / "photos.json"

    if not full_dir.exists():
        print(f"Error: {full_dir} does not exist. Run export_photos.py first.")
        sys.exit(1)

    # Get UUIDs from exported files
    exported_uuids = get_exported_uuids(full_dir)
    print(f"Found {len(exported_uuids)} exported images in full/")

    if not exported_uuids:
        print("No exported images found.")
        return

    # Load existing photos for change detection
    old_photos = load_existing_photos(json_path)
    print(f"Loaded {len(old_photos)} existing entries for change detection")

    # Query Photos library for metadata
    photos = query_photos_by_uuids(exported_uuids)
    print(f"Got metadata for {len(photos)} photos from Apple Photos")

    # Build photos.json
    entries, skipped, location_changes = build_photos_json(photos, full_dir, json_path, old_photos)

    # Count GPS types
    exif_count = sum(1 for e in entries if e["gps"] == "exif")
    inferred_count = sum(1 for e in entries if e["gps"] == "inferred")
    user_count = sum(1 for e in entries if e["gps"] == "user")

    print(f"\nUpdated {json_path}")
    print(f"  Total entries: {len(entries)}")
    print(f"  EXIF GPS: {exif_count}")
    print(f"  Inferred location: {inferred_count}")
    print(f"  User modified: {user_count}")
    if skipped:
        print(f"  Skipped (no location): {skipped}")

    # Report location changes
    if location_changes:
        print(f"\n  Location changes detected: {len(location_changes)}")
        for change in location_changes:
            album_str = f" [{change['albums'][0]}]" if change.get('albums') else ""
            print(f"    {change['uuid']}{album_str}")
            print(f"      {change['old_lat']:.6f}, {change['old_lon']:.6f} -> {change['new_lat']:.6f}, {change['new_lon']:.6f}")


if __name__ == "__main__":
    main()
