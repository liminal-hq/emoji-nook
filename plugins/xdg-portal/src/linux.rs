// Provides Linux-specific portal availability and theme detection
//
// (c) Copyright 2026 Liminal HQ, Scott Morris
// SPDX-License-Identifier: Apache-2.0 OR MIT

use crate::{
    error::PortalError,
    models::{AccentColour, AvailabilityInfo, ColourScheme, DesktopEnvironment, ThemeInfo},
};

#[cfg(target_os = "linux")]
pub async fn check_availability() -> Result<AvailabilityInfo, PortalError> {
    // Minimal Milestone-2 check: query over D-Bus via ashpd-backed call.
    // If this fails, the desktop portal service is likely unavailable.
    let proxy = ashpd::desktop::settings::Settings::new()
        .await
        .map_err(|e| PortalError::Internal(e.to_string()))?;

    let _ = proxy
        .color_scheme()
        .await
        .map_err(|e| PortalError::Internal(e.to_string()))?;

    Ok(AvailabilityInfo {
        is_linux: true,
        sandboxed: ashpd::is_sandboxed().await,
        portal_available: true,
    })
}

#[cfg(not(target_os = "linux"))]
pub async fn check_availability() -> Result<AvailabilityInfo, PortalError> {
    Ok(AvailabilityInfo {
        is_linux: false,
        sandboxed: false,
        portal_available: false,
    })
}

/// Detect the desktop environment from `XDG_CURRENT_DESKTOP`.
pub fn detect_desktop_environment() -> DesktopEnvironment {
    let desktop = std::env::var("XDG_CURRENT_DESKTOP").unwrap_or_default();
    // XDG_CURRENT_DESKTOP can be colon-separated (e.g. "ubuntu:GNOME")
    let desktop_upper = desktop.to_uppercase();

    if desktop_upper.contains("GNOME") {
        DesktopEnvironment::Gnome
    } else if desktop_upper.contains("KDE") {
        DesktopEnvironment::Kde
    } else if desktop_upper.contains("CINNAMON") || desktop_upper.contains("X-CINNAMON") {
        DesktopEnvironment::Cinnamon
    } else if desktop_upper.contains("MATE") {
        DesktopEnvironment::Mate
    } else if desktop_upper.contains("XFCE") {
        DesktopEnvironment::Xfce
    } else {
        DesktopEnvironment::Unknown
    }
}

#[cfg(target_os = "linux")]
pub async fn get_theme_info() -> Result<ThemeInfo, PortalError> {
    let settings = ashpd::desktop::settings::Settings::new()
        .await
        .map_err(|e| PortalError::Internal(e.to_string()))?;

    // Colour scheme: 0 = no preference, 1 = prefer dark, 2 = prefer light
    let colour_scheme = match settings.color_scheme().await {
        Ok(ashpd::desktop::settings::ColorScheme::PreferDark) => ColourScheme::PreferDark,
        Ok(ashpd::desktop::settings::ColorScheme::PreferLight) => ColourScheme::PreferLight,
        _ => ColourScheme::NoPreference,
    };

    // Accent colour: (r, g, b) tuple in 0.0–1.0 sRGB range
    let accent_colour = settings.accent_color().await.ok().map(|c| AccentColour {
        r: c.red(),
        g: c.green(),
        b: c.blue(),
    });

    // Contrast: 0 = normal, 1 = high
    let high_contrast = settings
        .contrast()
        .await
        .map(|c| c == ashpd::desktop::settings::Contrast::High)
        .unwrap_or(false);

    let desktop_environment = detect_desktop_environment();

    Ok(ThemeInfo {
        colour_scheme,
        accent_colour,
        high_contrast,
        desktop_environment,
    })
}

#[cfg(not(target_os = "linux"))]
pub async fn get_theme_info() -> Result<ThemeInfo, PortalError> {
    Ok(ThemeInfo {
        colour_scheme: ColourScheme::NoPreference,
        accent_colour: None,
        high_contrast: false,
        desktop_environment: DesktopEnvironment::Unknown,
    })
}
