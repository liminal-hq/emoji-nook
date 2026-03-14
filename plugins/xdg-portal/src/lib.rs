// Registers the XDG portal plugin commands for Tauri
//
// (c) Copyright 2026 Liminal HQ, Scott Morris
// SPDX-License-Identifier: Apache-2.0 OR MIT

mod commands;
mod error;
mod linux;
mod models;

use tauri::{
    plugin::{Builder, TauriPlugin},
    Runtime,
};

pub fn init<R: Runtime>() -> TauriPlugin<R> {
    println!("[xdg-portal plugin] init() entered");
    Builder::new("xdg-portal")
        .setup(|_app, _api| {
            println!("[xdg-portal plugin] setup() called");
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::check_availability,
            commands::get_theme_info,
            commands::bind_global_shortcut,
            commands::unbind_global_shortcut,
            commands::create_remote_desktop_session,
            commands::inject_text,
            commands::close_remote_desktop_session,
        ])
        .build()
}
