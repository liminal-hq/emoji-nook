// Wires Tauri commands and plugins for the desktop application runtime
//
// (c) Copyright 2026 Liminal HQ, Scott Morris
// SPDX-License-Identifier: Apache-2.0 OR MIT

mod injection;

use log::info;
use tauri::menu::{MenuBuilder, MenuItemBuilder};
use tauri::tray::TrayIconBuilder;
use tauri::{AppHandle, Emitter, Manager};

/// Returns true when running under a Wayland compositor.
fn is_wayland() -> bool {
    std::env::var("WAYLAND_DISPLAY").is_ok()
}

/// Receives a selected emoji from the frontend, hides the picker,
/// and injects the emoji into the previously focused application.
#[tauri::command]
fn insert_emoji(app: AppHandle, emoji: String, label: &str) {
    info!("emoji selected: {} ({})", emoji, label);

    // Hide the picker first so focus returns to the target app
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.hide();
    }

    // Inject on a background thread to avoid blocking the IPC handler
    // during the sleep-based clipboard shuffle
    std::thread::spawn(move || {
        injection::clipboard_shuffle(&emoji);
    });
}

/// Shows the picker window, centres it, and emits an event so the frontend
/// can reset its state (clear search, focus input, scroll to top).
#[tauri::command]
fn show_picker(app: AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.center();
        let _ = window.show();
        let _ = window.set_focus();
        let _ = app.emit("picker-shown", ());
    }
}

/// Hides the picker window.
#[tauri::command]
fn hide_picker(app: AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.hide();
    }
}

/// Register the global shortcut via the Wayland GlobalShortcuts portal.
/// The shortcut session lives as long as the returned handle.
fn register_wayland_shortcut(app: AppHandle) {
    info!("registering global shortcut via Wayland portal");
    let handle = app.clone();
    tauri::async_runtime::spawn(async move {
        match tauri_plugin_xdg_portal::global_shortcuts::listen_for_shortcut(
            "emoji-nook-toggle",
            "Toggle Emoji Nook",
            Some("Alt+Shift+E"),
            move || {
                if let Some(window) = handle.get_webview_window("main") {
                    if window.is_visible().unwrap_or(false) {
                        let _ = window.hide();
                    } else {
                        let _ = window.center();
                        let _ = window.show();
                        let _ = window.set_focus();
                        let _ = handle.emit("picker-shown", ());
                    }
                }
            },
        )
        .await
        {
            Ok(shortcut_handle) => {
                info!("wayland global shortcut registered");
                // Leak the handle to keep the session alive for the lifetime of the app.
                // It will be cleaned up when the process exits.
                std::mem::forget(shortcut_handle);
            }
            Err(e) => {
                log::error!("failed to register Wayland global shortcut: {e}");
                log::error!("the picker will not respond to keyboard shortcuts");
            }
        }
    });
}

/// Register the global shortcut via tauri-plugin-global-shortcut (X11 path).
fn register_x11_shortcut(app: &AppHandle) {
    use tauri_plugin_global_shortcut::GlobalShortcutExt;

    info!("registering global shortcut via X11 (tauri-plugin-global-shortcut)");
    let handle = app.clone();
    let result = app.global_shortcut().on_shortcut("alt+shift+e", move |_app, _shortcut, event| {
        if event.state == tauri_plugin_global_shortcut::ShortcutState::Pressed {
            if let Some(window) = handle.get_webview_window("main") {
                if window.is_visible().unwrap_or(false) {
                    let _ = window.hide();
                } else {
                    let _ = window.center();
                    let _ = window.show();
                    let _ = window.set_focus();
                    let _ = handle.emit("picker-shown", ());
                }
            }
        }
    });

    match result {
        Ok(()) => info!("X11 global shortcut registered"),
        Err(e) => {
            log::error!("failed to register X11 global shortcut: {e}");
            log::error!("the picker will not respond to keyboard shortcuts");
        }
    }
}

/// Creates the system tray icon with a context menu.
fn setup_tray(app: &AppHandle) -> Result<(), Box<dyn std::error::Error>> {
    let show = MenuItemBuilder::with_id("show", "Show Picker").build(app)?;
    let quit = MenuItemBuilder::with_id("quit", "Quit").build(app)?;
    let menu = MenuBuilder::new(app).items(&[&show, &quit]).build()?;

    let _tray = TrayIconBuilder::new()
        .icon(app.default_window_icon().unwrap().clone())
        .tooltip("Emoji Nook")
        .menu(&menu)
        .on_menu_event(move |app, event| match event.id().as_ref() {
            "show" => {
                if let Some(window) = app.get_webview_window("main") {
                    let _ = window.center();
                    let _ = window.show();
                    let _ = window.set_focus();
                    let _ = app.emit("picker-shown", ());
                }
            }
            "quit" => {
                app.exit(0);
            }
            _ => {}
        })
        .build(app)?;

    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_log::Builder::new().build())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_xdg_portal::init())
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .invoke_handler(tauri::generate_handler![insert_emoji, show_picker, hide_picker])
        .setup(|app| {
            let handle = app.handle().clone();

            setup_tray(&handle)?;

            if is_wayland() {
                register_wayland_shortcut(handle);
            } else {
                register_x11_shortcut(&handle);
            }
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
