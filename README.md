# opendeck-keylight

An [OpenDeck](https://github.com/nekename/OpenDeck) plugin for controlling Elgato Key
Light devices on Linux. Includes full Stream Deck+ dial support.

This plugin is a thin shim — it doesn't talk to the lights directly. Instead, it talks
to [keylight-control](https://github.com/sandwichfarm/keylight-control)'s local HTTP
API, which already handles mDNS discovery, the Elgato HTTP protocol, and connection
management.

## Why this design?

`keylight-control` is a fully-featured standalone GUI for Key Lights that already
solves the hard problems. Rather than re-implement device discovery and the Elgato
protocol, this plugin treats `keylight-control` as a backend daemon and adds Stream
Deck integration on top.

```
┌─────────────┐  WebSocket  ┌─────────────────────┐   HTTP   ┌──────────────────┐
│  OpenDeck   │ ◄────────► │ opendeck-keylight   │ ──────► │ keylight-control │
│ (SD device) │  (SDK proto)│ (this plugin, Node) │  :27301  │  (mDNS + Elgato) │
└─────────────┘             └─────────────────────┘          └──────────────────┘
```

## Requirements

- [OpenDeck](https://github.com/nekename/OpenDeck) installed
- Node.js 18+ (`sudo apt install nodejs npm`)
- [keylight-control](https://github.com/sandwichfarm/keylight-control) running, with
  HTTP API enabled (Settings → Advanced → Enable HTTP API). Verify:

      curl http://localhost:27301/api/lights

## Install

```bash
git clone https://github.com/dwot/opendeck-keylight.git
cd opendeck-keylight
./install.sh
```

Then restart OpenDeck.

The script auto-detects native vs. Flatpak OpenDeck installs and copies the plugin to
the right location, then runs `npm install` for the `ws` dependency.

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

Set environment variables before launching OpenDeck if your keylight-control is on a
non-default host or port:

```bash
KEYLIGHT_HOST=127.0.0.1 KEYLIGHT_PORT=27301 opendeck
```

## Repo layout

```
.
├── manifest.json              Stream Deck SDK plugin manifest
├── package.json               Node deps (just `ws`)
├── bin/
│   └── plugin.js              Main plugin: WebSocket to OpenDeck, HTTP to keylight-control
├── propertyInspector/         HTML config UIs shown in OpenDeck for each action
│   ├── common.js              Shared SDK boilerplate
│   ├── style.css
│   ├── toggle.html
│   ├── setbrightness.html
│   ├── scene.html
│   ├── brightnessdial.html
│   └── temperaturedial.html
├── icons/                     PNG icons (placeholder colored circles for now)
│   └── make_icons.py          Regenerates all icons
├── install.sh                 Install to OpenDeck plugins dir
└── build.sh                   Produce a distributable .streamDeckPlugin zip
```

## Build

To produce a `.streamDeckPlugin` file (zip) for distribution:

```bash
./build.sh
# Output: dist/me.dwot.keylight-X.Y.Z.streamDeckPlugin
```

OpenDeck's GUI plugin installer accepts `.streamDeckPlugin` files. The repo is also
directly installable via `install.sh` without building.

## Implementation notes

- **State polling**: `lights.list` is polled every 5s to keep button visuals synced
  with external changes (e.g., toggling from the keylight-control GUI). After each
  user action, polled again 250ms later for snappy feedback.
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
