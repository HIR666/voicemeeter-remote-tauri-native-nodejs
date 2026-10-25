# Voicemeeter Remote

Control Voicemeeter from your phone, tablet, or Windows desktop over your local
network. Voicemeeter Remote lives in the Windows system tray and provides the
connection link and QR code needed to pair another device.

No separate Node.js installation is required. The Windows installer includes
its own private runtime and all required components.

## Features

- Control eight Voicemeeter strips and eight output buses.
- Adjust gain, mute channels, and toggle A1–A5/B1–B3 routing.
- Live synchronization between Voicemeeter and every connected remote.
- First-run Connection Hub with the current PC address, complete pairing URL,
  and a scannable QR code.
- Automatic port selection that remains stable between launches and changes
  only when the saved port is unavailable.
- Multiple-network-interface support for PCs with both Wi-Fi and Ethernet.
- Optional Start with Windows mode that stays quietly in the system tray.
- Phone home-screen installation/shortcut using the desktop application icon.
- Pairing-token protection for devices connecting over the network.

## Requirements

- Windows 11 x64 (Windows 10 x64 may also work but is not currently tested).
- [Voicemeeter](https://vb-audio.com/Voicemeeter/) installed and running.
- A phone and PC connected to the same local network for phone access.
- Microsoft Edge WebView2 Runtime, included with current Windows versions.

Node.js, Rust, and development tools are **not** required to install or use the
application.

## Install

1. Open the repository's [latest release](https://github.com/HIR666/voicemeeter-remote-tauri-native-nodejs/releases/latest).
2. Download **Voicemeeter Remote_1.1.0_x64-setup.exe** from the release assets.
3. Run the installer, then launch **Voicemeeter Remote**.
4. If Windows Firewall asks, allow access on **Private networks** only.

The installer is currently unsigned, so Microsoft Defender SmartScreen may
display an unrecognized-app warning. If you downloaded it from this repository,
choose **More info** and then **Run anyway**.

For a private GitHub repository, only collaborators who can access the
repository can see or download its releases.

## Connect your phone

On the first normal launch, the **Connection Hub** opens automatically:

1. Confirm the phone and PC are connected to the same Wi-Fi/local network.
2. Scan the QR code with the phone's camera.
3. Open the detected link in Chrome, Safari, or your preferred browser.
4. Wait for the page to show **Connected** and **Synced**.

The hub can always be reopened by right-clicking the tray icon and selecting
**Connection Hub**. Use this after changing Wi-Fi networks or whenever the PC's
local IP address changes.

The pairing link contains a private token. Anyone with that link and access to
the same network can control Voicemeeter, so do not post it publicly.

## Add it to your phone's home screen

Open the remote page and select **Install / Add shortcut**.

- **Android/Chrome:** accept the installation prompt when available. Otherwise,
  open the browser menu and choose **Add to Home screen**.
- **iPhone/iPad:** tap **Share**, then **Add to Home Screen**.

Private LAN pages normally use HTTP rather than HTTPS. Depending on the mobile
browser, this may create a home-screen shortcut instead of a fully installed
offline web app. Both provide the same remote controls and application icon.

## Tray menu

Closing a window does not stop phone access. The application continues running
in the Windows notification area.

| Menu item | Purpose |
| --- | --- |
| **Connection Hub** | Show the current phone URL and QR code. |
| **Open Remote** | Open the mixer controls in the Windows application. |
| **Open Web UI** | Open the controls in the default PC browser. |
| **Restart Audio Engine** | Ask Voicemeeter to restart its audio engine. |
| **Restart Server** | Restart the local remote-control service. |
| **Start with Windows** | Toggle silent startup at Windows sign-in. |
| **Quit** | Stop the server and completely exit the application. |

## Troubleshooting

### The page opens but says Disconnected / Not synced

- Reopen **Connection Hub** and scan its current QR code. An old browser tab may
  still contain a previous pairing token or address.
- Confirm Voicemeeter is running on the PC.
- Make sure the phone is not using mobile data, a guest Wi-Fi network, or a VPN
  that isolates it from the PC.
- Close old remote tabs before opening a newly generated link.

### The phone cannot open the page

- Confirm both devices are on the same local network.
- Allow Voicemeeter Remote through Windows Firewall on **Private networks**.
- Reopen Connection Hub after switching between Ethernet and Wi-Fi and select
  the appropriate interface if more than one is listed.
- Some routers isolate guest-network devices; use the primary home network.

### The controls open but do not affect Voicemeeter

- Use **Restart Audio Engine** from the tray.
- If that does not help, restart Voicemeeter and select **Sync** in the remote.
- Use **Restart Server** as a final quick recovery step.

### Logs

Diagnostic files are stored in:

```text
%APPDATA%\com.rat.voicemeeter-remote\server.log
%APPDATA%\com.rat.voicemeeter-remote\startup.log
```

The same folder contains `settings.json`. Setting its `port` value to `0` while
the application is fully stopped requests a new automatic port on the next
launch.

## Updating or uninstalling

To update, download and run the newer installer. Existing pairing settings are
retained when possible. Reopen Connection Hub if the network address or port
changes.

To uninstall, open **Windows Settings → Apps → Installed apps**, find
**Voicemeeter Remote**, and select **Uninstall**. Quitting the application first
avoids files being in use.

## Privacy and network access

- The server listens only on the PC and its local network; this project does not
  provide public internet access or a cloud relay.
- Network clients require the pairing token shown in Connection Hub.
- Administrative connection details are available only from the local PC.
- Commands are validated before being sent to Voicemeeter.
- No analytics or telemetry are included.

## Building from source

This section is for contributors. End users should use the release installer.

### Development requirements

- Node.js 22 or newer
- Rust 1.84 or newer
- Windows x64 with Voicemeeter installed

```powershell
npm install
npm run dev              # Tauri desktop development build
npm run dev:server       # backend only
npm run dev:ui           # browser UI only
npm run verify           # UI build and backend tests
npm run build            # create the NSIS installer
```

The release packages a private Node runtime as `vmr-node.exe`, the backend and
its production dependencies, native Koffi bindings, and the built web UI. The
installed application does not depend on a system-wide Node.js installation.

The generated installer is written to:

```text
src-tauri\target\release\bundle\nsis\
```

The read-only `vm-phone-remote` and `ratilities` migration references are not
required at runtime and are not included in the installer.
