// Exposes typed guest-side wrappers for plugin command invocation
//
// (c) Copyright 2026 Liminal HQ, Scott Morris
// SPDX-License-Identifier: Apache-2.0 OR MIT

import { invoke } from '@tauri-apps/api/core';

type AvailabilityInfo = {
	isLinux: boolean;
	sandboxed: boolean;
	portalAvailable: boolean;
};

type ColourScheme = 'no-preference' | 'prefer-dark' | 'prefer-light';

type DesktopEnvironment = 'gnome' | 'kde' | 'cinnamon' | 'mate' | 'xfce' | 'unknown';

type AccentColour = {
	r: number;
	g: number;
	b: number;
};

type ThemeInfo = {
	colourScheme: ColourScheme;
	accentColour: AccentColour | null;
	highContrast: boolean;
	desktopEnvironment: DesktopEnvironment;
};

const PREFIX = 'plugin:xdg-portal|';

function cmd<T>(name: string, args?: Record<string, unknown>): Promise<T> {
	return invoke<T>(`${PREFIX}${name}`, args);
}

export const portal = {
	checkAvailability: () => cmd<AvailabilityInfo>('check_availability'),
	getThemeInfo: () => cmd<ThemeInfo>('get_theme_info'),
};

export type { ThemeInfo, ColourScheme, DesktopEnvironment, AccentColour };
