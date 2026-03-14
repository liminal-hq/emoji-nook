// Provides Linux-specific portal availability checks
//
// (c) Copyright 2026 Liminal HQ, Scott Morris
// SPDX-License-Identifier: Apache-2.0 OR MIT

use crate::{error::PortalError, models::AvailabilityInfo};

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
