// Exposes guest-side metadata for the desktop-integration plugin package
//
// (c) Copyright 2026 Liminal HQ, Scott Morris
// SPDX-License-Identifier: Apache-2.0 OR MIT

export const pluginName = 'desktop-integration';

/**
 * The desktop-integration plugin is currently backend-only.
 *
 * The guest package exists so the workspace keeps a standard Tauri plugin
 * layout and has a stable place for future guest-side helpers.
 */
export const desktopIntegration = Object.freeze({
	pluginName,
});
