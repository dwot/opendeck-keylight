# opendeck-keylight

An [OpenDeck](https://github.com/nekename/OpenDeck) plugin for controlling Elgato Key
Light devices on Linux. Includes full Stream Deck+ dial support.

> Unofficial community plugin. Not affiliated with or endorsed by Elgato or Corsair.
> "Elgato" and "Key Light" are trademarks of Corsair Memory, Inc.

The plugin talks to the lights directly over their local HTTP API (port 9123) and finds
them on the network with mDNS (`_elg._tcp`). Nothing else needs to be running.

```
┌─────────────┐  WebSocket  ┌─────────────────────┐   HTTP :9123   ┌────────────┐
│  OpenDeck   │ ◄────────► │ opendeck-keylight   │ ─────────────► │ Key Lights │
│ (SD device) │  (SDK proto)│ (this plugin, Node) │ ◄─ mDNS ────── │            │
└─────────────┘             └─────────────────────┘                └────────────┘
```

Versions before 0.4.0 went through [keylight-control](https://github.com/sandwichfarm/keylight-control)'s
HTTP API instead; that's no longer needed.

## Requirements

- [OpenDeck](https://github.com/nekename/OpenDeck) installed
- Node.js 18+ (`sudo apt install nodejs node-ws`, or `nodejs npm` and let `install.sh` fetch `ws`)
- The lights reachable from this machine on TCP 9123. For automatic discovery, mDNS
  (UDP 5353) must reach them too: same network, or an mDNS reflector across VLANs.
  Otherwise, enter their IPs under **Manual IPs** in any Key Light action's settings.

## Install

```bash
git clone https://github.com/dwot/opendeck-keylight.git
cd opendeck-keylight
./install.sh
```

Then restart OpenDeck.

The script auto-detects native (`~/.config/opendeck/plugins`) vs. Flatpak OpenDeck
installs, copies the plugin there, and runs `npm install` only if `ws` isn't already
available system-wide.

## Actions

### Stream Deck+ dials

| Action | Rotate | Press / Touch |
| ------ | ------ | ------------- |
| **Brightness Dial** | Adjust brightness (configurable step %) | Toggle on/off |
| **Temperature Dial** | Adjust color temperature, 2900–7000K | Reset to configured default (e.g. 4500K) |

Both dials show live feedback on the touchscreen LCD strip — light name, current value,
and a progress bar.

### Keypad buttons

| Action | Behaviour |
| ------ | --------- |
| **Toggle Light** | Toggle a single light or all lights at once |
| **Set Brightness** | Set a fixed brightness on key press (good for scene presets like 25% / 100%) |
| **Apply Scene** | Combined power + brightness + temperature preset |

All actions support targeting an individual light or **All Lights**. When using "All
Lights" with a dial, both lights track together using the first discovered light as
the reference value.

## Configuration

Every Key Light action's settings panel has a shared footer:

- **Rescan**: run discovery again (also runs every 5 minutes, and whenever a light stops
  answering).
- **Manual IPs**: comma-separated `ip` or `ip:port` list, probed alongside mDNS results. Only
  needed when mDNS can't reach the lights.

Lights are identified by MAC address, so a light keeps its key bindings if DHCP gives it a new
IP. The last-known lights are cached in OpenDeck's global plugin settings, so keys work
immediately on startup, before discovery finishes. Light names come from the name you set
in Elgato Control Center.

## Repo layout

```
.
├── manifest.json              Stream Deck SDK plugin manifest (Elgato-valid: mac/windows)
├── manifest.linux.json        OpenDeck-only override adding the linux platform
├── package.json               Node deps (just `ws`)
├── bin/
│   ├── plugin.js              Main plugin: WebSocket to OpenDeck, action handlers
│   ├── keylights.js           Elgato HTTP client + device registry (discovery, cache, polling)
│   └── mdns.js                Dependency-free mDNS browser for _elg._tcp
├── propertyInspector/         HTML config UIs shown in OpenDeck for each action
│   ├── common.js              Shared SDK boilerplate
│   ├── style.css
│   ├── toggle.html
│   ├── setbrightness.html
│   ├── scene.html
│   ├── brightnessdial.html
│   └── temperaturedial.html
├── icons/                     PNG icons (key images, action list, category, plugin)
├── install.sh                 Install to OpenDeck plugins dir
├── build.sh                   Produce a distributable .streamDeckPlugin zip
├── CHANGELOG.md
└── .github/workflows/
    └── release.yml            Tag-driven build + validate + GitHub release
```

## Releases

Bump `Version` in `manifest.json` (4-part, `X.Y.Z.0`) and `version` in `package.json` (`X.Y.Z`), add a `CHANGELOG.md`
section, then tag and push `vX.Y.Z`. `.github/workflows/release.yml` checks that the tag
matches the manifest, builds, runs `streamdeck validate` and publishes the
`.streamDeckPlugin` as the release's only asset (on the GitHub mirror).

## Build

To produce a `.streamDeckPlugin` file (zip) for distribution:

```bash
./build.sh
# Output: dist/me.dwot.keylight-X.Y.Z.streamDeckPlugin
```

OpenDeck's GUI plugin installer accepts `.streamDeckPlugin` files. The repo is also
directly installable via `install.sh` without building.

## Implementation notes

- **State polling**: every light's `GET /elgato/lights` is polled every 5s to keep button
  visuals synced with external changes (phone app, Control Center). Writes use
  `PUT /elgato/lights`, and the reply (the light's new state) updates the keys immediately.
- **Discovery**: `bin/mdns.js` joins 224.0.0.251:5353 with `SO_REUSEADDR` (coexists with
  avahi), sends a PTR query for `_elg._tcp.local` and resolves SRV/A/TXT records. Each hit is
  confirmed with `GET /elgato/accessory-info`. A light that fails 3 polls in a row is dropped
  until the next successful discovery.
- **Legacy settings**: keys configured under 0.3.x stored keylight-control's numeric index;
  those resolve to the Nth light sorted by name until the key is re-saved.
- **Dial debouncing**: dial rotates apply optimistic local UI immediately, then
  debounce HTTP calls by 80ms — spinning the dial fires 1–2 requests, not 50.
- **Temperature units**: the API speaks Elgato's native units (143–344). The plugin
  converts to/from Kelvin for the UI. 143 ≈ 7000K, 344 ≈ 2900K, linear interp.
- **All Lights toggle**: smart group toggle. If *any* light is on, all get turned off;
  if all are off, all get turned on. Avoids out-of-sync states.

## Logs

OpenDeck plugin logs:

    ~/.local/share/opendeck/logs/

The plugin writes to stdout/stderr, captured by OpenDeck.

## License

MIT — see [LICENSE](LICENSE).
