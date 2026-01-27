use serde::Serialize;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use tauri::menu::{CheckMenuItemBuilder, MenuBuilder, MenuItemBuilder, SubmenuBuilder};
use tauri::{DragDropEvent, Emitter, State};

const BUNDLE_ID: &str = "com.mdview.viewer";
const MD_UTI: &str = "net.daringfireball.markdown";

const FONT_IDS: &[&str] = &[
    "font_system",
    "font_inter",
    "font_serif",
    "font_sans",
    "font_mono",
    "font_readable",
];

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

#[tauri::command]
fn find_project_root(file_path: String) -> Option<String> {
    let mut dir = PathBuf::from(&file_path);
    if dir.is_file() {
        dir.pop();
    }
    loop {
        if dir.join(".git").exists() {
            return Some(dir.to_string_lossy().to_string());
        }
        if !dir.pop() {
            break;
        }
    }
    None
}

#[tauri::command]
fn reveal_in_finder(file_path: String) -> Result<(), String> {
    std::process::Command::new("open")
        .arg("-R")
        .arg(&file_path)
        .status()
        .map_err(|e| format!("Failed to reveal in Finder: {}", e))?;
    Ok(())
}

/// Update the font checkmarks in the menu bar to match the given font_id.
#[tauri::command]
fn sync_font_menu(app_handle: tauri::AppHandle, font_id: String) {
    if let Some(menu) = app_handle.menu() {
        for id in FONT_IDS {
            if let Some(tauri::menu::MenuItemKind::Check(item)) = menu.get(*id) {
                let _ = item.set_checked(*id == font_id.as_str());
            }
        }
    }
}

/// Check if mdview is currently the default handler for .md files.
#[tauri::command]
fn is_md_associated() -> bool {
    let output = std::process::Command::new("swift")
        .arg("-e")
        .arg(format!(
            r#"import CoreServices; if let h = LSCopyDefaultRoleHandlerForContentType("{}" as CFString, .all) {{ print(h.takeRetainedValue()) }} else {{ print("none") }}"#,
            MD_UTI,
        ))
        .output();

    match output {
        Ok(o) => {
            let stdout = String::from_utf8_lossy(&o.stdout).trim().to_lowercase();
            stdout == BUNDLE_ID
        }
        Err(_) => false,
    }
}

/// Set or unset mdview as the default handler for .md files.
#[tauri::command]
fn set_md_association(enable: bool) -> Result<bool, String> {
    let target_bundle = if enable { BUNDLE_ID } else { "com.apple.TextEdit" };

    let script = format!(
        r#"import CoreServices; let r = LSSetDefaultRoleHandlerForContentType("{}" as CFString, .all, "{}" as CFString); print(r == 0 ? "ok" : "err")"#,
        MD_UTI, target_bundle,
    );

    let output = std::process::Command::new("swift")
        .arg("-e")
        .arg(&script)
        .output()
        .map_err(|e| format!("Failed to run swift: {}", e))?;

    let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
    if stdout == "ok" {
        Ok(enable)
    } else {
        Err(format!(
            "Failed to {} file association. You can change this in Finder: right-click a .md file → Get Info → Open With.",
            if enable { "set" } else { "remove" }
        ))
    }
}

fn install_cli(app_handle: &tauri::AppHandle) {
    let exe_path = match std::env::current_exe() {
        Ok(p) => p,
        Err(e) => {
            let _ = app_handle.emit("cli-install-result", format!("Failed to locate binary: {}", e));
            return;
        }
    };

    let target = PathBuf::from("/usr/local/bin/mdview");

    if target.is_symlink() {
        if let Ok(existing) = std::fs::read_link(&target) {
            if existing == exe_path {
                let _ = app_handle.emit("cli-install-result", "already-installed");
                return;
            }
        }
    }

    if target.exists() || target.is_symlink() {
        let _ = std::fs::remove_file(&target);
    }
    if std::os::unix::fs::symlink(&exe_path, &target).is_ok() {
        let _ = app_handle.emit("cli-install-result", "ok");
        return;
    }

    let script = format!(
        "do shell script \"ln -sf '{}' '{}'\" with administrator privileges",
        exe_path.display(),
        target.display()
    );

    let status = std::process::Command::new("osascript")
        .arg("-e")
        .arg(&script)
        .status();

    match status {
        Ok(s) if s.success() => {
            let _ = app_handle.emit("cli-install-result", "ok");
        }
        Ok(_) => {
            let _ = app_handle.emit("cli-install-result", "cancelled");
        }
        Err(e) => {
            let _ = app_handle.emit("cli-install-result", format!("Failed: {}", e));
        }
    }
}

fn set_font_checks(menu: &tauri::menu::Menu<tauri::Wry>, active_id: &str) {
    for id in FONT_IDS {
        if let Some(tauri::menu::MenuItemKind::Check(item)) = menu.get(*id) {
            let _ = item.set_checked(*id == active_id);
        }
    }
}

pub fn run() {
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
        .plugin(tauri_plugin_clipboard_manager::init())
        .manage(AppState {
            initial_file: Mutex::new(file_arg),
        })
        .invoke_handler(tauri::generate_handler![
            read_file,
            get_initial_file,
            find_project_root,
            reveal_in_finder,
            sync_font_menu,
            is_md_associated,
            set_md_association,
        ])
        .setup(|app| {
            // --- File menu ---
            let copy_file_path = MenuItemBuilder::with_id("copy_file_path", "Copy File Path")
                .accelerator("Cmd+Shift+C")
                .enabled(false)
                .build(app)?;
            let copy_dir_path = MenuItemBuilder::with_id("copy_dir_path", "Copy Containing Folder Path")
                .enabled(false)
                .build(app)?;
            let copy_project_path = MenuItemBuilder::with_id("copy_project_path", "Copy Project Path")
                .enabled(false)
                .build(app)?;
            let reveal_finder = MenuItemBuilder::with_id("reveal_finder", "Reveal in Finder")
                .accelerator("Cmd+Shift+R")
                .enabled(false)
                .build(app)?;

            let file_menu = SubmenuBuilder::new(app, "File")
                .item(&copy_file_path)
                .item(&copy_dir_path)
                .item(&copy_project_path)
                .separator()
                .item(&reveal_finder)
                .build()?;

            // --- View > Font menu ---
            let font_system = CheckMenuItemBuilder::with_id("font_system", "System Default")
                .checked(true)
                .build(app)?;
            let font_inter = CheckMenuItemBuilder::with_id("font_inter", "Inter")
                .checked(false)
                .build(app)?;
            let font_serif = CheckMenuItemBuilder::with_id("font_serif", "Serif")
                .checked(false)
                .build(app)?;
            let font_sans = CheckMenuItemBuilder::with_id("font_sans", "Sans-serif")
                .checked(false)
                .build(app)?;
            let font_mono = CheckMenuItemBuilder::with_id("font_mono", "Monospace")
                .checked(false)
                .build(app)?;
            let font_readable = CheckMenuItemBuilder::with_id("font_readable", "Readable")
                .checked(false)
                .build(app)?;

            let font_submenu = SubmenuBuilder::new(app, "Font")
                .item(&font_system)
                .item(&font_inter)
                .separator()
                .item(&font_serif)
                .item(&font_sans)
                .item(&font_mono)
                .item(&font_readable)
                .build()?;

            let view_menu = SubmenuBuilder::new(app, "View")
                .item(&font_submenu)
                .build()?;

            // --- Edit menu ---
            let edit_menu = SubmenuBuilder::new(app, "Edit")
                .undo()
                .redo()
                .separator()
                .cut()
                .copy()
                .paste()
                .select_all()
                .build()?;

            // --- Tools menu ---
            let install_cli_item = MenuItemBuilder::with_id("install_cli", "Install Command Line Tool…")
                .build(app)?;

            // Check initial association state
            let is_associated = is_md_associated();
            let associate_md_item = CheckMenuItemBuilder::with_id("associate_md", "Associate .md Files with mdview")
                .checked(is_associated)
                .build(app)?;

            let tools_menu = SubmenuBuilder::new(app, "Tools")
                .item(&install_cli_item)
                .item(&associate_md_item)
                .build()?;

            let menu = MenuBuilder::new(app)
                .item(&file_menu)
                .item(&edit_menu)
                .item(&view_menu)
                .item(&tools_menu)
                .build()?;

            app.set_menu(menu)?;

            app.on_menu_event(move |app_handle, event| {
                let id = event.id().0.as_str();

                match id {
                    "install_cli" => {
                        install_cli(app_handle);
                    }
                    "copy_file_path" | "copy_dir_path" | "copy_project_path" => {
                        let _ = app_handle.emit("menu-action", id);
                    }
                    "reveal_finder" => {
                        let _ = app_handle.emit("menu-action", "reveal_finder");
                    }
                    "associate_md" => {
                        // The check item auto-toggles, so read the new state
                        let now_checked = associate_md_item.is_checked().unwrap_or(false);
                        match set_md_association(now_checked) {
                            Ok(_) => {}
                            Err(msg) => {
                                // Revert the checkmark on failure
                                let _ = associate_md_item.set_checked(!now_checked);
                                let _ = app_handle.emit("show-error", msg);
                            }
                        }
                    }
                    _ if id.starts_with("font_") => {
                        if let Some(menu) = app_handle.menu() {
                            set_font_checks(&menu, id);
                        }
                        let _ = app_handle.emit("set-font", id);
                    }
                    _ => {}
                }
            });

            Ok(())
        })
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
