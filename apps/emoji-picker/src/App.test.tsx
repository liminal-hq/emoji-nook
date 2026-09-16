// Tests the root app wiring between picker selections and the Tauri command bridge
//
// (c) Copyright 2026 Liminal HQ, Scott Morris
// SPDX-License-Identifier: Apache-2.0 OR MIT

import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import App from './App';

const { updateMock, settingsMock, checkShortcutTriggerDescriptionMock } = vi.hoisted(() => ({
	updateMock: vi.fn(() => Promise.resolve()),
	settingsMock: {
		settings: {
			shortcut: 'Alt+Shift+E',
			skinTone: 'none',
			closeOnSelect: true,
			autostart: false,
		},
		loaded: true,
	},
	checkShortcutTriggerDescriptionMock: vi.fn((): Promise<string | null> => Promise.resolve(null)),
}));

vi.mock('@tauri-apps/api/core', () => ({
	invoke: vi.fn(() => Promise.resolve()),
}));

vi.mock('@tauri-apps/api/event', () => ({
	listen: vi.fn(() => Promise.resolve(() => {})),
}));

vi.mock('@liminal-hq/plugin-desktop-integration', () => ({
	desktopIntegration: {
		checkShortcutBindingComplete: vi.fn(() => Promise.resolve(false)),
		checkShortcutBindingError: vi.fn(() => Promise.resolve(null)),
		checkShortcutTriggerDescription: checkShortcutTriggerDescriptionMock,
	},
}));

vi.mock('@tauri-apps/api/webviewWindow', () => ({
	getCurrentWebviewWindow: () => ({
		onFocusChanged: vi.fn(() => Promise.resolve(() => {})),
		isFocused: vi.fn(() => Promise.resolve(true)),
	}),
}));

vi.mock('./hooks/useTheme', () => ({
	useTheme: vi.fn(),
}));

vi.mock('./hooks/useSettings', () => ({
	useSettings: () => ({ ...settingsMock, update: updateMock }),
}));

vi.mock('./components/EmojiPickerPanel', () => ({
	default: function MockEmojiPickerPanel({
		onEmojiSelect,
	}: {
		onEmojiSelect: (selection: { emoji: string; label: string }) => void;
	}) {
		return (
			<button type="button" onClick={() => onEmojiSelect({ emoji: '😀', label: 'grinning face' })}>
				Select mock emoji
			</button>
		);
	},
}));

describe('App', () => {
	beforeEach(() => {
		settingsMock.loaded = true;
		checkShortcutTriggerDescriptionMock.mockResolvedValue(null);
	});

	afterEach(() => {
		vi.clearAllMocks();
	});

	it('invokes the backend command on emoji selection', async () => {
		render(<App />);

		fireEvent.click(screen.getByRole('button', { name: 'Select mock emoji' }));

		await waitFor(() =>
			expect(invoke).toHaveBeenCalledWith('insert_emoji', {
				closeOnSelect: true,
				emoji: '😀',
				label: 'grinning face',
			}),
		);
	});

	it('saves the stored shortcut when the compositor rebinds it externally', async () => {
		render(<App />);

		const shortcutChangedCall = await waitFor(() => {
			const call = vi
				.mocked(listen)
				.mock.calls.find(([eventName]) => eventName === 'shortcut-changed');
			if (!call) throw new Error('shortcut-changed listener not registered yet');
			return call;
		});
		const handler = shortcutChangedCall[1] as (event: { payload: unknown }) => void;

		// Real payload shape confirmed live on GNOME: instructional text ("Press …")
		// with GTK/XKB accelerator syntax embedded in it, not the human-formatted text
		// GNOME Settings' own UI shows for the same bind, and not bare accelerator
		// syntax on its own either.
		handler({ payload: { sessionId: 'emoji-nook-toggle', triggerDescription: 'Press <Super>e' } });

		await waitFor(() =>
			expect(updateMock).toHaveBeenCalledWith(expect.objectContaining({ shortcut: 'Super+E' })),
		);
	});

	it('saves the stored shortcut from bare accelerator syntax with no surrounding text', async () => {
		render(<App />);

		const shortcutChangedCall = await waitFor(() => {
			const call = vi
				.mocked(listen)
				.mock.calls.find(([eventName]) => eventName === 'shortcut-changed');
			if (!call) throw new Error('shortcut-changed listener not registered yet');
			return call;
		});
		const handler = shortcutChangedCall[1] as (event: { payload: unknown }) => void;

		handler({ payload: { sessionId: 'emoji-nook-toggle', triggerDescription: '<Shift><Alt>e' } });

		await waitFor(() =>
			expect(updateMock).toHaveBeenCalledWith(expect.objectContaining({ shortcut: 'Shift+Alt+E' })),
		);
	});

	it('ignores an external trigger that does not look like GTK/XKB accelerator syntax', async () => {
		render(<App />);

		const shortcutChangedCall = await waitFor(() => {
			const call = vi
				.mocked(listen)
				.mock.calls.find(([eventName]) => eventName === 'shortcut-changed');
			if (!call) throw new Error('shortcut-changed listener not registered yet');
			return call;
		});
		const handler = shortcutChangedCall[1] as (event: { payload: unknown }) => void;

		handler({
			payload: { sessionId: 'emoji-nook-toggle', triggerDescription: 'not a real trigger' },
		});

		// Give any (incorrect) async update a chance to fire before asserting it didn't.
		await new Promise((resolve) => setTimeout(resolve, 0));
		expect(updateMock).not.toHaveBeenCalled();
	});

	it('does not persist a cached external rebind before settings have finished loading', async () => {
		settingsMock.loaded = false;
		checkShortcutTriggerDescriptionMock.mockResolvedValue('Press <Super>e');

		render(<App />);

		// Give the race-guard's async checkShortcutTriggerDescription() call a chance
		// to resolve and (incorrectly, if the loaded gate were missing) fire update().
		await new Promise((resolve) => setTimeout(resolve, 0));
		expect(updateMock).not.toHaveBeenCalled();
	});
});
