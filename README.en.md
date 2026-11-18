# Fictaris

**A desk for writers and worldbuilders.** Manuscript, characters, locations, factions, timeline, maps and canvases in one app. Your project is a plain folder on your disk – no cloud, no account.

[Русская версия](README.md) · [Download](https://github.com/DeQerrti/Fictaris-app/releases/latest) · [What's new](CHANGELOG.md) · [Report a problem](https://github.com/DeQerrti/Fictaris-app/issues)

## Features

- **Manuscript.** Several books in one world, parts and folders, chapter statuses, word goals per book and per day. Each chapter has a synopsis, who and where is in it, notes, inline stickies and version snapshots. The Overview mode shows the book as cards by part. Export to `.md`, `.docx`, PDF and EPUB.
- **Characters.** A cast view grouped by importance, house or faction, and a dossier with a custom form, family, relationships and every place the character appears in the story.
- **Family tree** with marriages, engagements, divorces, adopted and uncertain parentage. Focus mode tells who is whose aunt, stepbrother or father-in-law.
- **Relationships** – a map of how characters feel about each other, from enmity to closeness.
- **Locations and factions.** Nested places with a mini-map; factions with a leader, members, headquarters and relations to each other.
- **Timeline.** A chronicle, a swimlane scale per character, and a calendar of your own world: custom months, weeks, holidays and birthdays.
- **Maps.** Upload an image or draw a map in the app: land, water, rivers, roads, mountains, cities, faction borders. Pins and nested maps.
- **Canvases** – an Excalidraw-style board: cards (including characters, places and chapters from your world), arrows, frames, shapes and freehand drawing.
- **Board** – a kanban for scenes, ideas and edits, with checklists.
- **Who knows what** – from which chapter a character knows a fact.
- **Continuity check**, global search (`/`), trash, version history of every file, name generator.
- **Export your world** as a website or a PDF; back up the whole project into one file.
- **Sync** between devices through your own private GitHub repository (optional).
- English and Russian interface, light and dark themes.

To see everything at once, open **Settings → This world → Data → Fill with example**: a complete sample world appears. You can remove it in the same place.

## Installation

Download the file for your system from the [latest release](https://github.com/DeQerrti/Fictaris-app/releases/latest).

The app is **not code-signed** yet, so on first launch your system will warn that the publisher is unknown. This is expected.

### Windows 10 and 11
File `Fictaris-Setup-X.Y.Z.exe`.
1. Run the installer. If you see "Windows protected your PC", click **More info → Run anyway**.
2. With Smart App Control on (Windows 11), an unsigned app may be blocked with no "Run anyway" button. The only way around it is to turn Smart App Control off in Windows Security → App & browser control; note that Windows lets you turn it back on only after reinstalling the system.

On Windows, updates download automatically and the app offers to restart.

### macOS 12 or later
File `Fictaris-Setup-X.Y.Z-arm64.dmg` for Apple Silicon (M1 and later) or `…-x64.dmg` for Intel Macs.
1. Open the `.dmg` and drag Fictaris to Applications.
2. On first launch macOS will say the app can't be opened or is "damaged". Open **System Settings → Privacy & Security** and click **Open Anyway** next to Fictaris.
3. If there is no such button, run this in Terminal and launch again:
   ```bash
   xattr -cr /Applications/Fictaris.app
   ```

On a Mac the app tells you about a new version, but you install it manually the same way.

### Linux
File `Fictaris-Setup-X.Y.Z.AppImage` (x86-64).
```bash
chmod +x Fictaris-Setup-*.AppImage
./Fictaris-Setup-*.AppImage
```
Ubuntu 22.04 and later may need `sudo apt install libfuse2`. If on Ubuntu 24.04 the app fails with a sandbox error, start it with `--no-sandbox`.

### Android 7 or later
File `Fictaris-X.Y.Z.apk`. Open it on your phone and allow installing from that source when Android asks.

## Where your data lives

A project is the folder you chose on first launch (`Documents/Fictaris` by default). It holds one JSON file per section, images in `maps/` and version history in `.history/`. You can copy the folder, keep it in a cloud drive or put it under git.

- **Version history.** Earlier versions of every file are kept in `.history/`: everything from the last hour, one per hour for a day, one per day for a month. Roll back in **Settings → This world → Data → Version history**.
- **Trash.** Deleted characters, places, chapters and the rest go to the trash first.
- **The `CLAUDE.md` file** in the project folder describes the file format for AI assistants that work with folders (such as Claude Code). The app doesn't need it: delete it and Fictaris recreates it, or remove its first line to make it yours so it is never overwritten.
- **On a phone** the project is stored inside the app. Uninstalling the app deletes the project too, so turn on sync or make backups (**Data → Export project**).

## Privacy

Fictaris collects no data and sends your writing nowhere except places you set up yourself. Network requests:

- **Update check** – a request to GitHub for the latest version on launch. On Windows and Linux a new version downloads automatically. Turn it off in **Settings → App → Updates**.
- **Sync** (only if you turn it on) – exchanges project files with your GitHub repository. The access token stays on this device and is never stored in the project or in exports.

## License

Everything you write and create in Fictaris is yours: use, publish and sell it however you like. The app is free to download and use for any project, including commercial ones. The source code may not be copied or modified. See [LICENSE](LICENSE).

## For developers

Electron and Capacitor (Android), vanilla JavaScript ES modules, no frameworks. The project file format is described in [`electron/vault-guide.md`](electron/vault-guide.md). Installers are built in GitHub Actions (`.github/workflows/build.yml`).
