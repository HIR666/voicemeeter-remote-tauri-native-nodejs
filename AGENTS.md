# Project boundaries

`vm-phone-remote` and `ratilities` are read-only migration references. Do not
install dependencies in, edit, reformat, or otherwise alter either project.

All standalone application code belongs in this repository. The React remote
is a deliberately small extraction of the original `VoicemeeterRemote` page;
its appearance and controls are kept intact. The Node server retains the
original Koffi/Voicemeeter Remote DLL integration and is launched by Tauri as
the only long-running backend sidecar. Tauri owns its lifecycle and provides
the tray/autostart shell.

In a release package, the sidecar is a bundled Node runtime plus `server/`
resources (including its native dependencies), not a dependency on a global
Node installation or either reference project.
