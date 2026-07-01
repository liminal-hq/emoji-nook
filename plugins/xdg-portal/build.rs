// Generates plugin metadata and permission manifests for commands
//
// (c) Copyright 2026 Liminal HQ, Scott Morris
// SPDX-License-Identifier: Apache-2.0 OR MIT

const COMMANDS: &[&str] = &["check_availability", "get_theme_info"];

fn main() {
    tauri_plugin::Builder::new(COMMANDS).build();
}
