// Wires Tauri commands and plugins for the desktop application runtime
//
// (c) Copyright 2026 Liminal HQ, Scott Morris
// SPDX-License-Identifier: Apache-2.0 OR MIT

use log::info;

/// Receives a selected emoji from the frontend.
///
/// For now this only logs the selection. Later phases will hide the window
/// and inject the emoji into the previously focused application.
#[tauri::command]
fn insert_emoji(emoji: &str, label: &str) {
    info!("emoji selected: {} ({})", emoji, label);
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_log::Builder::new().build())
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![insert_emoji])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
