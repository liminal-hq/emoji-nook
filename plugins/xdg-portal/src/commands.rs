// Implements IPC commands exposed by the XDG portal plugin
//
// (c) Copyright 2026 Liminal HQ, Scott Morris
// SPDX-License-Identifier: Apache-2.0 OR MIT

use crate::{
    error::PortalError,
    linux,
    models::{
        AvailabilityInfo, RemoteDesktopSession, ShortcutBindRequest, ShortcutBindResponse,
        ThemeInfo,
    },
};

#[tauri::command]
pub async fn check_availability() -> Result<AvailabilityInfo, PortalError> {
    linux::check_availability().await
}

#[tauri::command]
pub async fn get_theme_info() -> Result<ThemeInfo, PortalError> {
    linux::get_theme_info().await
}

#[tauri::command]
pub async fn bind_global_shortcut(
    payload: ShortcutBindRequest,
) -> Result<ShortcutBindResponse, PortalError> {
    if cfg!(target_os = "linux") {
        return Ok(ShortcutBindResponse {
            session_id: format!("global-shortcut:{}", payload.id),
        });
    }

    Err(PortalError::UnsupportedPlatform)
}

#[tauri::command]
pub async fn unbind_global_shortcut(_session_id: String) -> Result<(), PortalError> {
    if cfg!(target_os = "linux") {
        return Ok(());
    }

    Err(PortalError::UnsupportedPlatform)
}

#[tauri::command]
pub async fn create_remote_desktop_session() -> Result<RemoteDesktopSession, PortalError> {
    if cfg!(target_os = "linux") {
        return Ok(RemoteDesktopSession {
            session_id: "remote-desktop:placeholder".to_string(),
        });
    }

    Err(PortalError::UnsupportedPlatform)
}

#[tauri::command]
pub async fn inject_text(_session_id: String, _text: String) -> Result<(), PortalError> {
    if cfg!(target_os = "linux") {
        return Ok(());
    }

    Err(PortalError::UnsupportedPlatform)
}

#[tauri::command]
pub async fn close_remote_desktop_session(_session_id: String) -> Result<(), PortalError> {
    if cfg!(target_os = "linux") {
        return Ok(());
    }

    Err(PortalError::UnsupportedPlatform)
}
