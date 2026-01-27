use serde::Serialize;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use tauri::{DragDropEvent, Emitter, State};

#[derive(Serialize)]
pub struct FileResult {
    content: String,
    path: String,
    dir: String,
}

struct AppState {
    initial_file: Mutex<Option<String>>,
}

#[tauri::command]
fn read_file(path: String) -> Result<FileResult, String> {
    let resolved = if Path::new(&path).is_absolute() {
        PathBuf::from(&path)
    } else {
        std::env::current_dir()
            .map_err(|e| e.to_string())?
            .join(&path)
    };

    let canonical = resolved.canonicalize().map_err(|e| {
        format!("Cannot resolve path '{}': {}", path, e)
    })?;

    let content = std::fs::read_to_string(&canonical).map_err(|e| {
        format!("Cannot read file '{}': {}", canonical.display(), e)
    })?;

    let dir = canonical
        .parent()
        .map(|p| p.to_string_lossy().to_string())
        .unwrap_or_default();

    Ok(FileResult {
        content,
        path: canonical.to_string_lossy().to_string(),
        dir,
    })
}

#[tauri::command]
fn get_initial_file(state: State<AppState>) -> Option<String> {
    state.initial_file.lock().unwrap().take()
}

pub fn run() {
    // Grab the first CLI argument (file path) before Tauri consumes args
    let file_arg = std::env::args().nth(1).and_then(|arg| {
        if arg.starts_with('-') {
            None
        } else {
            Some(arg)
        }
    });

    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_opener::init())
        .manage(AppState {
            initial_file: Mutex::new(file_arg),
        })
        .invoke_handler(tauri::generate_handler![read_file, get_initial_file])
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::DragDrop(DragDropEvent::Drop { paths, .. }) = event {
                if let Some(path) = paths.first() {
                    let path_str = path.to_string_lossy().to_string();
                    let _ = window.emit("open-file", path_str);
                }
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
