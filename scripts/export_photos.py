#!/usr/bin/env python3
"""
Export geotagged photos from Apple Photos library.

Usage:
    python export_photos.py                    # Incremental update (only new photos)
    python export_photos.py --full             # Full re-export (all photos)
    python export_photos.py --refresh-edited   # Re-export only edited photos
    python export_photos.py --verify            # Check files match photos.json

Requirements:
    - osxphotos: pipx install osxphotos
    - Pillow: pip install Pillow
    - Full Disk Access for Terminal in System Settings
"""

import argparse
import json
import shutil
import subprocess
import sys
import tempfile
import time
from pathlib import Path

try:
    from PIL import Image, ImageOps
except ImportError:
    print("Pillow not found. Install with: pip install Pillow")
    sys.exit(1)


class Progress:
    """In-place progress counter with elapsed/remaining time."""

    def __init__(self, total, label=""):
        self.total = total
        self.label = label
        self.start = time.monotonic()
        self._print(0)

    def update(self, current):
        self._print(current)

    def _print(self, current):
        elapsed = time.monotonic() - self.start
        pct = current / self.total * 100 if self.total else 0
        parts = [f"\r  {self.label}{current}/{self.total} ({pct:.0f}%)"]
        if current > 0 and elapsed > 1:
            rate = current / elapsed
            remaining = (self.total - current) / rate
            parts.append(f" — {self._fmt(elapsed)} elapsed, ~{self._fmt(remaining)} left")
        print("".join(parts), end="\033[K", flush=True)

    def done(self, suffix=""):
        elapsed = time.monotonic() - self.start
        msg = f"\r  {self.label}{self.total}/{self.total} done in {self._fmt(elapsed)}"
        if suffix:
            msg += f" ({suffix})"
        print(msg + "\033[K")

    @staticmethod
    def _fmt(secs):
        if secs < 60:
            return f"{secs:.0f}s"
        return f"{int(secs) // 60}m{int(secs) % 60:02d}s"


def get_output_dir():
    """Get the output directory (project root, parent of scripts/)."""
    return Path(__file__).parent.parent



def query_photos():
    """Query Apple Photos for geotagged photos using osxphotos CLI."""
    cmd = [
        "osxphotos", "query",
        "--location",
        "--not-hidden",
        "--only-photos",
        "--json"
    ]

    print("Querying Photos library...")
    result = subprocess.run(cmd, capture_output=True, text=True)

    if result.returncode != 0:
        print(f"Error querying photos: {result.stderr}")
        sys.exit(1)

    if not result.stdout.strip():
        return []

    return json.loads(result.stdout)


def batch_export(photos, full_dir):
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
        "--download-missing",
        "--update"  # Only export new/changed files
    ]

    # Run export (this will show progress)
    result = subprocess.run(cmd)

    if result.returncode != 0:
        print("Warning: Some photos may have failed to export")

    # Replace originals with edited versions (e.g. rotation edits)
    for f in full_dir.glob("*_edited.*"):
        uuid = f.stem.removesuffix("_edited")
        target = full_dir / f"{uuid}.jpg"
        f.rename(target)

    # Rename remaining .jpeg to .jpg
    for f in full_dir.glob("*.jpeg"):
        f.rename(f.with_suffix(".jpg"))


THUMB_SIZE = 400


def create_thumbnails(full_dir, thumb_dir):
    """Create thumbnails for all full-size images."""
    full_images = list(full_dir.glob("*.jpg"))
    to_create = [f for f in full_images if not (thumb_dir / f.name).exists()]
    print(f"Thumbnails: {len(full_images)} images, {len(to_create)} need creating")

    if not to_create:
        return

    progress = Progress(len(to_create), "Thumbnails: ")
    errors = 0
    for i, full_path in enumerate(to_create, 1):
        thumb_path = thumb_dir / full_path.name
        try:
            with Image.open(full_path) as img:
                try:
                    img = ImageOps.exif_transpose(img)
                except Exception:
                    pass
                if img.mode in ("RGBA", "P"):
                    img = img.convert("RGB")
                img.thumbnail((THUMB_SIZE, THUMB_SIZE), Image.Resampling.LANCZOS)
                img.save(thumb_path, "JPEG", quality=80)
        except Exception as e:
            print(f"\n  Error: {full_path.name}: {e}")
            errors += 1
        progress.update(i)
    progress.done(f"{errors} errors" if errors else "")


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
    print(f"Building photos.json ({len(photos)} photos, {len(exported_uuids)} exported)...")

    progress = Progress(len(photos), "JSON: ")
    entries = []
    for idx, photo in enumerate(photos, 1):
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
        progress.update(idx)
    progress.done(f"{len(entries)} with files")

    # Sort by date, then UUID for deterministic order
    entries.sort(key=lambda p: (p.get("date") or "", p.get("uuid") or ""))

    with open(json_path, "w") as f:
        json.dump(entries, f, indent=2)

    return entries


def query_edited_uuids():
    """Query UUIDs of photos that have been edited in Apple Photos."""
    cmd = [
        "osxphotos", "query",
        "--location",
        "--not-hidden",
        "--only-photos",
        "--edited",
        "--json"
    ]
    result = subprocess.run(cmd, capture_output=True, text=True)
    if result.returncode != 0 or not result.stdout.strip():
        return set()
    return {p["uuid"] for p in json.loads(result.stdout)}


def refresh_edited(full_dir, thumb_dir):
    """Re-export edited photos safely (export first, then replace originals)."""
    print("Finding edited photos...")
    edited_uuids = query_edited_uuids()
    if not edited_uuids:
        print("No edited photos found")
        return

    print(f"Found {len(edited_uuids)} edited photos, re-exporting...")

    # Export to temp dir so originals stay intact until replacements are ready
    with tempfile.TemporaryDirectory() as tmp_dir:
        tmp_path = Path(tmp_dir)

        cmd = [
            "osxphotos", "export",
            str(tmp_path),
            "--convert-to-jpeg",
            "--jpeg-quality", "0.9",
            "--filename", "{uuid}",
            "--download-missing",
        ]
        for uuid in edited_uuids:
            cmd.extend(["--uuid", uuid])

        result = subprocess.run(cmd)
        if result.returncode != 0:
            print("Warning: Some photos may have failed to export")

        # Move exported files over originals, preferring _edited versions
        progress = Progress(len(edited_uuids), "Replacing: ")
        replaced = 0
        for i, uuid in enumerate(sorted(edited_uuids), 1):
            # osxphotos creates both UUID.jpeg (original) and UUID_edited.jpeg (edited)
            # Prefer the edited version
            src = None
            for name in [f"{uuid}_edited.jpeg", f"{uuid}_edited.jpg",
                         f"{uuid}.jpeg", f"{uuid}.jpg"]:
                candidate = tmp_path / name
                if candidate.exists():
                    src = candidate
                    break

            if src is None:
                progress.update(i)
                continue

            dst = full_dir / f"{uuid}.jpg"
            shutil.move(str(src), str(dst))

            # Delete stale thumbnail so it gets regenerated
            thumb = thumb_dir / f"{uuid}.jpg"
            if thumb.exists():
                thumb.unlink()

            replaced += 1
            progress.update(i)
        progress.done(f"{replaced} replaced")


def verify(full_dir, thumb_dir, json_path):
    """Check that all photos.json entries have files and there are no orphans."""
    with open(json_path) as f:
        photos = json.load(f)
    json_uuids = {p["uuid"] for p in photos}
    full_files = {f.stem for f in full_dir.glob("*.jpg")}
    thumb_files = {f.stem for f in thumb_dir.glob("*.jpg")}

    missing_full = sorted(json_uuids - full_files)
    missing_thumb = sorted(json_uuids - thumb_files)
    orphan_full = sorted(full_files - json_uuids)
    orphan_thumb = sorted(thumb_files - json_uuids)

    print(f"photos.json: {len(json_uuids)} entries")
    print(f"Full-size:   {len(full_files)} files")
    print(f"Thumbnails:  {len(thumb_files)} files")

    ok = True

    if missing_full:
        ok = False
        print(f"\nMissing full-size ({len(missing_full)}):")
        for uuid in missing_full:
            print(f"  {uuid}")

    if missing_thumb:
        ok = False
        print(f"\nMissing thumbnails ({len(missing_thumb)}):")
        for uuid in missing_thumb:
            print(f"  {uuid}")

    if orphan_full:
        ok = False
        print(f"\nOrphan full-size ({len(orphan_full)}):")
        for uuid in orphan_full:
            print(f"  {uuid}")

    if orphan_thumb:
        ok = False
        print(f"\nOrphan thumbnails ({len(orphan_thumb)}):")
        for uuid in orphan_thumb:
            print(f"  {uuid}")

    if ok:
        print("\nAll OK")
    else:
        print(f"\nIssues found: {len(missing_full)} missing full, "
              f"{len(missing_thumb)} missing thumb, "
              f"{len(orphan_full)} orphan full, {len(orphan_thumb)} orphan thumb")
        sys.exit(1)


def main():
    parser = argparse.ArgumentParser(description="Export geotagged photos from Apple Photos")
    parser.add_argument("--full", action="store_true", help="Full re-export (default is incremental update)")
    parser.add_argument("--refresh-edited", action="store_true", help="Re-export only photos that have been edited in Apple Photos")
    parser.add_argument("--verify", action="store_true", help="Check that all files match photos.json")
    args = parser.parse_args()

    output_dir = get_output_dir()
    public_dir = output_dir / "public"
    full_dir = public_dir / "full"
    thumb_dir = public_dir / "thumb"
    json_path = public_dir / "photos.json"

    if args.verify:
        verify(full_dir, thumb_dir, json_path)
        return

    # Create public directory
    public_dir.mkdir(exist_ok=True)

    # Create directories
    full_dir.mkdir(exist_ok=True)
    thumb_dir.mkdir(exist_ok=True)

    # Query Photos library
    photos = query_photos()
    print(f"Found {len(photos)} geotagged photos in library")

    if not photos:
        print("No geotagged photos found. Make sure you have:")
        print("  1. Granted Full Disk Access to Terminal")
        print("  2. Photos with GPS location data")
        return

    if args.refresh_edited:
        # Targeted re-export of edited photos only (safe to interrupt)
        refresh_edited(full_dir, thumb_dir)
    else:
        # Remove osxphotos database if doing full export
        if args.full:
            db_path = full_dir / ".osxphotos_export.db"
            if db_path.exists():
                db_path.unlink()
                print("Cleared export database for full re-export")

        # Batch export all photos
        batch_export(photos, full_dir)

    # Create thumbnails
    create_thumbnails(full_dir, thumb_dir)

    # Build photos.json
    entries = build_photos_json(photos, full_dir, json_path)

    print(f"\nExported {len(entries)} photos")
    print(f"Photos JSON: {json_path}")


if __name__ == "__main__":
    main()
