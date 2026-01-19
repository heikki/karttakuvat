#!/usr/bin/env python3
"""
Export geotagged photos from Apple Photos library.

Usage:
    python export_photos.py              # Incremental update (only new photos)
    python export_photos.py --full       # Full re-export (all photos)
    python export_photos.py --album "X"  # Filter by album
    python export_photos.py --thumb-size 400  # Thumbnail max dimension (default: 400)

Requirements:
    - osxphotos: pipx install osxphotos
    - Pillow: pip install Pillow
    - Full Disk Access for Terminal in System Settings
"""

import argparse
import json
import os
import subprocess
import sys
from pathlib import Path

try:
    from PIL import Image, ImageOps
except ImportError:
    print("Pillow not found. Install with: pip install Pillow")
    sys.exit(1)


def get_output_dir():
    """Get the output directory (project root, parent of scripts/)."""
    return Path(__file__).parent.parent


def load_existing_photos(json_path):
    """Load existing photos.json if it exists."""
    if json_path.exists():
        with open(json_path) as f:
            return json.load(f)
    return []


def get_existing_uuids(photos):
    """Get set of UUIDs from existing photos."""
    return {p["uuid"] for p in photos if "uuid" in p}


def query_photos(album=None):
    """Query Apple Photos for geotagged photos using osxphotos CLI."""
    cmd = [
        "osxphotos", "query",
        "--location",
        "--not-hidden",
        "--only-photos",
        "--json"
    ]

    if album:
        cmd.extend(["--album", album])

    print("Querying Photos library...")
    result = subprocess.run(cmd, capture_output=True, text=True)

    if result.returncode != 0:
        print(f"Error querying photos: {result.stderr}")
        sys.exit(1)

    if not result.stdout.strip():
        return []

    return json.loads(result.stdout)


def batch_export(photos, full_dir, album=None):
    """Export all photos in a single osxphotos command (much faster)."""
    print(f"Exporting {len(photos)} photos to {full_dir}...")

    # Build the export command
    cmd = [
        "osxphotos", "export",
        str(full_dir),
        "--location",  # Only photos with GPS
        "--not-hidden",
        "--only-photos",  # Exclude videos
        "--convert-to-jpeg",
        "--jpeg-quality", "0.9",
        "--filename", "{uuid}",
        "--skip-edited",
        "--download-missing",
        "--update"  # Only export new/changed files
    ]

    if album:
        cmd.extend(["--album", album])

    # Run export (this will show progress)
    result = subprocess.run(cmd)

    if result.returncode != 0:
        print("Warning: Some photos may have failed to export")

    # Rename .jpeg to .jpg
    for f in full_dir.glob("*.jpeg"):
        new_name = f.with_suffix(".jpg")
        if not new_name.exists():
            f.rename(new_name)


def create_thumbnails(full_dir, thumb_dir, thumb_size):
    """Create thumbnails for all full-size images."""
    full_images = list(full_dir.glob("*.jpg"))
    print(f"Creating thumbnails for {len(full_images)} images...")

    for i, full_path in enumerate(full_images, 1):
        thumb_path = thumb_dir / full_path.name

        if thumb_path.exists():
            continue

        if i % 100 == 0 or i == len(full_images):
            print(f"  Thumbnails: {i}/{len(full_images)}")

        try:
            with Image.open(full_path) as img:
                # Handle orientation from EXIF
                try:
                    img = ImageOps.exif_transpose(img)
                except Exception:
                    pass

                if img.mode in ("RGBA", "P"):
                    img = img.convert("RGB")
                img.thumbnail((thumb_size, thumb_size), Image.Resampling.LANCZOS)
                img.save(thumb_path, "JPEG", quality=80)
        except Exception as e:
            print(f"  Error creating thumbnail for {full_path.name}: {e}")


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


def build_photos_json(photos, full_dir, json_path):
    """Build photos.json from queried photos and exported files."""
    # Get list of actually exported files
    exported_uuids = {f.stem for f in full_dir.glob("*.jpg")}

    entries = []
    for photo in photos:
        uuid = photo["uuid"]

        # Skip if not exported
        if uuid not in exported_uuids:
            continue

        lat = photo.get("latitude")
        lon = photo.get("longitude")

        if lat is None or lon is None:
            continue

        # Determine GPS source: exif, user, or inferred
        exif_info = photo.get("exif_info", {})
        exif_lat = exif_info.get("latitude")
        exif_lon = exif_info.get("longitude")
        has_exif_gps = exif_lat is not None

        # Check if user moved photo from original EXIF location
        def coords_differ(lat1, lon1, lat2, lon2, threshold=0.0001):
            if lat1 is None or lon1 is None:
                return False
            return abs(lat1 - lat2) > threshold or abs(lon1 - lon2) > threshold

        if has_exif_gps:
            if coords_differ(exif_lat, exif_lon, lat, lon):
                gps_source = "user"  # User moved photo from original EXIF location
            else:
                gps_source = "exif"  # Still at original EXIF location
        else:
            gps_source = "inferred"  # Apple Photos inferred (can't detect user changes on first export)

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

    return entries


def main():
    parser = argparse.ArgumentParser(description="Export geotagged photos from Apple Photos")
    parser.add_argument("--full", action="store_true", help="Full re-export (default is incremental update)")
    parser.add_argument("--album", type=str, help="Filter by album name")
    parser.add_argument("--thumb-size", type=int, default=400, help="Thumbnail max dimension (default: 400)")
    args = parser.parse_args()

    output_dir = get_output_dir()
    public_dir = output_dir / "public"
    full_dir = public_dir / "full"
    thumb_dir = public_dir / "thumb"
    json_path = public_dir / "photos.json"

    # Create public directory
    public_dir.mkdir(exist_ok=True)

    # Create directories
    full_dir.mkdir(exist_ok=True)
    thumb_dir.mkdir(exist_ok=True)

    # Query Photos library
    photos = query_photos(album=args.album)
    print(f"Found {len(photos)} geotagged photos in library")

    if not photos:
        print("No geotagged photos found. Make sure you have:")
        print("  1. Granted Full Disk Access to Terminal")
        print("  2. Photos with GPS location data")
        return

    # Remove osxphotos database if doing full export
    if args.full:
        db_path = full_dir / ".osxphotos_export.db"
        if db_path.exists():
            db_path.unlink()
            print("Cleared export database for full re-export")

    # Batch export all photos
    batch_export(photos, full_dir, args.album)

    # Create thumbnails
    create_thumbnails(full_dir, thumb_dir, args.thumb_size)

    # Build photos.json
    entries = build_photos_json(photos, full_dir, json_path)

    print(f"\nExported {len(entries)} photos")
    print(f"Photos JSON: {json_path}")


if __name__ == "__main__":
    main()
