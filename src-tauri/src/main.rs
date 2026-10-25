#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::{
    fs,
    io::{Read, Write},
    net::{SocketAddr, TcpListener, TcpStream},
    path::PathBuf,
    process::{Child, Command, Stdio},
    sync::{atomic::{AtomicBool, Ordering}, Mutex},
    time::Duration,
};
#[cfg(windows)]
use std::os::windows::process::CommandExt;

use tauri::{
    menu::{CheckMenuItem, Menu, MenuItem, PredefinedMenuItem},
    tray::{TrayIconBuilder, TrayIconEvent},
    Manager, WebviewUrl, WebviewWindowBuilder, WindowEvent,
};
use tauri_plugin_autostart::ManagerExt as AutostartManagerExt;
use tauri_plugin_opener::OpenerExt;

struct BackendState {
    child: Mutex<Option<Child>>,
    quitting: AtomicBool,
}

fn config_dir(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let path = app.path().app_data_dir().map_err(|error| error.to_string())?;
    fs::create_dir_all(&path).map_err(|error| error.to_string())?;
    Ok(path)
}

fn configured_backend_port(app: &tauri::AppHandle) -> Option<u16> {
    let path = config_dir(app).ok()?.join("settings.json");
    fs::read_to_string(path)
        .ok()
        .and_then(|contents| serde_json::from_str::<serde_json::Value>(&contents).ok())
        .and_then(|json| json.get("port")?.as_u64())
        .and_then(|port| u16::try_from(port).ok())
        .filter(|port| *port > 0)
}

fn backend_port(app: &tauri::AppHandle) -> Result<u16, String> {
    configured_backend_port(app).ok_or_else(|| "The backend has not selected a listening port yet.".into())
}

fn prepare_backend_port(app: &tauri::AppHandle) -> Result<(), String> {
    let path = config_dir(app)?.join("settings.json");
    let mut settings = fs::read_to_string(&path).ok()
        .and_then(|contents| serde_json::from_str::<serde_json::Value>(&contents).ok())
        .and_then(|value| value.as_object().cloned())
        .unwrap_or_default();
    let configured = settings.get("port").and_then(|value| value.as_u64())
        .and_then(|port| u16::try_from(port).ok()).filter(|port| *port > 0);
    if let Some(port) = configured {
        // Probe all interfaces because the backend binds to the LAN, not only
        // loopback. If unavailable, let Windows select and persist a new port.
        if TcpListener::bind(("0.0.0.0", port)).is_ok() { return Ok(()); }
    }
    settings.insert("port".into(), serde_json::Value::from(0));
    let contents = serde_json::to_string_pretty(&settings).map_err(|error| error.to_string())?;
    fs::write(path, format!("{contents}\n")).map_err(|error| error.to_string())
}

fn wait_for_backend(app: &tauri::AppHandle, child: &mut Child) -> Result<u16, String> {
    for _ in 0..100 {
        if let Some(status) = child.try_wait().map_err(|error| error.to_string())? {
            return Err(format!("Backend exited with {status}. See startup.log in the app data folder."));
        }
        if let Some(port) = configured_backend_port(app) {
            let address: SocketAddr = format!("127.0.0.1:{port}").parse().expect("valid loopback address");
            if TcpStream::connect_timeout(&address, Duration::from_millis(100)).is_ok() { return Ok(port); }
        }
        std::thread::sleep(Duration::from_millis(100));
    }
    Err("Backend did not select a reachable port. See startup.log in the app data folder.".into())
}

fn record_startup_error(app: &tauri::AppHandle, message: &str) {
    if let Ok(directory) = config_dir(app) {
        let path = directory.join("startup.log");
        let line = format!("[STARTUP] {message}\n");
        let _ = fs::OpenOptions::new().create(true).append(true).open(path)
            .and_then(|mut file| file.write_all(line.as_bytes()));
    }
}

fn start_backend(app: &tauri::AppHandle) -> Result<(), String> {
    let state = app.state::<BackendState>();
    let mut owned_child = state.child.lock().map_err(|_| "Backend lock was poisoned.")?;
    if let Some(child) = owned_child.as_mut() {
        if child.try_wait().map_err(|error| error.to_string())?.is_none() { return Ok(()); }
        *owned_child = None;
    }

    let data_dir = config_dir(app)?;
    prepare_backend_port(app)?;
    let resource_dir = if cfg!(debug_assertions) {
        PathBuf::from(env!("CARGO_MANIFEST_DIR")).parent().unwrap().to_path_buf()
    } else {
        app.path().resource_dir().map_err(|error| error.to_string())?
    };
    let (program, script) = if cfg!(debug_assertions) {
        let root = PathBuf::from(env!("CARGO_MANIFEST_DIR")).parent().unwrap().to_path_buf();
        (PathBuf::from("node"), root.join("server/server.js"))
    } else {
        // The explicit bundle resource map installs server/ and ui/dist/
        // beneath resource_dir; the Node executable is beside the app exe.
        let executable_dir = std::env::current_exe()
            .map_err(|error| error.to_string())?
            .parent()
            .map(PathBuf::from)
            .ok_or("The application executable has no parent directory.")?;
        let sidecar = executable_dir.join("vmr-node.exe");
        if !sidecar.is_file() {
            return Err(format!("Bundled Node runtime was not found at {}.", sidecar.display()));
        }
        (sidecar, resource_dir.join("server/server.js"))
    };

    if !script.is_file() {
        return Err(format!("Bundled server entry point was not found at {}.", script.display()));
    }
    let ui_entry = resource_dir.join("ui/dist/index.html");
    if !cfg!(debug_assertions) && !ui_entry.is_file() {
        return Err(format!("Built UI was not found at {}.", ui_entry.display()));
    }
    // Retain failures before server.js can initialize its own server.log.
    let startup_log = fs::OpenOptions::new().create(true).append(true)
        .open(data_dir.join("startup.log")).map_err(|error| error.to_string())?;
    let stderr_log = startup_log.try_clone().map_err(|error| error.to_string())?;
    let mut command = Command::new(program);
    command
        .args([
            script.to_string_lossy().to_string(),
            "--config-dir".into(), data_dir.to_string_lossy().to_string(),
            "--resource-dir".into(), resource_dir.to_string_lossy().to_string(),
        ])
        .stdin(Stdio::null())
        .stdout(Stdio::from(startup_log))
        .stderr(Stdio::from(stderr_log));
    #[cfg(windows)]
    command.creation_flags(0x08000000); // CREATE_NO_WINDOW: keep Node in the tray app's background.
    let mut child = command.spawn()
        .map_err(|error| format!("Could not launch the managed backend: {error}"))?;
    if let Err(error) = wait_for_backend(app, &mut child) {
        let _ = child.kill();
        let _ = child.wait();
        return Err(error);
    }
    *owned_child = Some(child);
    Ok(())
}

fn stop_backend(app: &tauri::AppHandle) {
    if let Ok(mut guard) = app.state::<BackendState>().child.lock() {
        if let Some(mut child) = guard.take() {
            let _ = child.kill();
            let _ = child.wait();
        }
    }
}

fn restart_backend(app: &tauri::AppHandle) -> Result<(), String> {
    stop_backend(app);
    std::thread::sleep(Duration::from_millis(250));
    start_backend(app)
}

fn request_audio_restart(app: &tauri::AppHandle) -> Result<(), String> {
    let address = format!("127.0.0.1:{}", backend_port(app)?);
    let mut stream = TcpStream::connect(&address).map_err(|error| format!("Backend unavailable: {error}"))?;
    stream.set_read_timeout(Some(Duration::from_secs(5))).map_err(|error| error.to_string())?;
    stream.write_all(b"POST /api/restart-audio HTTP/1.1\r\nHost: 127.0.0.1\r\nContent-Length: 0\r\nConnection: close\r\n\r\n").map_err(|error| error.to_string())?;
    let mut response = String::new();
    stream.read_to_string(&mut response).map_err(|error| error.to_string())?;
    if response.starts_with("HTTP/1.1 204") { Ok(()) } else { Err("Voicemeeter did not accept the restart request. See server.log for details.".into()) }
}

fn remote_url(app: &tauri::AppHandle) -> Result<WebviewUrl, String> {
    if cfg!(debug_assertions) {
        return Ok(WebviewUrl::External(url::Url::parse("http://127.0.0.1:1420").map_err(|error| error.to_string())?));
    }
    let url = format!("http://127.0.0.1:{}", backend_port(app)?);
    Ok(WebviewUrl::External(url::Url::parse(&url).map_err(|error| error.to_string())?))
}

fn show_remote(app: &tauri::AppHandle) -> Result<(), String> {
    if let Some(window) = app.get_webview_window("main") {
        window.show().map_err(|error| error.to_string())?;
        window.set_focus().map_err(|error| error.to_string())?;
        return Ok(());
    }
    let window = WebviewWindowBuilder::new(app, "main", remote_url(app)?)
        .title("Voicemeeter Remote")
        .inner_size(520.0, 820.0)
        .min_inner_size(360.0, 520.0)
        .resizable(true)
        .build()
        .map_err(|error| error.to_string())?;
    let close_window = window.clone();
    window.on_window_event(move |event| {
        if let WindowEvent::CloseRequested { api, .. } = event {
            if !close_window.app_handle().state::<BackendState>().quitting.load(Ordering::SeqCst) {
                api.prevent_close();
                let _ = close_window.hide();
            }
        }
    });
    Ok(())
}

fn show_connection_hub(app: &tauri::AppHandle) -> Result<(), String> {
    if let Some(window) = app.get_webview_window("hub") {
        window.show().map_err(|error| error.to_string())?;
        window.set_focus().map_err(|error| error.to_string())?;
        if let Ok(directory) = config_dir(app) {
            let _ = fs::write(directory.join("connection-hub-shown-v1"), b"shown\n");
        }
        return Ok(());
    }
    let url = format!("http://127.0.0.1:{}/?view=hub", backend_port(app)?);
    let window = WebviewWindowBuilder::new(
        app,
        "hub",
        WebviewUrl::External(url::Url::parse(&url).map_err(|error| error.to_string())?),
    )
        .title("Voicemeeter Remote — Connection Hub")
        .inner_size(560.0, 760.0)
        .min_inner_size(460.0, 620.0)
        .resizable(true)
        .center()
        .build()
        .map_err(|error| error.to_string())?;
    let close_window = window.clone();
    window.on_window_event(move |event| {
        if let WindowEvent::CloseRequested { api, .. } = event {
            if !close_window.app_handle().state::<BackendState>().quitting.load(Ordering::SeqCst) {
                api.prevent_close();
                let _ = close_window.hide();
            }
        }
    });
    if let Ok(directory) = config_dir(app) {
        let _ = fs::write(directory.join("connection-hub-shown-v1"), b"shown\n");
    }
    Ok(())
}

fn open_web_ui(app: &tauri::AppHandle) {
    if let Ok(port) = backend_port(app) {
        let _ = app.opener().open_url(format!("http://127.0.0.1:{port}"), None::<&str>);
    }
}

fn is_autostart_launch() -> bool {
    std::env::args().any(|argument| argument == "--autostart")
}

fn is_hub_launch() -> bool {
    std::env::args().any(|argument| argument == "--hub")
}

fn migrate_autostart_registration(app: &tauri::AppHandle) -> bool {
    let marker = match config_dir(app) {
        Ok(directory) => directory.join("autostart-args-v1"),
        Err(_) => return false,
    };
    if marker.exists() { return false; }
    let manager = app.autolaunch();
    let was_enabled = manager.is_enabled().unwrap_or(false);
    if was_enabled {
        // Registrations created by older releases lacked --autostart. Refresh
        // once so future Windows sign-ins can be distinguished from a normal launch.
        if manager.disable().is_ok() { let _ = manager.enable(); }
    }
    let _ = fs::write(marker, b"--autostart\n");
    was_enabled
}

fn show_first_run_hub(app: &tauri::AppHandle) {
    let marker = match config_dir(app) {
        Ok(directory) => directory.join("connection-hub-shown-v1"),
        Err(_) => return,
    };
    if marker.exists() { return; }
    let _ = show_connection_hub(app);
}

fn tray(app: &tauri::AppHandle) -> tauri::Result<()> {
    let hub = MenuItem::with_id(app, "hub", "Connection Hub", true, None::<&str>)?;
    let open = MenuItem::with_id(app, "open", "Open Remote", true, None::<&str>)?;
    let web = MenuItem::with_id(app, "web", "Open Web UI", true, None::<&str>)?;
    let restart_audio = MenuItem::with_id(app, "restart-audio", "Restart Audio Engine", true, None::<&str>)?;
    let restart_server = MenuItem::with_id(app, "restart-server", "Restart Server", true, None::<&str>)?;
    let enabled = app.autolaunch().is_enabled().unwrap_or(false);
    let autostart = CheckMenuItem::with_id(app, "autostart", "Start with Windows", true, enabled, None::<&str>)?;
    let quit = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&hub, &open, &web, &PredefinedMenuItem::separator(app)?, &restart_audio, &restart_server, &PredefinedMenuItem::separator(app)?, &autostart, &PredefinedMenuItem::separator(app)?, &quit])?;

    TrayIconBuilder::with_id("tray")
        .icon(app.default_window_icon().expect("application icon").clone())
        .tooltip("Voicemeeter Remote")
        .menu(&menu)
        .on_menu_event(move |app, event| match event.id().as_ref() {
            "hub" => { let _ = show_connection_hub(app); }
            "open" => { let _ = show_remote(app); }
            "web" => open_web_ui(app),
            "restart-audio" => { let _ = request_audio_restart(app); }
            "restart-server" => { let _ = restart_backend(app); }
            "autostart" => {
                let manager = app.autolaunch();
                let currently_enabled = manager.is_enabled().unwrap_or(false);
                let result = if currently_enabled { manager.disable() } else { manager.enable() };
                if result.is_ok() { let _ = autostart.set_checked(!currently_enabled); }
            }
            "quit" => { app.state::<BackendState>().quitting.store(true, Ordering::SeqCst); stop_backend(app); app.exit(0); }
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            if matches!(event, TrayIconEvent::DoubleClick { .. }) { let _ = show_remote(tray.app_handle()); }
        })
        .build(app)?;
    Ok(())
}

fn main() {
    tauri::Builder::default()
        .manage(BackendState { child: Mutex::new(None), quitting: AtomicBool::new(false) })
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_autostart::init(
            tauri_plugin_autostart::MacosLauncher::LaunchAgent,
            Some(vec!["--autostart"]),
        ))
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_single_instance::init(|app, argv, _cwd| {
            if argv.iter().any(|argument| argument == "--hub") {
                let _ = show_connection_hub(app);
            } else {
                let _ = show_remote(app);
            }
        }))
        .setup(|app| {
            let handle = app.handle().clone();
            let backend_ready = match start_backend(&handle) {
                Ok(()) => true,
                Err(error) => {
                record_startup_error(&handle, &error);
                eprintln!("[VMR] {error}");
                    false
                }
            };
            tray(&handle)?;
            let migrated_autostart = migrate_autostart_registration(&handle);
            if backend_ready {
                if is_hub_launch() {
                    let _ = show_connection_hub(&handle);
                } else if !is_autostart_launch() && !migrated_autostart {
                    show_first_run_hub(&handle);
                }
            }
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running Voicemeeter Remote");
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::HashMap;
    use tauri_utils::resources::ResourcePaths;

    #[test]
    fn bundled_paths_match_the_release_launcher_and_server() {
        let config: serde_json::Value = serde_json::from_str(include_str!("../tauri.conf.json")).unwrap();
        let mapping = config["bundle"]["resources"].as_object()
            .expect("Use explicit source-to-destination resource paths.");
        let paths: HashMap<String, String> = mapping.iter().map(|(source, target)| {
            (source.to_owned(), target.as_str().unwrap().to_owned())
        }).collect();
        let targets: Vec<PathBuf> = ResourcePaths::from_map(&paths, true).iter()
            .map(|resource| resource.unwrap().target().to_path_buf()).collect();
        for required in ["server/server.js", "server/lib/protocol.cjs", "ui/dist/index.html",
            "server/node_modules/koffi/build/koffi/win32_x64/koffi.node"] {
            assert!(targets.contains(&PathBuf::from(required)), "Missing release resource destination: {required}");
        }
    }
}
