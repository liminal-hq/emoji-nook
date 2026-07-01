// Implements IPC commands exposed by the XDG portal plugin
//
// (c) Copyright 2026 Liminal HQ, Scott Morris
// SPDX-License-Identifier: Apache-2.0 OR MIT

use crate::{
    error::PortalError,
    linux,
    models::{AvailabilityInfo, ThemeInfo},
};

#[tauri::command]
pub async fn check_availability() -> Result<AvailabilityInfo, PortalError> {
    linux::check_availability().await
}

#[tauri::command]
pub async fn get_theme_info() -> Result<ThemeInfo, PortalError> {
    linux::get_theme_info().await
}
