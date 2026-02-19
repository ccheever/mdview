use serde::Serialize;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use tauri::menu::{
    CheckMenuItem, CheckMenuItemBuilder, MenuBuilder, MenuItemBuilder, SubmenuBuilder,
};
use tauri::{DragDropEvent, Emitter, Manager, State, Wry};

// NOTE: must match the bundle identifier of the built app.
// Using a hard-coded value tends to fail in dev builds where the bundle id
// differs, causing LSSetDefaultRoleHandlerForContentType to return an error.
const FALLBACK_BUNDLE_ID: &str = "com.mdview.viewer";
const MD_UTI: &str = "net.daringfireball.markdown";

#[derive(Serialize)]
pub struct FileResult {
    content: String,
    path: String,
    dir: String,
}

struct AppState {
    initial_file: Mutex<Option<String>>,
    font_items: Mutex<Vec<CheckMenuItem<Wry>>>,
}

struct FileMenuItems {
    copy_file_path: tauri::menu::MenuItem<Wry>,
    copy_dir_path: tauri::menu::MenuItem<Wry>,
    copy_project_path: tauri::menu::MenuItem<Wry>,
    reveal_finder: tauri::menu::MenuItem<Wry>,
    export_pdf_item: tauri::menu::MenuItem<Wry>,
}

#[tauri::command]
fn export_pdf() -> Result<(), String> {
    Err(
        "Programmatic 'Export as PDF' without showing the print dialog isn't supported by Tauri/Wry on macOS yet.\n\nCurrent options:\n- Keep the print dialog (window.print()) and use Save as PDF\n- Implement a custom HTML->PDF export (e.g. render to PDF via a Rust PDF library, or generate PDF in JS and save via the filesystem plugin)"
            .to_string(),
    )
}

#[tauri::command]
fn set_file_menu_enabled(enabled: bool, items: State<FileMenuItems>) {
    let _ = items.copy_file_path.set_enabled(enabled);
    let _ = items.copy_dir_path.set_enabled(enabled);
    let _ = items.copy_project_path.set_enabled(enabled);
    let _ = items.reveal_finder.set_enabled(enabled);
    let _ = items.export_pdf_item.set_enabled(enabled);
}

fn set_font_checked(font_items: &[CheckMenuItem<Wry>], active_id: &str) {
    for item in font_items {
        let _ = item.set_checked(item.id().0.as_str() == active_id);
    }
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

    let canonical = resolved
        .canonicalize()
        .map_err(|e| format!("Cannot resolve path '{}': {}", path, e))?;

    let content = std::fs::read_to_string(&canonical)
        .map_err(|e| format!("Cannot read file '{}': {}", canonical.display(), e))?;

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
fn sync_font_menu(state: State<AppState>, font_id: String) {
    let items = state.font_items.lock().unwrap();
    set_font_checked(&items, &font_id);
}

fn current_bundle_id() -> Option<String> {
    // Use Info.plist value so dev/prod bundle ids both work.
    std::env::var("TAURI_BUNDLE_IDENTIFIER").ok().or_else(|| {
        std::env::current_exe().ok().and_then(|exe| {
            // <App>.app/Contents/MacOS/<binary>
            let info_plist = exe.parent()?.parent()?.join("Info.plist");
            let output = std::process::Command::new("/usr/bin/defaults")
                .arg("read")
                .arg(info_plist)
                .arg("CFBundleIdentifier")
                .output()
                .ok()?;

            if !output.status.success() {
                return None;
            }
            let s = String::from_utf8_lossy(&output.stdout).trim().to_string();
            if s.is_empty() {
                None
            } else {
                Some(s)
            }
        })
    })
}

/// Check if mdview is currently the default handler for .md files.
#[tauri::command]
fn is_md_associated() -> bool {
    let bundle_id = current_bundle_id().unwrap_or_else(|| FALLBACK_BUNDLE_ID.to_string());
    let output = std::process::Command::new("swift")
        .arg("-e")
        .arg(format!(
            r#"import CoreServices; import Foundation; if let h = LSCopyDefaultRoleHandlerForContentType("{}" as NSString as CFString, .all) {{ print(h.takeRetainedValue()) }} else {{ print("none") }}"#,
            MD_UTI,
        ))
        .output();

    match output {
        Ok(o) => {
            let stdout = String::from_utf8_lossy(&o.stdout).trim().to_lowercase();
            stdout == bundle_id.to_lowercase()
        }
        Err(_) => false,
    }
}

/// Set or unset mdview as the default handler for .md files.
#[tauri::command]
fn set_md_association(enable: bool) -> Result<bool, String> {
    let self_bundle = current_bundle_id().unwrap_or_else(|| FALLBACK_BUNDLE_ID.to_string());
    let target_bundle = if enable {
        self_bundle.as_str()
    } else {
        "com.apple.TextEdit"
    };

    let script = format!(
        r#"import CoreServices; import Foundation; let r = LSSetDefaultRoleHandlerForContentType("{}" as NSString as CFString, .all, "{}" as NSString as CFString); print(r == 0 ? "ok" : "err")"#,
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
        let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
        Err(format!(
            "Failed to {} file association. {}\n\nTry: ensure you are running the .app bundle (not `cargo tauri dev`) and that the app is in /Applications.\nYou can always change this in Finder: right-click a .md file → Get Info → Open With.",
            if enable { "set" } else { "remove" },
            stderr,
        ))
    }
}

fn install_cli(app_handle: &tauri::AppHandle) {
    let exe_path = match std::env::current_exe() {
        Ok(p) => p,
        Err(e) => {
            let _ = app_handle.emit(
                "cli-install-result",
                format!("Failed to locate binary: {}", e),
            );
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
            font_items: Mutex::new(Vec::new()),
        })
        .invoke_handler(tauri::generate_handler![
            read_file,
            get_initial_file,
            find_project_root,
            reveal_in_finder,
            sync_font_menu,
            export_pdf,
            set_file_menu_enabled,
            is_md_associated,
            set_md_association,
        ])
        .setup(|app| {
            // --- File menu ---
            let copy_file_path = MenuItemBuilder::with_id("copy_file_path", "Copy File Path")
                .accelerator("Cmd+Shift+C")
                .enabled(false)
                .build(app)?;
            let copy_dir_path =
                MenuItemBuilder::with_id("copy_dir_path", "Copy Containing Folder Path")
                    .enabled(false)
                    .build(app)?;
            let copy_project_path =
                MenuItemBuilder::with_id("copy_project_path", "Copy Project Path")
                    .enabled(false)
                    .build(app)?;
            let reveal_finder = MenuItemBuilder::with_id("reveal_finder", "Reveal in Finder")
                .accelerator("Cmd+Shift+R")
                .enabled(false)
                .build(app)?;

            let export_pdf_item = MenuItemBuilder::with_id("export_pdf", "Export as PDF…")
                .accelerator("Cmd+P")
                .enabled(false)
                .build(app)?;

            app.manage(FileMenuItems {
                copy_file_path: copy_file_path.clone(),
                copy_dir_path: copy_dir_path.clone(),
                copy_project_path: copy_project_path.clone(),
                reveal_finder: reveal_finder.clone(),
                export_pdf_item: export_pdf_item.clone(),
            });

            let file_menu = SubmenuBuilder::new(app, "File")
                .item(&copy_file_path)
                .item(&copy_dir_path)
                .item(&copy_project_path)
                .separator()
                .item(&reveal_finder)
                .separator()
                .item(&export_pdf_item)
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

            // Store font items in AppState so sync_font_menu command can access them
            {
                let app_state = app.state::<AppState>();
                let mut items = app_state.font_items.lock().unwrap();
                items.push(font_system.clone());
                items.push(font_inter.clone());
                items.push(font_serif.clone());
                items.push(font_sans.clone());
                items.push(font_mono.clone());
                items.push(font_readable.clone());
            }

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
            let install_cli_item =
                MenuItemBuilder::with_id("install_cli", "Install Command Line Tool…").build(app)?;

            let is_associated = is_md_associated();
            let associate_md_item =
                CheckMenuItemBuilder::with_id("associate_md", "Associate .md Files with mdview")
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

            // Clone font items for the menu event closure
            let font_items_for_closure: Vec<CheckMenuItem<Wry>> = vec![
                font_system,
                font_inter,
                font_serif,
                font_sans,
                font_mono,
                font_readable,
            ];

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
                    "export_pdf" => {
                        if let Some(w) = app_handle.get_webview_window("main") {
                            if let Err(msg) = export_pdf() {
                                let _ = app_handle.emit("show-error", msg);
                            } else {
                                let _ = w.eval("window.print()");
                            }
                        }
                    }
                    "associate_md" => {
                        let now_checked = associate_md_item.is_checked().unwrap_or(false);
                        match set_md_association(now_checked) {
                            Ok(_) => {}
                            Err(msg) => {
                                let _ = associate_md_item.set_checked(!now_checked);
                                let _ = app_handle.emit("show-error", msg);
                            }
                        }
                    }
                    _ if id.starts_with("font_") => {
                        set_font_checked(&font_items_for_closure, id);
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
