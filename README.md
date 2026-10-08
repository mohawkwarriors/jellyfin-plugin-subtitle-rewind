# Jellyfin Subtitle Rewind (Auto-Sub on Rewind)

> An Apple TV-inspired Jellyfin Web plugin that automatically turns on subtitles for 60 seconds when skipping backward up to 90 seconds to catch missed dialogue, reverting seamlessly with zero UI disruption.

## Features
- **Discrete Skip Detection:** Detects keyboard skips (Left Arrow, J) and OSD rewind buttons. Ignores timeline slider dragging.
- **Rewind Cap:** Skips up to 90 seconds (configurable) trigger auto-subtitles; large skips are ignored.
- **Fixed Display Window:** Subtitles stay active for 60 seconds of playback time from where you resumed, then turn back off.
- **Format-Safe:** Prioritizes text subtitles (SRT/VTT) over bitmap subtitles (PGS/VobSub) to prevent video transcoding stutter.
- **Manual Override Defense:** If you change subtitles manually during the window, auto-reversion cancels immediately.
- **Settings UI:** Configure duration, rewind cap, and language preference via `Alt + S` or the navigation bar button (`⏪💬`).

## Quick Start / Deploy via GitHub
1. Push this repository to GitHub: `https://github.com/mohawkwarriors/jellyfin-plugin-subtitle-rewind`.
2. Push a release tag: `git tag v1.0.0 && git push origin v1.0.0`.
3. GitHub Actions builds the plugin and publishes `manifest.json` to GitHub Pages.
4. In Jellyfin (**Dashboard -> Plugins -> Repositories**), add:
   `https://mohawkwarriors.github.io/jellyfin-plugin-subtitle-rewind/manifest.json`
5. Go to **Catalog**, find **Subtitle Rewind**, and click **Install**!
