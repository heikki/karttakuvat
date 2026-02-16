#!/usr/bin/env python3
"""
Copy camera EXIF (Make/Model) from a reference photo to photos missing camera
info in a given album.

Usage:
    python3 scripts/set_cameras.py --album "2008 Halti" --ref-uuid ABC-123-DEF
    python3 scripts/set_cameras.py --album "2008 Halti" --ref-uuid ABC-123-DEF --dry-run

After running, sync items.json:
    python3 scripts/sync.py

Requirements:
    - osxphotos: pipx install osxphotos
    - exiftool: brew install exiftool
"""

import argparse
import json
import os
import shutil
import subprocess
import sys

OSXPHOTOS = shutil.which("osxphotos") or os.path.expanduser("~/.local/bin/osxphotos")
EXIFTOOL = shutil.which("exiftool") or "exiftool"
ITEMS_JSON = os.path.join(os.path.dirname(__file__), "..", "public", "items.json")


def get_camera_from_ref(uuid):
    """Query osxphotos for the reference photo's camera make/model."""
    result = subprocess.run(
        [OSXPHOTOS, "query", "--uuid", uuid, "--json"],
        capture_output=True, text=True,
    )
    if result.returncode != 0:
        print(f"Error querying reference photo: {result.stderr.strip()}", file=sys.stderr)
        sys.exit(1)

    photos = json.loads(result.stdout)
    if not photos:
        print(f"No photo found with UUID {uuid}", file=sys.stderr)
        sys.exit(1)

    photo = photos[0]
    exif = photo.get("exif_info") or {}
    make = exif.get("camera_make")
    model = exif.get("camera_model")

    if not make and not model:
        print(f"Reference photo {uuid} has no camera EXIF data", file=sys.stderr)
        sys.exit(1)

    return make, model


def get_photo_paths(uuids):
    """Query osxphotos for multiple UUIDs at once, return {uuid: path} for downloaded photos."""
    args = [OSXPHOTOS, "query", "--json"]
    for uuid in uuids:
        args.extend(["--uuid", uuid])
    result = subprocess.run(args, capture_output=True, text=True)
    if result.returncode != 0:
        return {}
    photos = json.loads(result.stdout)
    return {p["uuid"]: p["path"] for p in photos if p.get("path")}


def has_camera_exif(path):
    """Check if file already has camera Make/Model EXIF."""
    result = subprocess.run(
        [EXIFTOOL, "-Make", "-Model", "-s3", path],
        capture_output=True, text=True,
    )
    return bool(result.stdout.strip())


def set_exif_camera(path, make, model):
    """Write camera Make/Model EXIF to file using exiftool."""
    args = [EXIFTOOL, "-overwrite_original"]
    if make:
        args.append(f"-EXIF:Make={make}")
    if model:
        args.append(f"-EXIF:Model={model}")
    args.append(path)

    result = subprocess.run(args, capture_output=True, text=True)
    if result.returncode != 0:
        return result.stderr.strip()
    return None


def main():
    parser = argparse.ArgumentParser(description="Copy camera EXIF from reference photo to album photos missing camera info")
    parser.add_argument("--album", required=True, help="Album name to filter photos")
    parser.add_argument("--ref-uuid", required=True, help="UUID of the reference photo with correct camera EXIF")
    parser.add_argument("--dry-run", action="store_true", help="Preview without writing EXIF")
    args = parser.parse_args()

    # 1. Get camera info from reference photo
    make, model = get_camera_from_ref(args.ref_uuid)
    print(f"Reference camera: {make} {model}")

    # 2. Find target photos from items.json
    with open(ITEMS_JSON) as f:
        items = json.load(f)

    targets = [
        item for item in items
        if args.album in (item.get("albums") or [])
        and item.get("camera") is None
        and item.get("uuid") != args.ref_uuid
    ]

    if not targets:
        print(f"No photos without camera info found in album '{args.album}'")
        return

    print(f"Found {len(targets)} photos without camera info in '{args.album}'")

    if args.dry_run:
        for item in targets:
            print(f"  Would update: {item['uuid']} ({item.get('date', 'no date')})")
        return

    # 3. Batch-query paths, filter to downloaded only
    all_uuids = [item["uuid"] for item in targets]
    paths = get_photo_paths(all_uuids)
    missing = len(all_uuids) - len(paths)
    if missing:
        print(f"  ({missing} not downloaded, skipping)")

    if not paths:
        print("No downloaded photos to update")
        return

    # 4. Update each downloaded photo
    updated = 0
    errors = 0
    for uuid, path in paths.items():
        if has_camera_exif(path):
            print(f"  ALREADY {uuid}: {os.path.basename(path)}")
            continue

        err = set_exif_camera(path, make, model)
        if err:
            print(f"  ERROR {uuid}: {err}")
            errors += 1
        else:
            print(f"  OK {uuid}: {os.path.basename(path)}")
            updated += 1

    print(f"\nDone: {updated} updated, {errors} errors, {missing} not downloaded")


if __name__ == "__main__":
    main()
