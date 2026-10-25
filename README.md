# Voicemeeter Remote

Voicemeeter Remote is a standalone Windows tray application for the existing
Voicemeeter Remote DLL. It preserves the original React/MUI remote: eight
strips with gain, mute and A1–B3 routing controls; eight collapsible master
buses; live WebSocket state; Sync; and Restart Audio Engine.

## Architecture

- `ui/` is the extracted original remote page, built with React, Vite and MUI
  5. The only behavior change is that it now uses the same-origin WebSocket
  (`/ws`) instead of a hard-coded LAN address.
- `server/` is the single Express/WebSocket backend. It calls the existing,
  installed `VoicemeeterRemote64.dll` through Koffi; it does not copy, modify,
  or redistribute Voicemeeter.
- `src-tauri/` owns the process lifecycle, a lazy desktop WebView, a tray
  menu, autostart, and the packaged Node sidecar.

Production serves both the browser UI and WebSocket from one server on port
`5164` by default. Vite is never used in a release build.

## Requirements

- Windows 11 x64
- Voicemeeter installed in one of its standard locations (including
  `VoicemeeterRemote64.dll`)
- WebView2 Runtime (normally included with Windows 11)
- Node.js 22+ and Rust 1.84+ only for development/building

## Development

```powershell
npm install
npm run dev:server       # backend only
npm run dev:ui           # Vite UI only
npm run dev              # Tauri desktop development
npm run verify           # UI build plus backend protocol tests
npm run build            # packages Node sidecar then builds the NSIS installer
```

`npm run package:sidecar` copies the current Windows x64 Node executable to
the Tauri external-binary location and installs only the server's production
dependencies beside `server.js`. This keeps Koffi and its native `.node`
binary on disk, which is required by Node native-module loading. The release
installer therefore has no dependency on a system Node/Yarn install.

## Install and use

Run the generated NSIS installer. On launch the app starts hidden, creates a
tray icon, starts the managed backend, and serves the remote. Select **Open
Remote** to create/focus the desktop window; closing that window hides it and
leaves phone access and the backend running.

The tray menu provides Open Web UI, Restart Audio Engine, Restart Server,
Start with Windows, and Quit. Autostart is opt-in and the checked state is the
real Windows registration state. Quit owns a graceful sidecar stop before
exiting.

## Phone access and LAN security

The default local address is `http://<Windows-LAN-IP>:5164`. LAN browser
clients need the one-time pairing token in the locally stored settings file:

```text
http://<Windows-LAN-IP>:5164/?token=<authToken from settings.json>
```

Loopback access from the tray/desktop is trusted; non-loopback WebSocket and
administrative requests require the token. Commands are schema-validated,
WebSocket origin/host checks are enforced, no wildcard CORS policy is used,
and the service binds only to LAN interfaces (never creates public internet
exposure). Keep the pairing URL private.

Settings are in Tauri's Windows application-data directory, normally under
`%APPDATA%\com.rat.voicemeeter-remote\settings.json`; `server.log` is next to
it. The configuration supports `port`, `lanAccess`, `allowedInterfaces`, and
`authToken`. Change the port only while the app is stopped, then restart it.
Setting `lanAccess` to `false` binds to loopback only.

If Windows Firewall prompts for access, allow **Private networks only** for
the application and port 5164. Do not add a public-network or broad inbound
rule.

## Troubleshooting

- If the UI says disconnected, check that Voicemeeter itself is running and
  inspect `server.log`. The server stays alive and retries every 15 seconds
  when Voicemeeter is not ready at Windows sign-in.
- If port 5164 is occupied, the backend logs a diagnostic and does not stop
  the unrelated process. Choose an unused `port` in `settings.json`.
- If controls do not respond, use tray **Restart Audio Engine**, then Sync.
- Uninstall with Windows Settings > Installed apps. Disable Start with
  Windows first if Windows retains a stale entry after a forceful uninstall.

## Migration inventory

Migrated from the read-only references:

- the `VoicemeeterRemote` React/MUI screen and Discord/Spotify icon assets;
- strip/bus schema, gain/mute/routing message contracts, hydrated state and
  audio-engine restart command;
- Koffi DLL integration paths and `VBVMR_*` function signatures.

The original `vm-phone-remote` and `ratilities` directories are never needed
at runtime and were not modified.
