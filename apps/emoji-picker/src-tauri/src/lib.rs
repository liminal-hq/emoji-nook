// Wires Tauri commands and plugins for the desktop application runtime
//
// (c) Copyright 2026 Liminal HQ, Scott Morris
// SPDX-License-Identifier: Apache-2.0 OR MIT

mod injection;

use log::info;
use std::ffi::OsStr;
use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
use std::sync::Mutex;
use tauri::image::Image;
use tauri::menu::{MenuBuilder, MenuItemBuilder};
use tauri::tray::TrayIconBuilder;
use tauri::{AppHandle, Manager, RunEvent, WebviewUrl, WebviewWindow, WebviewWindowBuilder};
use tauri_plugin_desktop_integration::DesktopIntegrationExt;
use tauri_plugin_store::StoreExt;

fn has_wayland_display(value: Option<&OsStr>) -> bool {
    value.is_some()
}

const DEFAULT_SHORTCUT: &str = "Alt+Shift+E";

#[derive(Default)]
struct LifecycleState {
    quit_requested: AtomicBool,
    picker_counter: AtomicUsize,
    current_picker_label: Mutex<Option<String>>,
}

/// Reads the saved shortcut from the settings store, falling back to the default.
fn load_saved_shortcut(app: &AppHandle) -> String {
    match app.store("settings.json") {
        Ok(store) => store
            .get("shortcut")
            .and_then(|v| v.as_str().map(String::from))
            .unwrap_or_else(|| DEFAULT_SHORTCUT.to_string()),
        Err(e) => {
            info!("could not open settings store, using default shortcut: {e}");
            DEFAULT_SHORTCUT.to_string()
        }
    }
}

fn is_wayland() -> bool {
    has_wayland_display(std::env::var_os("WAYLAND_DISPLAY").as_deref())
}

fn set_current_picker_label(app: &AppHandle, label: Option<String>) {
    if let Ok(mut current_label) = app.state::<LifecycleState>().current_picker_label.lock() {
        *current_label = label;
    }
}

fn current_picker_label(app: &AppHandle) -> Option<String> {
    app.state::<LifecycleState>()
        .current_picker_label
        .lock()
        .ok()
        .and_then(|label| label.clone())
}

fn load_app_icon() -> tauri::Result<Image<'static>> {
    Image::from_bytes(include_bytes!("../icons/icon.png"))
}

fn close_picker_window(app: &AppHandle) {
    if let Some(label) = current_picker_label(app) {
        if let Some(window) = app.get_webview_window(&label) {
            let _ = window.close();
        }
    }
    set_current_picker_label(app, None);
}

fn create_picker_window(app: &AppHandle, label: &str, view: &str) -> tauri::Result<WebviewWindow> {
    let url = if view.is_empty() {
        "index.html".to_string()
    } else {
        format!("index.html?view={view}")
    };

    let mut builder = WebviewWindowBuilder::new(app, label, WebviewUrl::App(url.into()))
        .title("Emoji Nook")
        .inner_size(370.0, 380.0)
        .resizable(false)
        .decorations(false)
        .transparent(true)
        .always_on_top(true)
        .skip_taskbar(true)
        .center();

    builder = builder.icon(load_app_icon()?)?;

    builder.build()
}

fn log_picker_focus_state(app: &AppHandle, source: &'static str, label: String, delay_ms: u64) {
    let handle = app.clone();

    std::thread::spawn(move || {
        std::thread::sleep(std::time::Duration::from_millis(delay_ms));

        if let Some(window) = handle.get_webview_window(&label) {
            let visible = window.is_visible().unwrap_or(false);
            let focused = window.is_focused().unwrap_or(false);
            info!(
                "picker focus probe ({source}) label={label} delay={}ms visible={} focused={}",
                delay_ms, visible, focused
            );
        } else {
            info!(
                "picker focus probe ({source}) label={label} delay={}ms window-missing",
                delay_ms
            );
        }
    });
}

fn present_picker(app: &AppHandle, source: &'static str) {
    info!("presenting picker from {source}");
    close_picker_window(app);
    let picker_id = app
        .state::<LifecycleState>()
        .picker_counter
        .fetch_add(1, Ordering::SeqCst);
    let label = format!("picker-{picker_id}");

    // On Wayland, show the shortcut-setup view until the portal binding completes.
    let view = if is_wayland() && !app.is_shortcut_binding_complete() {
        "shortcut-setup"
    } else {
        ""
    };

    match create_picker_window(app, &label, view) {
        Ok(window) => {
            info!("created picker window label={label} view={view:?} from {source}");
            set_current_picker_label(app, Some(label.clone()));
            let _ = window.center();
            let _ = window.show();
            let _ = window.set_focus();

            // Trigger deferred Wayland portal BindShortcuts on first show.
            // No-op on X11 or if already called.
            app.set_shortcut_window(&window);

            if !is_wayland() {
                app.request_desktop_activation_assist(&window, source, &label);
            }
            log_picker_focus_state(app, source, label.clone(), 75);
            log_picker_focus_state(app, source, label, 225);
        }
        Err(error) => {
            log::error!("failed to create picker window from {source}: {error}");
        }
    }
}

/// Receives a selected emoji from the frontend, hides the picker,
/// and injects the emoji into the previously focused application.
#[tauri::command]
fn insert_emoji(app: AppHandle, emoji: String, label: &str, close_on_select: bool) {
    info!("emoji selected: {} ({})", emoji, label);

    close_picker_window(&app);

    let reopen_handle = app.clone();
    std::thread::spawn(move || {
        injection::clipboard_shuffle(&emoji);
        if !close_on_select {
            present_picker(&reopen_handle, "post-select-reopen");
        }
    });
}

/// Shows the picker window, centres it, and emits an event so the frontend
/// can reset its state (clear search, focus input, scroll to top).
#[tauri::command]
fn show_picker(app: AppHandle) {
    present_picker(&app, "command");
}

/// Hides the picker window.
#[tauri::command]
fn hide_picker(app: AppHandle) {
    close_picker_window(&app);
}

/// Re-registers the global shortcut with a new binding.
#[tauri::command]
fn update_shortcut(app: AppHandle, shortcut: String) {
    info!("updating global shortcut to: {shortcut}");
    let handle = app.clone();
    app.update_shortcut(&shortcut, move || {
        present_picker(&handle, "shortcut");
    });
}

/// Creates the system tray icon with a context menu.
fn setup_tray(app: &AppHandle) -> Result<(), Box<dyn std::error::Error>> {
    let show = MenuItemBuilder::with_id("show", "Show Picker").build(app)?;
    let quit = MenuItemBuilder::with_id("quit", "Quit").build(app)?;
    let menu = MenuBuilder::new(app).items(&[&show, &quit]).build()?;

    let _tray = TrayIconBuilder::new()
        .icon(load_app_icon()?)
        .tooltip("Emoji Nook")
        .menu(&menu)
        .on_menu_event(move |app, event| match event.id().as_ref() {
            "show" => {
                present_picker(app, "tray");
            }
            "quit" => {
                app.state::<LifecycleState>()
                    .quit_requested
                    .store(true, Ordering::SeqCst);
                app.exit(0);
            }
            _ => {}
        })
        .build(app)?;

    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let app = tauri::Builder::default()
        .manage(LifecycleState::default())
        .plugin(tauri_plugin_desktop_integration::init())
        .plugin(
            tauri_plugin_log::Builder::new()
                .level(if cfg!(debug_assertions) {
                    log::LevelFilter::Debug
                } else {
                    log::LevelFilter::Info
                })
                .level_for("tao", log::LevelFilter::Warn)
                .build(),
        )
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_store::Builder::new().build())
        .plugin(tauri_plugin_xdg_portal::init())
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .plugin(tauri_plugin_autostart::init(
            tauri_plugin_autostart::MacosLauncher::LaunchAgent,
            None,
        ))
        .invoke_handler(tauri::generate_handler![
            insert_emoji,
            show_picker,
            hide_picker,
            update_shortcut
        ])
        .setup(|app| {
            let handle = app.handle().clone();

            setup_tray(&handle)?;

            let shortcut = load_saved_shortcut(&handle);
            info!("using shortcut from settings: {shortcut}");

            let handle_for_shortcut = handle.clone();
            handle.register_shortcut(&shortcut, move || {
                present_picker(&handle_for_shortcut, "shortcut");
            });

            // On Wayland the portal BindShortcuts call is deferred until the first
            // picker window is shown (so the dialog has a parent). Auto-show the
            // shortcut-setup window at startup to kick off that binding — otherwise
            // the user has no way to trigger it until the tray works.
            if is_wayland() && !handle.is_shortcut_binding_complete() {
                let h = handle.clone();
                std::thread::spawn(move || {
                    std::thread::sleep(std::time::Duration::from_millis(300));
                    present_picker(&h, "startup-wayland-bind");
                });
            }

            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("error while building tauri application");

    app.run(|app_handle, event| {
        if let RunEvent::ExitRequested { api, .. } = event {
            let quit_requested = app_handle
                .state::<LifecycleState>()
                .quit_requested
                .load(Ordering::SeqCst);

            if !quit_requested {
                api.prevent_exit();
            }
        }
    });
}

#[cfg(test)]
mod tests {
    use super::has_wayland_display;
    use std::ffi::OsStr;

    #[test]
    fn wayland_detection_requires_the_display_variable() {
        assert!(has_wayland_display(Some(OsStr::new("wayland-0"))));
        assert!(!has_wayland_display(None));
    }
}
