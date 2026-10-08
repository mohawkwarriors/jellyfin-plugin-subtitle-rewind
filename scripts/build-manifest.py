#!/usr/bin/env python3
import sys
import os
import json
import hashlib
from datetime import datetime, timezone

def calculate_md5(file_path):
    hash_md5 = hashlib.md5()
    with open(file_path, "rb") as f:
        for chunk in iter(lambda: f.read(4096), b""):
            hash_md5.update(chunk)
    return hash_md5.hexdigest()

def main():
    if len(sys.argv) < 5:
        print("Usage: build-manifest.py <zip_path> <version> <repo_owner> <repo_name> [output_manifest_path]")
        sys.exit(1)

    zip_path = sys.argv[1]
    version = sys.argv[2].lstrip('v')
    owner = sys.argv[3]
    repo = sys.argv[4]
    out_path = sys.argv[5] if len(sys.argv) > 5 else "manifest.json"

    if not os.path.exists(zip_path):
        print(f"Error: Zip file {zip_path} not found.")
        sys.exit(1)

    checksum = calculate_md5(zip_path)
    version_parts = version.split('.')
    while len(version_parts) < 4:
        version_parts.append('0')
    full_version = '.'.join(version_parts)

    source_url = f"https://github.com/{owner}/{repo}/releases/download/v{version}/Jellyfin.Plugin.SubtitleRewind.zip"
    timestamp = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")

    plugin_entry = {
        "guid": "a5c7f763-71f0-4598-bbcf-f179b068e8d2",
        "name": "Subtitle Rewind",
        "description": "Apple TV-inspired auto-subtitles for 60 seconds when skipping back up to 90 seconds to catch missed dialogue.",
        "overview": "Automatically turns on subtitles when skipping backward during playback and seamlessly reverts them without UI disruption.",
        "owner": owner,
        "category": "Playback",
        "versions": [
            {
                "version": full_version,
                "changelog": f"Release v{version}: Automatic subtitle rewind for missed dialogue.",
                "targetAbi": "10.9.0.0",
                "sourceUrl": source_url,
                "checksum": checksum,
                "timestamp": timestamp
            }
        ]
    }

    manifest = [plugin_entry]

    if os.path.exists(out_path):
        try:
            with open(out_path, 'r', encoding='utf-8') as f:
                existing = json.load(f)
                if isinstance(existing, list) and len(existing) > 0:
                    for item in existing:
                        if item.get("guid") == plugin_entry["guid"]:
                            item["versions"] = [v for v in item.get("versions", []) if v.get("version") != full_version]
                            item["versions"].insert(0, plugin_entry["versions"][0])
                            manifest = existing
                            break
        except Exception as e:
            print(f"Warning: Could not merge with existing manifest: {e}")

    with open(out_path, 'w', encoding='utf-8') as f:
        json.dump(manifest, f, indent=2)

    print(f"Successfully generated {out_path} for version {full_version}")

if __name__ == "__main__":
    main()
