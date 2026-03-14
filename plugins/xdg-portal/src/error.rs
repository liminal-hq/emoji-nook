// Defines plugin error types for portal command failures
//
// (c) Copyright 2026 Liminal HQ, Scott Morris
// SPDX-License-Identifier: Apache-2.0 OR MIT

use thiserror::Error;

#[derive(Debug, Error)]
pub enum PortalError {
    #[error("unsupported platform: only Linux is supported")]
    UnsupportedPlatform,
    #[error("internal error: {0}")]
    Internal(String),
}

impl serde::Serialize for PortalError {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        serializer.serialize_str(&self.to_string())
    }
}
