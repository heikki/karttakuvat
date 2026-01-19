#!/usr/bin/env python3
"""
Export geotagged videos from Apple Photos library.

Extracts a frame from each video to use as thumbnail, with photos:// URL
to open the actual video in Photos.app.

Usage:
    python export_videos.py              # Incremental update (only new videos)
    python export_videos.py --full       # Full re-export (all videos)
    python export_videos.py --album "X"  # Filter by album

Requirements:
    - osxphotos: pipx install osxphotos
    - ffmpeg: brew install ffmpeg
    - Full Disk Access for Terminal in System Settings
"""

import argparse
import json
import os
import subprocess
import sys
import tempfile
from pathlib import Path

try:
    from PIL import Image, ImageOps
except ImportError:
    print("Pillow not found. Install with: pip install Pillow")
    sys.exit(1)


def check_ffmpeg():
    """Check if ffmpeg is available."""
    try:
        subprocess.run(["ffmpeg", "-version"], capture_output=True, check=True)
        return True
    except (subprocess.CalledProcessError, FileNotFoundError):
        return False


def get_output_dir():
    """Get the output directory (project root, parent of scripts/)."""
    return Path(__file__).parent.parent


def query_videos(album=None):
    """Query Apple Photos for geotagged videos using osxphotos CLI."""
    cmd = [
        "osxphotos", "query",
        "--location",
        "--not-hidden",
        "--only-movies",
        "--json"
    ]

    if album:
        cmd.extend(["--album", album])

    print("Querying Photos library for videos...")
    result = subprocess.run(cmd, capture_output=True, text=True)

    if result.returncode != 0:
        print(f"Error querying videos: {result.stderr}")
        sys.exit(1)

    if not result.stdout.strip():
        return []

    return json.loads(result.stdout)


def export_video_frame(video, full_dir, thumb_dir, thumb_size):
    """Export a frame from a video as thumbnail."""
    uuid = video["uuid"]
    full_path = full_dir / f"{uuid}.jpg"
    thumb_path = thumb_dir / f"{uuid}.jpg"

    # Skip if already exported
    if full_path.exists() and thumb_path.exists():
        return True

    # Get video path using osxphotos
    cmd = [
        "osxphotos", "export",
        "--uuid", uuid,
        "--download-missing",
        "--dry-run",
        "--json"
    ]
    result = subprocess.run(cmd, capture_output=True, text=True)

    # Find the original video path from the photo info
    video_path = video.get("path") or video.get("original_filename")

    if not video_path:
        # Try to get path from osxphotos query with more details
        cmd = ["osxphotos", "query", "--uuid", uuid, "--json"]
        result = subprocess.run(cmd, capture_output=True, text=True)
        if result.returncode == 0 and result.stdout.strip():
            info = json.loads(result.stdout)
            if info:
                video_path = info[0].get("path")

    if not video_path or not Path(video_path).exists():
        # Export video to temp dir to extract frame
        with tempfile.TemporaryDirectory() as tmpdir:
            cmd = [
                "osxphotos", "export",
                tmpdir,
                "--uuid", uuid,
                "--download-missing"
            ]
            result = subprocess.run(cmd, capture_output=True, text=True)

            # Find exported video
            video_files = list(Path(tmpdir).glob("*"))
            if not video_files:
                print(f"  Could not export video {uuid}")
                return False
            video_path = video_files[0]

            # Extract frame using ffmpeg
            if not extract_frame(video_path, full_path):
                return False
    else:
        # Extract frame directly from original
        if not extract_frame(Path(video_path), full_path):
            return False

    # Create thumbnail from full frame
    if full_path.exists() and not thumb_path.exists():
        try:
            with Image.open(full_path) as img:
                try:
                    img = ImageOps.exif_transpose(img)
                except Exception:
                    pass

                if img.mode in ("RGBA", "P"):
                    img = img.convert("RGB")
                img.thumbnail((thumb_size, thumb_size), Image.Resampling.LANCZOS)
                img.save(thumb_path, "JPEG", quality=80)
        except Exception as e:
            print(f"  Error creating thumbnail for {uuid}: {e}")
            return False

    return full_path.exists() and thumb_path.exists()


def extract_frame(video_path, output_path):
    """Extract a frame from video at 1 second mark (or first frame)."""
    # Try to get frame at 1 second
    cmd = [
        "ffmpeg", "-y",
        "-ss", "1",
        "-i", str(video_path),
        "-vframes", "1",
        "-q:v", "2",
        str(output_path)
    ]
    result = subprocess.run(cmd, capture_output=True)

    if not output_path.exists():
        # Try first frame instead
        cmd = [
            "ffmpeg", "-y",
            "-i", str(video_path),
            "-vframes", "1",
            "-q:v", "2",
            str(output_path)
        ]
        result = subprocess.run(cmd, capture_output=True)

    return output_path.exists()


def format_date(date_str):
    """Format date from osxphotos format to our format."""
    if not date_str:
        return None
    try:
        date_str = date_str.replace("T", " ")
        parts = date_str.split(" ")
        if len(parts) >= 1:
            date_part = parts[0].replace("-", ":")
            time_part = parts[1] if len(parts) > 1 else "00:00:00"
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


def build_video_entry(video, full_dir):
    """Build a video entry for videos.json."""
    uuid = video["uuid"]

    # Check if frame was exported
    if not (full_dir / f"{uuid}.jpg").exists():
        return None

    lat = video.get("latitude")
    lon = video.get("longitude")

    if lat is None or lon is None:
        return None

    return {
        "uuid": uuid,
        "type": "video",
        "full": f"full/{uuid}.jpg",
        "thumb": f"thumb/{uuid}.jpg",
        "lat": lat,
        "lon": lon,
        "date": format_date(video.get("date")),
        "duration": format_duration(video.get("duration")),
        "photos_url": f"photos://asset?id={uuid}"
    }


def main():
    parser = argparse.ArgumentParser(description="Export geotagged videos from Apple Photos")
    parser.add_argument("--full", action="store_true", help="Full re-export (default is incremental)")
    parser.add_argument("--album", type=str, help="Filter by album name")
    parser.add_argument("--thumb-size", type=int, default=400, help="Thumbnail max dimension (default: 400)")
    args = parser.parse_args()

    # Check ffmpeg
    if not check_ffmpeg():
        print("ffmpeg not found. Install with: brew install ffmpeg")
        sys.exit(1)

    output_dir = get_output_dir()
    public_dir = output_dir / "public"
    full_dir = public_dir / "full"
    thumb_dir = public_dir / "thumb"
    json_path = public_dir / "videos.json"

    # Create public directory
    public_dir.mkdir(exist_ok=True)

    # Create directories
    full_dir.mkdir(exist_ok=True)
    thumb_dir.mkdir(exist_ok=True)

    # Load existing videos for incremental update
    existing_uuids = set()
    if not args.full and json_path.exists():
        with open(json_path) as f:
            existing = json.load(f)
            existing_uuids = {v["uuid"] for v in existing}
            print(f"Found {len(existing_uuids)} existing videos")

    # Query Photos library
    videos = query_videos(album=args.album)
    print(f"Found {len(videos)} geotagged videos in library")

    if not videos:
        print("No geotagged videos found.")
        return

    # Filter to new videos
    if existing_uuids:
        videos = [v for v in videos if v["uuid"] not in existing_uuids]
        print(f"Found {len(videos)} new videos to export")

    if not videos and existing_uuids:
        print("No new videos to export")
        return

    # Export video frames
    entries = []
    for i, video in enumerate(videos, 1):
        uuid = video["uuid"]
        print(f"[{i}/{len(videos)}] Extracting frame from {uuid}...")

        if export_video_frame(video, full_dir, thumb_dir, args.thumb_size):
            entry = build_video_entry(video, full_dir)
            if entry:
                entries.append(entry)
        else:
            print(f"  Skipped {uuid}")

    # Load existing and merge
    all_videos = []
    if json_path.exists():
        with open(json_path) as f:
            all_videos = json.load(f)

    all_videos.extend(entries)

    # Sort by date
    all_videos.sort(key=lambda v: v.get("date") or "")

    with open(json_path, "w") as f:
        json.dump(all_videos, f, indent=2)

    print(f"\nExported {len(entries)} new videos")
    print(f"Total videos in {json_path}: {len(all_videos)}")


if __name__ == "__main__":
    main()
