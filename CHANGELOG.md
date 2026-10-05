# Changelog

All notable changes to this plugin. Versions match `manifest.json` and the `vX.Y.Z` git tags.

## 0.5.3

### Changed
- Renamed to **Key Light Direct** (was "Elgato Key Light") so it can't be confused with
  Elgato's official plugin. The bundle ID stays `me.dwot.keylight`, so existing keys and
  settings carry over; the actions now appear under "Key Light Direct" in OpenDeck's sidebar.
- README and manifest description state platform support: tested on Linux, untested on
  Windows and macOS.
- README: Node.js 20+ requirement (was 18+) and install steps for the plugin store and release
  files.

## 0.5.2

### Changed
- Release workflow: actions pinned to full commit SHAs (Dependabot keeps them current), and the
  workflow token is read-only except for `contents: write` on the release job.
- Example values in the settings panel and code comments are now generic (the Manual IPs
  placeholder and the example light ID).

## 0.5.1

### Changed
- Release workflow: `actions/checkout@v7` (without persisted credentials), `actions/setup-node@v7`
  building on Node 24, `softprops/action-gh-release@v3`. All run on GitHub's Node 24 runtime.

## 0.5.0

### Changed
- Real icons replace the placeholder circles: amber glyphs on a dark ground for keys, white
  glyphs for the action list and category, and a 256/512 plugin icon.

## 0.4.1

### Fixed
- New Scene, Set Brightness and dial keys no longer fail until the device dropdown is changed.
  A key with no device saved now targets "All lights", as its settings already showed.
- Brightness and temperature dials pick up changes made elsewhere (phone app, other keys)
  instead of continuing from their own last value.
- Scene brightness slider starts at 1%, matching what the lights accept.

### Changed
- Manifest passes `streamdeck validate`: `Software.MinimumVersion` 6.9, Category matches the
  plugin name, 4-part `Version` (`0.4.1.0`). Linux support moved to `manifest.linux.json`,
  which OpenDeck merges over `manifest.json` on Linux (Elgato's schema only allows mac/windows).
- `ws` is pinned with `package-lock.json`; release zips bundle `node_modules` (OpenDeck never
  runs `npm install`) and leave out dev scripts.
- Tag-driven GitHub release workflow.

## 0.4.0

### Changed
- Talks to the lights directly over their HTTP API (port 9123) instead of going through
  keylight-control, which is no longer needed.
- Finds lights with built-in mDNS discovery (`_elg._tcp`), with a Rescan button and a
  Manual IPs fallback in every action's settings.
- Lights are identified by MAC address, and the last-known lights are cached so keys work at
  startup before discovery finishes.
- Light names come from the lights themselves.
- `install.sh` installs to OpenDeck 2.x's plugin folder (`~/.config/opendeck/plugins`) and
  skips `npm install` when `ws` is already available.

## 0.3.0

- Initial release: Toggle, Set Brightness, Apply Scene, and Stream Deck+ brightness and
  temperature dials, via keylight-control's local API.
