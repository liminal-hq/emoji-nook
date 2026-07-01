// Exposes guest-side bindings for the desktop-integration plugin
//
// (c) Copyright 2026 Liminal HQ, Scott Morris
// SPDX-License-Identifier: Apache-2.0 OR MIT

import { invoke } from '@tauri-apps/api/core';

const PREFIX = 'plugin:desktop-integration|';

function cmd<T>(name: string, args?: Record<string, unknown>): Promise<T> {
	return invoke<T>(`${PREFIX}${name}`, args);
}

export const desktopIntegration = {
	/**
	 * Returns true once the portal BindShortcuts call has completed successfully.
	 * On X11 this is always true immediately after startup.
	 * Use this as a race guard after registering the shortcut-binding-result listener.
	 */
	checkShortcutBindingComplete: () => cmd<boolean>('check_shortcut_binding_complete'),

	/**
	 * Returns the error message if BindShortcuts failed, or null if still pending
	 * or successful. Use this as a race guard after registering the
	 * shortcut-binding-result listener — complements checkShortcutBindingComplete.
	 */
	checkShortcutBindingError: () => cmd<string | null>('check_shortcut_binding_error'),
};
