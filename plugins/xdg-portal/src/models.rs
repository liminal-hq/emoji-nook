// Defines serialisable models for XDG portal IPC payloads
//
// (c) Copyright 2026 Liminal HQ, Scott Morris
// SPDX-License-Identifier: Apache-2.0 OR MIT

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ShortcutBindRequest {
  pub id: String,
  pub description: String,
  pub preferred_trigger: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ShortcutBindResponse {
  pub session_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RemoteDesktopSession {
  pub session_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AvailabilityInfo {
  pub is_linux: bool,
  pub sandboxed: bool,
  pub portal_available: bool,
}

/// Colour scheme preference from the desktop portal.
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub enum ColourScheme {
  NoPreference,
  PreferDark,
  PreferLight,
}

/// Desktop environment family, used to select widget style maps.
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub enum DesktopEnvironment {
  Gnome,
  Kde,
  Cinnamon,
  Mate,
  Xfce,
  Unknown,
}

/// Accent colour as sRGB values in 0.0–1.0 range.
/// Absent if the desktop does not report an accent colour.
#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AccentColour {
  pub r: f64,
  pub g: f64,
  pub b: f64,
}

/// Combined theme information from the desktop portal and environment.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ThemeInfo {
  pub colour_scheme: ColourScheme,
  pub accent_colour: Option<AccentColour>,
  pub high_contrast: bool,
  pub desktop_environment: DesktopEnvironment,
}
