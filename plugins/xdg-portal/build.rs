// Generates plugin metadata and permission manifests for commands
//
// (c) Copyright 2026 Liminal HQ, Scott Morris
// SPDX-License-Identifier: Apache-2.0 OR MIT

const COMMANDS: &[&str] = &[
    "check_availability",
    "get_theme_info",
    "bind_global_shortcut",
    "unbind_global_shortcut",
    "create_remote_desktop_session",
    "inject_text",
    "close_remote_desktop_session",
];

fn main() {
    tauri_plugin::Builder::new(COMMANDS).build();
}
