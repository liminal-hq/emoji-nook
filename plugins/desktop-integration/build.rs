// Generates plugin metadata and permission manifests for desktop integration
//
// (c) Copyright 2026 Liminal HQ, Scott Morris
// SPDX-License-Identifier: Apache-2.0 OR MIT

const COMMANDS: &[&str] = &["check_shortcut_binding_complete", "check_shortcut_binding_error"];

fn main() {
    tauri_plugin::Builder::new(COMMANDS).build();
}
