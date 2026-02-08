#!/usr/bin/env python3
"""
Export photos and videos from Apple Photos library.

Usage:
    python export.py                    # Incremental update (only new items)
    python export.py --full             # Full re-export (all items)
    python export.py --refresh-edited   # Re-export only edited photos
    python export.py --verify           # Check files match items.json

Requirements:
    - osxphotos: pipx install osxphotos
    - Pillow: pip install Pillow
    - ffmpeg: brew install ffmpeg (optional, needed for video frame extraction)
    - Full Disk Access for Terminal in System Settings
"""

import argparse
import json
import shutil
import sqlite3
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
    """Query Apple Photos for photos using osxphotos CLI."""
    cmd = [
        "osxphotos", "query",
        "--not-hidden",
        "--only-photos",
        "--json"
    ]

    print("Querying Photos library for photos...")
    result = subprocess.run(cmd, capture_output=True, text=True)

    if result.returncode != 0:
        print(f"Error querying photos: {result.stderr}")
        sys.exit(1)

    if not result.stdout.strip():
        return []

    return json.loads(result.stdout)


def query_videos():
    """Query Apple Photos for videos using osxphotos CLI."""
    cmd = [
        "osxphotos", "query",
        "--not-hidden",
        "--only-movies",
        "--json"
    ]

    print("Querying Photos library for videos...")
    result = subprocess.run(cmd, capture_output=True, text=True)

    if result.returncode != 0:
        print(f"Error querying videos: {result.stderr}")
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

    # Normalize extensions to .jpg
    for pattern in ["*.jpeg", "*.JPEG", "*.JPG"]:
        for f in full_dir.glob(pattern):
            f.rename(f.with_suffix(".jpg"))


def check_ffmpeg():
    """Check if ffmpeg is available."""
    try:
        subprocess.run(["ffmpeg", "-version"], capture_output=True, check=True)
        return True
    except (subprocess.CalledProcessError, FileNotFoundError):
        return False


def extract_frame(video_path, output_path):
    """Extract a frame from video at 1 second mark (or first frame).

    Uses scale filter to apply sample aspect ratio (SAR) so anamorphic
    videos (e.g. 960x1080 with SAR 2:1) produce correct display resolution.
    """
    # Scale width by SAR to get display resolution, keep even dimensions
    scale_filter = "scale=trunc(iw*sar/2)*2:ih"

    # Try to get frame at 1 second
    cmd = [
        "ffmpeg", "-y",
        "-ss", "1",
        "-i", str(video_path),
        "-vframes", "1",
        "-vf", scale_filter,
        "-q:v", "2",
        str(output_path)
    ]
    subprocess.run(cmd, capture_output=True)

    if not output_path.exists():
        # Try first frame instead
        cmd = [
            "ffmpeg", "-y",
            "-i", str(video_path),
            "-vframes", "1",
            "-vf", scale_filter,
            "-q:v", "2",
            str(output_path)
        ]
        subprocess.run(cmd, capture_output=True)

    return output_path.exists()


def export_video_frames(videos, full_dir):
    """Extract a frame from each video to use as its image."""
    to_export = [v for v in videos if not (full_dir / f"{v['uuid']}.jpg").exists()]
    print(f"Video frames: {len(videos)} videos, {len(to_export)} need frame extraction")

    if not to_export:
        return

    progress = Progress(len(to_export), "Video frames: ")
    errors = 0
    for i, video in enumerate(to_export, 1):
        uuid = video["uuid"]
        output_path = full_dir / f"{uuid}.jpg"

        video_path = video.get("path")

        if video_path and Path(video_path).exists():
            # Extract frame directly from local file
            if not extract_frame(Path(video_path), output_path):
                print(f"\n  Error extracting frame: {uuid}")
                errors += 1
        else:
            # Export video to temp dir, extract frame, clean up
            with tempfile.TemporaryDirectory() as tmpdir:
                cmd = [
                    "osxphotos", "export",
                    tmpdir,
                    "--uuid", uuid,
                    "--download-missing"
                ]
                subprocess.run(cmd, capture_output=True, text=True)

                # Find exported video file
                video_files = list(Path(tmpdir).glob("*"))
                if not video_files:
                    print(f"\n  Could not export video {uuid}")
                    errors += 1
                    progress.update(i)
                    continue

                if not extract_frame(video_files[0], output_path):
                    print(f"\n  Error extracting frame: {uuid}")
                    errors += 1

        progress.update(i)
    progress.done(f"{errors} errors" if errors else "")


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


def format_duration(seconds):
    """Format duration in seconds to MM:SS or HH:MM:SS."""
    if not seconds:
        return None
    seconds = int(seconds)
    if seconds < 3600:
        return f"{seconds // 60}:{seconds % 60:02d}"
    return f"{seconds // 3600}:{(seconds % 3600) // 60:02d}:{seconds % 60:02d}"


def query_video_durations():
    """Read video durations from the Photos database.

    Returns a dict of {uuid: duration_seconds}.
    """
    db_path = Path.home() / "Pictures/Photos Library.photoslibrary/database/Photos.sqlite"
    if not db_path.exists():
        return {}
    db = sqlite3.connect(str(db_path))
    cur = db.cursor()
    cur.execute("""
        SELECT a.ZUUID, a.ZDURATION
        FROM ZASSET a
        WHERE a.ZDURATION > 0
    """)
    result = dict(cur.fetchall())
    db.close()
    return result


def query_gps_accuracy():
    """Read GPS horizontal accuracy from the Photos database.

    Returns a dict of {uuid: accuracy}. Apple Photos stores accuracy=10.0
    for user-set locations, -1.0 for inferred, and real GPS accuracy for
    EXIF GPS photos.
    """
    db_path = Path.home() / "Pictures/Photos Library.photoslibrary/database/Photos.sqlite"
    if not db_path.exists():
        return {}
    db = sqlite3.connect(str(db_path))
    cur = db.cursor()
    cur.execute("""
        SELECT a.ZUUID, aa.ZGPSHORIZONTALACCURACY
        FROM ZASSET a
        JOIN ZADDITIONALASSETATTRIBUTES aa ON a.Z_PK = aa.ZASSET
        WHERE aa.ZGPSHORIZONTALACCURACY IS NOT NULL
    """)
    result = dict(cur.fetchall())
    db.close()
    return result


def determine_gps_source(photo, gps_accuracy):
    """Determine GPS source: 'user', 'exif', or 'inferred'.

    - accuracy = 10.0 -> user manually set the location
    - has EXIF GPS -> camera embedded GPS coordinates
    - otherwise -> Apple Photos inferred the location
    """
    acc = gps_accuracy.get(photo["uuid"])
    if acc == 10.0:
        return "user"
    exif_info = photo.get("exif_info") or {}
    if exif_info.get("latitude") is not None:
        return "exif"
    return "inferred"


def build_items_json(photos, videos, full_dir, json_path):
    """Build items.json from queried photos/videos and exported files."""
    # Get list of actually exported files
    exported_uuids = {f.stem for f in full_dir.glob("*.jpg")}
    print(f"Building items.json ({len(photos)} photos, {len(videos)} videos, {len(exported_uuids)} exported)...")

    gps_accuracy = query_gps_accuracy()
    video_durations = query_video_durations()

    entries = []

    # Process photos
    progress = Progress(len(photos), "Photos: ")
    for idx, photo in enumerate(photos, 1):
        uuid = photo["uuid"]

        if uuid not in exported_uuids:
            progress.update(idx)
            continue

        lat = photo.get("latitude")
        lon = photo.get("longitude")

        gps_source = determine_gps_source(photo, gps_accuracy) if lat is not None else None

        albums = photo.get("albums", [])
        album_info = photo.get("album_info", [])

        if album_info:
            album_uuid = album_info[0].get("uuid", "")
        else:
            album_uuid = "81938C84-C5B0-4258-BC19-0B3EFA9BF296"
        photos_url = f"photos:albums?albumUuid={album_uuid}&assetUuid={uuid}"

        acc = gps_accuracy.get(uuid)
        entries.append({
            "uuid": uuid,
            "type": "photo",
            "full": f"full/{uuid}.jpg",
            "thumb": f"thumb/{uuid}.jpg",
            "lat": lat,
            "lon": lon,
            "date": format_date(photo.get("date")),
            "gps": gps_source,
            "gps_accuracy": round(acc, 1) if acc is not None else None,
            "albums": albums,
            "photos_url": photos_url
        })
        progress.update(idx)
    progress.done(f"{len([e for e in entries if e['type'] == 'photo'])} with files")

    # Process videos
    if videos:
        progress = Progress(len(videos), "Videos: ")
        for idx, video in enumerate(videos, 1):
            uuid = video["uuid"]

            if uuid not in exported_uuids:
                progress.update(idx)
                continue

            lat = video.get("latitude")
            lon = video.get("longitude")

            gps_source = determine_gps_source(video, gps_accuracy) if lat is not None else None

            albums = video.get("albums", [])
            album_info = video.get("album_info", [])

            if album_info:
                album_uuid = album_info[0].get("uuid", "")
            else:
                album_uuid = "81938C84-C5B0-4258-BC19-0B3EFA9BF296"
            photos_url = f"photos:albums?albumUuid={album_uuid}&assetUuid={uuid}"

            acc = gps_accuracy.get(uuid)
            entries.append({
                "uuid": uuid,
                "type": "video",
                "full": f"full/{uuid}.jpg",
                "thumb": f"thumb/{uuid}.jpg",
                "lat": lat,
                "lon": lon,
                "date": format_date(video.get("date")),
                "duration": format_duration(video_durations.get(uuid)),
                "gps": gps_source,
                "gps_accuracy": round(acc, 1) if acc is not None else None,
                "albums": albums,
                "photos_url": photos_url
            })
            progress.update(idx)
        progress.done(f"{len([e for e in entries if e['type'] == 'video'])} with files")

    # Sort by date, then UUID for deterministic order
    entries.sort(key=lambda p: (p.get("date") or "", p.get("uuid") or ""))

    with open(json_path, "w") as f:
        json.dump(entries, f, indent=2)

    return entries


def query_edited_uuids():
    """Query UUIDs of photos that have been edited in Apple Photos."""
    cmd = [
        "osxphotos", "query",
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
    """Check that all items.json entries have files and there are no orphans."""
    with open(json_path) as f:
        items = json.load(f)
    json_uuids = {p["uuid"] for p in items}
    full_files = {f.stem for f in full_dir.glob("*.jpg")}
    thumb_files = {f.stem for f in thumb_dir.glob("*.jpg")}

    photo_count = sum(1 for i in items if i.get("type") == "photo")
    video_count = sum(1 for i in items if i.get("type") == "video")

    missing_full = sorted(json_uuids - full_files)
    missing_thumb = sorted(json_uuids - thumb_files)
    orphan_full = sorted(full_files - json_uuids)
    orphan_thumb = sorted(thumb_files - json_uuids)

    print(f"items.json: {len(json_uuids)} entries ({photo_count} photos, {video_count} videos)")
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
    parser = argparse.ArgumentParser(description="Export photos and videos from Apple Photos")
    parser.add_argument("--full", action="store_true", help="Full re-export (default is incremental update)")
    parser.add_argument("--refresh-edited", action="store_true", help="Re-export only photos that have been edited in Apple Photos")
    parser.add_argument("--verify", action="store_true", help="Check that all files match items.json")
    args = parser.parse_args()

    output_dir = get_output_dir()
    public_dir = output_dir / "public"
    full_dir = public_dir / "full"
    thumb_dir = public_dir / "thumb"
    json_path = public_dir / "items.json"

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
    print(f"Found {len(photos)} photos in library")

    if not photos:
        print("No photos found. Make sure you have:")
        print("  1. Granted Full Disk Access to Terminal")
        print("  2. Photos in your Apple Photos library")
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

    # Query and export video frames
    videos = query_videos()
    print(f"Found {len(videos)} videos in library")

    if videos:
        has_ffmpeg = check_ffmpeg()
        if has_ffmpeg:
            export_video_frames(videos, full_dir)
        else:
            print("Warning: ffmpeg not found, skipping video frame extraction")
            print("  Install with: brew install ffmpeg")
            videos = []

    # Create thumbnails (covers both photos and video frames)
    create_thumbnails(full_dir, thumb_dir)

    # Build unified items.json
    entries = build_items_json(photos, videos, full_dir, json_path)

    photo_count = sum(1 for e in entries if e["type"] == "photo")
    video_count = sum(1 for e in entries if e["type"] == "video")
    print(f"\nExported {len(entries)} items ({photo_count} photos, {video_count} videos)")
    print(f"Items JSON: {json_path}")


if __name__ == "__main__":
    main()
