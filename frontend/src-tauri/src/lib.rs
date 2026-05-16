use std::net::TcpListener;
use std::sync::{Arc, Mutex};
use tauri::{AppHandle, Manager, State};

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
        .invoke_handler(tauri::generate_handler![get_backend_port])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

fn spawn_backend(app: &AppHandle, port: u16) {
    use tauri_plugin_shell::ShellExt;

    let root = locate_project_root(app);
    let python = format!("{}/backend/.venv/bin/python", root);
    let log_path = format!("{}/logs/backend.log", root);

    // Ensure logs directory exists
    let _ = std::fs::create_dir_all(format!("{}/logs", root));

    log::info!("Spawning backend on port {} (python: {})", port, python);
    log::info!("Backend logs -> {}", log_path);

    let result = app.shell()
        .command(&python)
        .args(["-m", "uvicorn", "backend.main:app", "--host", "127.0.0.1", "--port", &port.to_string()])
        .env("PYTHONPATH", &root)
        .env("LOGURU_SINK", &log_path)
        .spawn();

    match result {
        Ok((mut rx, child)) => {
            let child_arc = get_child_arc(app);
            let mut guard = child_arc.lock().unwrap();
            *guard = Some(child);
            log::info!("Backend spawned successfully");

            // Forward backend stdout/stderr to log file via Tauri's event stream
            let log_path_clone = log_path.clone();
            tauri::async_runtime::spawn(async move {
                use tauri_plugin_shell::process::CommandEvent;
                use std::io::Write;

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
                        CommandEvent::Terminated(_) => {
                            log::info!("Backend process terminated");
                            break;
                        }
                        _ => {}
                    }
                }
            });
        }
        Err(e) => log::error!("Failed to spawn backend: {}", e),
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

fn locate_project_root(app: &AppHandle) -> String {
    if cfg!(debug_assertions) {
        std::env::current_exe()
            .ok()
            .and_then(|p| p.ancestors().nth(5).map(|a| a.to_string_lossy().into_owned()))
            .unwrap_or_else(|| "/mnt/projects/echohub".to_string())
    } else {
        app.path().resource_dir()
            .map(|p| p.to_string_lossy().into_owned())
            .unwrap_or_else(|_| "/mnt/projects/echohub".to_string())
    }
}
