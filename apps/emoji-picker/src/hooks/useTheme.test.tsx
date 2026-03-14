// Tests desktop theme token injection through the xdg-portal guest API
//
// (c) Copyright 2026 Liminal HQ, Scott Morris
// SPDX-License-Identifier: Apache-2.0 OR MIT

import { render, waitFor } from '@testing-library/react';
import { portal } from 'tauri-plugin-xdg-portal';
import { useTheme } from './useTheme';

vi.mock('tauri-plugin-xdg-portal', () => ({
	portal: {
		getThemeInfo: vi.fn(),
	},
}));

function ThemeHarness() {
	useTheme();
	return null;
}

describe('useTheme', () => {
	afterEach(() => {
		vi.clearAllMocks();
		document.documentElement.removeAttribute('style');
	});

	it('applies CSS variables from the detected desktop theme', async () => {
		vi.mocked(portal.getThemeInfo).mockResolvedValue({
			colourScheme: 'prefer-dark',
			accentColour: { r: 1, g: 0.5, b: 0 },
			highContrast: false,
			desktopEnvironment: 'kde',
		});

		render(<ThemeHarness />);

		await waitFor(() => {
			expect(document.documentElement.style.getPropertyValue('--accent')).toBe('#ff8000');
		});

		expect(document.documentElement.style.getPropertyValue('--font-family')).toContain(
			'"Noto Sans"',
		);
	});
});
