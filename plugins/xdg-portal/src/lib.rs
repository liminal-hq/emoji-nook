// Registers the XDG portal plugin commands for Tauri
//
// (c) Copyright 2026 Liminal HQ, Scott Morris
// SPDX-License-Identifier: Apache-2.0 OR MIT

mod commands;
mod error;
pub mod global_shortcuts;
mod linux;
mod models;

use tauri::{
    plugin::{Builder, TauriPlugin},
    Runtime,
};

pub fn init<R: Runtime>() -> TauriPlugin<R> {
    Builder::new("xdg-portal")
        .invoke_handler(tauri::generate_handler![
            commands::check_availability,
            commands::get_theme_info,
        ])
        .build()
}
