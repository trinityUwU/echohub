use std::net::TcpListener;
use std::sync::{Arc, Mutex};
use tauri::{AppHandle, Manager, State};
use base64::Engine;

pub struct BackendState {
    pub port: u16,
    pub child: Arc<Mutex<Option<tauri_plugin_shell::process::CommandChild>>>,
}

fn find_free_port() -> u16 {
    TcpListener::bind("127.0.0.1:37821")
        .map(|l| l.local_addr().unwrap().port())
        .unwrap_or_else(|_| {
            TcpListener::bind("127.0.0.1:0")
                .map(|l| l.local_addr().unwrap().port())
                .expect("no free port")
        })
}

#[tauri::command]
fn get_backend_port(state: State<BackendState>) -> u16 {
    state.port
}

/// Read an image from the system clipboard.
/// On Wayland: uses wl-paste (wl-clipboard). On X11: uses xclip/xsel via arboard.
/// Returns a data URL (data:image/png;base64,...) or null.
#[tauri::command]
fn read_clipboard_image() -> Option<String> {
    // Try Wayland first (wl-paste)
    if std::env::var("WAYLAND_DISPLAY").is_ok() {
        return read_clipboard_image_wayland();
    }
    // Fallback: arboard for X11 / other platforms
    read_clipboard_image_arboard()
}

fn read_clipboard_image_wayland() -> Option<String> {
    use std::process::Command;

    // Check available image types
    let types_out = Command::new("wl-paste")
        .args(["--list-types"])
        .output()
        .ok()?;
    let types = String::from_utf8_lossy(&types_out.stdout);
    let mime = types.lines()
        .find(|l| l.starts_with("image/png") || l.starts_with("image/"))
        .map(|l| l.trim().to_string())?;

    // Read raw image bytes
    let out = Command::new("wl-paste")
        .args(["--no-newline", "--type", &mime])
        .output()
        .ok()?;

    if out.stdout.is_empty() {
        return None;
    }

    // If PNG, encode directly; otherwise convert via image crate
    let png_bytes = if mime == "image/png" {
        out.stdout
    } else {
        let img = image::load_from_memory(&out.stdout).ok()?;
        let mut buf = Vec::new();
        img.write_to(&mut std::io::Cursor::new(&mut buf), image::ImageFormat::Png).ok()?;
        buf
    };

    let b64 = base64::engine::general_purpose::STANDARD.encode(&png_bytes);
    Some(format!("data:image/png;base64,{}", b64))
}

fn read_clipboard_image_arboard() -> Option<String> {
    let mut ctx = arboard::Clipboard::new().ok()?;
    let img = ctx.get_image().ok()?;
    let rgba = image::RgbaImage::from_raw(
        img.width as u32,
        img.height as u32,
        img.bytes.into_owned(),
    )?;
    let mut png_bytes: Vec<u8> = Vec::new();
    image::DynamicImage::ImageRgba8(rgba)
        .write_to(&mut std::io::Cursor::new(&mut png_bytes), image::ImageFormat::Png)
        .ok()?;
    let b64 = base64::engine::general_purpose::STANDARD.encode(&png_bytes);
    Some(format!("data:image/png;base64,{}", b64))
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let port = find_free_port();

    tauri::Builder::default()
        .plugin(tauri_plugin_log::Builder::default().level(log::LevelFilter::Info).build())
        .plugin(tauri_plugin_shell::init())
        .manage(BackendState {
            port,
            child: Arc::new(Mutex::new(None)),
        })
        .setup(move |app| {
            spawn_backend(app.handle(), port);
            Ok(())
        })
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::Destroyed = event {
                kill_backend(window.app_handle());
            }
        })
        .invoke_handler(tauri::generate_handler![get_backend_port, read_clipboard_image])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

fn spawn_backend(app: &AppHandle, port: u16) {
    spawn_backend_with_retries(app, port, 0);
}

fn spawn_backend_with_retries(app: &AppHandle, port: u16, attempt: u32) {
    use tauri_plugin_shell::ShellExt;

    let root = locate_project_root(app);
    let python = format!("{}/backend/.venv/bin/python", root);
    let log_path = format!("{}/logs/backend.log", root);

    let _ = std::fs::create_dir_all(format!("{}/logs", root));

    log::info!("Spawning backend on port {} (attempt {}) (python: {})", port, attempt + 1, python);

    let result = app.shell()
        .command(&python)
        .args(["-m", "uvicorn", "backend.main:app", "--host", "127.0.0.1", "--port", &port.to_string()])
        .env("PYTHONPATH", &root)
        .env("LOGURU_SINK", &log_path)
        .spawn();

    match result {
        Ok((mut rx, child)) => {
            let child_arc = get_child_arc(app);
            *child_arc.lock().unwrap() = Some(child);
            log::info!("Backend spawned successfully");

            let log_path_clone = log_path.clone();
            let app_handle = app.clone();
            tauri::async_runtime::spawn(async move {
                use tauri_plugin_shell::process::CommandEvent;
                use std::io::Write;
                use tokio::time::{sleep, Duration};

                let file = std::fs::OpenOptions::new()
                    .create(true).append(true).open(&log_path_clone);

                while let Some(event) = rx.recv().await {
                    match event {
                        CommandEvent::Stdout(line) | CommandEvent::Stderr(line) => {
                            if let Ok(mut f) = file.as_ref() {
                                let _ = f.write_all(&line);
                                let _ = f.write_all(b"\n");
                            }
                        }
                        CommandEvent::Terminated(status) => {
                            log::warn!("Backend terminated (status: {:?}) — restarting in 2s (attempt {})", status, attempt + 1);
                            sleep(Duration::from_secs(2)).await;
                            spawn_backend_with_retries(&app_handle, port, attempt + 1);
                            break;
                        }
                        _ => {}
                    }
                }
            });
        }
        Err(e) => {
            log::error!("Failed to spawn backend (attempt {}): {}", attempt + 1, e);
            // Retry after 3s if spawn itself failed
            let app_handle = app.clone();
            tauri::async_runtime::spawn(async move {
                tokio::time::sleep(tokio::time::Duration::from_secs(3)).await;
                spawn_backend_with_retries(&app_handle, port, attempt + 1);
            });
        }
    }
}

fn kill_backend(app: &AppHandle) {
    let child_arc = get_child_arc(app);
    let child = {
        let mut guard = child_arc.lock().unwrap();
        guard.take()
    };
    if let Some(c) = child {
        let _ = c.kill();
        log::info!("Backend killed");
    }
}

fn get_child_arc(app: &AppHandle) -> Arc<Mutex<Option<tauri_plugin_shell::process::CommandChild>>> {
    let state: State<BackendState> = app.state();
    Arc::clone(&state.child)
}

fn locate_project_root(_app: &AppHandle) -> String {
    // Binary is at <root>/frontend/src-tauri/target/{profile}/app — nth(5) = project root
    std::env::current_exe()
        .ok()
        .and_then(|p| p.ancestors().nth(5).map(|a| a.to_string_lossy().into_owned()))
        .unwrap_or_else(|| std::env::current_dir()
            .map(|p| p.to_string_lossy().into_owned())
            .unwrap_or_else(|_| ".".to_string()))
}
