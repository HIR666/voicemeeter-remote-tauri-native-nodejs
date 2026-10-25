#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::{
    fs,
    io::{Read, Write},
    net::{SocketAddr, TcpStream},
    path::PathBuf,
    sync::{atomic::{AtomicBool, Ordering}, Mutex},
    time::Duration,
};

use tauri::{
    menu::{CheckMenuItem, Menu, MenuItem, PredefinedMenuItem},
    tray::{TrayIconBuilder, TrayIconEvent},
    Manager, WebviewUrl, WebviewWindowBuilder, WindowEvent,
};
use tauri_plugin_autostart::ManagerExt as AutostartManagerExt;
use tauri_plugin_opener::OpenerExt;
use tauri_plugin_shell::{process::CommandChild, ShellExt};

struct BackendState {
    child: Mutex<Option<CommandChild>>,
    quitting: AtomicBool,
}

fn config_dir(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let path = app.path().app_data_dir().map_err(|error| error.to_string())?;
    fs::create_dir_all(&path).map_err(|error| error.to_string())?;
    Ok(path)
}

fn backend_port(app: &tauri::AppHandle) -> u16 {
    let path = match config_dir(app) { Ok(path) => path.join("settings.json"), Err(_) => return 5164 };
    fs::read_to_string(path)
        .ok()
        .and_then(|contents| serde_json::from_str::<serde_json::Value>(&contents).ok())
        .and_then(|json| json.get("port")?.as_u64())
        .and_then(|port| u16::try_from(port).ok())
        .filter(|port| *port > 0)
        .unwrap_or(5164)
}

fn wait_for_backend(port: u16) -> bool {
    let address: SocketAddr = format!("127.0.0.1:{port}").parse().expect("valid loopback address");
    for _ in 0..30 {
        if TcpStream::connect_timeout(&address, Duration::from_millis(100)).is_ok() { return true; }
        std::thread::sleep(Duration::from_millis(100));
    }
    false
}

fn start_backend(app: &tauri::AppHandle) -> Result<(), String> {
    let state = app.state::<BackendState>();
    if state.child.lock().map_err(|_| "Backend lock was poisoned.")?.is_some() { return Ok(()); }

    let data_dir = config_dir(app)?;
    let port = backend_port(app);
    let mut command = if cfg!(debug_assertions) {
        let root = PathBuf::from(env!("CARGO_MANIFEST_DIR")).parent().unwrap().to_path_buf();
        app.shell().command("node").args([root.join("server/server.js").to_string_lossy().to_string()])
    } else {
        let resources = app.path().resource_dir().map_err(|error| error.to_string())?;
        app.shell().sidecar("vmr-node")
            .map_err(|error| error.to_string())?
            .args([resources.join("server/server.js").to_string_lossy().to_string()])
    };

    let resource_dir = if cfg!(debug_assertions) {
        PathBuf::from(env!("CARGO_MANIFEST_DIR")).parent().unwrap().to_path_buf()
    } else {
        app.path().resource_dir().map_err(|error| error.to_string())?
    };
    command = command.args([
        "--config-dir".into(), data_dir.to_string_lossy().to_string(),
        "--resource-dir".into(), resource_dir.to_string_lossy().to_string(),
    ]);
    let (mut receiver, child) = command.spawn().map_err(|error| format!("Could not launch the managed backend: {error}"))?;
    *state.child.lock().map_err(|_| "Backend lock was poisoned.")? = Some(child);
    tauri::async_runtime::spawn(async move { while receiver.recv().await.is_some() {} });
    if wait_for_backend(port) { Ok(()) } else { Err(format!("Backend did not become ready on port {port}. See server.log in the app data folder.")) }
}

fn stop_backend(app: &tauri::AppHandle) {
    if let Ok(mut guard) = app.state::<BackendState>().child.lock() {
        if let Some(child) = guard.take() { let _ = child.kill(); }
    }
}

fn restart_backend(app: &tauri::AppHandle) -> Result<(), String> {
    stop_backend(app);
    std::thread::sleep(Duration::from_millis(250));
    start_backend(app)
}

fn request_audio_restart(app: &tauri::AppHandle) -> Result<(), String> {
    let address = format!("127.0.0.1:{}", backend_port(app));
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
    let url = format!("http://127.0.0.1:{}", backend_port(app));
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

fn open_web_ui(app: &tauri::AppHandle) {
    let _ = app.opener().open_url(format!("http://127.0.0.1:{}", backend_port(app)), None::<&str>);
}

fn tray(app: &tauri::AppHandle) -> tauri::Result<()> {
    let open = MenuItem::with_id(app, "open", "Open Remote", true, None::<&str>)?;
    let web = MenuItem::with_id(app, "web", "Open Web UI", true, None::<&str>)?;
    let restart_audio = MenuItem::with_id(app, "restart-audio", "Restart Audio Engine", true, None::<&str>)?;
    let restart_server = MenuItem::with_id(app, "restart-server", "Restart Server", true, None::<&str>)?;
    let enabled = app.autolaunch().is_enabled().unwrap_or(false);
    let autostart = CheckMenuItem::with_id(app, "autostart", "Start with Windows", true, enabled, None::<&str>)?;
    let quit = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&open, &web, &PredefinedMenuItem::separator(app)?, &restart_audio, &restart_server, &PredefinedMenuItem::separator(app)?, &autostart, &PredefinedMenuItem::separator(app)?, &quit])?;

    TrayIconBuilder::with_id("tray")
        .icon(app.default_window_icon().expect("application icon").clone())
        .tooltip("Voicemeeter Remote")
        .menu(&menu)
        .on_menu_event(move |app, event| match event.id().as_ref() {
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
        .plugin(tauri_plugin_autostart::init(tauri_plugin_autostart::MacosLauncher::LaunchAgent, None))
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_single_instance::init(|app, _argv, _cwd| {
            let _ = show_remote(app);
        }))
        .setup(|app| {
            let handle = app.handle().clone();
            if let Err(error) = start_backend(&handle) { eprintln!("[VMR] {error}"); }
            tray(&handle)?;
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running Voicemeeter Remote");
}
