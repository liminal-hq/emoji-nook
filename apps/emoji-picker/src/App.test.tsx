// Tests the root app wiring between picker selections and the Tauri command bridge
//
// (c) Copyright 2026 Liminal HQ, Scott Morris
// SPDX-License-Identifier: Apache-2.0 OR MIT

import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import App from './App';

const {
	updateMock,
	settingsMock,
	checkShortcutTriggerDescriptionMock,
	lastSyncedTriggerStore,
	setLastSyncedExternalTriggerMock,
} = vi.hoisted(() => ({
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
	// A plain mutable value, not React state — stands in for the real persisted
	// store, which is exactly what must survive a picker window (and its whole
	// component tree) being recreated, unlike anything held in React state.
	lastSyncedTriggerStore: { current: null as string | null },
	setLastSyncedExternalTriggerMock: vi.fn((trigger: string): Promise<void> => {
		lastSyncedTriggerStore.current = trigger;
		return Promise.resolve();
	}),
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
	getLastSyncedExternalTrigger: (): Promise<string | null> =>
		Promise.resolve(lastSyncedTriggerStore.current),
	setLastSyncedExternalTrigger: setLastSyncedExternalTriggerMock,
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
		settingsMock.settings = {
			shortcut: 'Alt+Shift+E',
			skinTone: 'none',
			closeOnSelect: true,
			autostart: false,
		};
		checkShortcutTriggerDescriptionMock.mockResolvedValue(null);
		lastSyncedTriggerStore.current = null;
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

	it('does not fold trailing prose punctuation into the parsed key', async () => {
		render(<App />);

		const shortcutChangedCall = await waitFor(() => {
			const call = vi
				.mocked(listen)
				.mock.calls.find(([eventName]) => eventName === 'shortcut-changed');
			if (!call) throw new Error('shortcut-changed listener not registered yet');
			return call;
		});
		const handler = shortcutChangedCall[1] as (event: { payload: unknown }) => void;

		// A compositor or translation could delimit the accelerator without whitespace
		// (e.g. wrapping it in parentheses, or ending the sentence right after it).
		handler({
			payload: { sessionId: 'emoji-nook-toggle', triggerDescription: 'Press (<Super>e)' },
		});

		await waitFor(() =>
			expect(updateMock).toHaveBeenCalledWith(expect.objectContaining({ shortcut: 'Super+E' })),
		);
	});

	it('accepts a single punctuation character as the shortcut key', async () => {
		render(<App />);

		const shortcutChangedCall = await waitFor(() => {
			const call = vi
				.mocked(listen)
				.mock.calls.find(([eventName]) => eventName === 'shortcut-changed');
			if (!call) throw new Error('shortcut-changed listener not registered yet');
			return call;
		});
		const handler = shortcutChangedCall[1] as (event: { payload: unknown }) => void;

		// This app's own shortcut capture accepts any single character as a key
		// (see SettingsPanel.tsx), including punctuation — the parser must too.
		handler({ payload: { sessionId: 'emoji-nook-toggle', triggerDescription: 'Press <Alt>.' } });

		await waitFor(() =>
			expect(updateMock).toHaveBeenCalledWith(expect.objectContaining({ shortcut: 'Alt+.' })),
		);
	});

	it('parses complete underscored XKB keysym names', async () => {
		render(<App />);

		const shortcutChangedCall = await waitFor(() => {
			const call = vi
				.mocked(listen)
				.mock.calls.find(([eventName]) => eventName === 'shortcut-changed');
			if (!call) throw new Error('shortcut-changed listener not registered yet');
			return call;
		});
		const handler = shortcutChangedCall[1] as (event: { payload: unknown }) => void;

		// Keypad and ISO keys use underscored multi-word XKB keysym names — a
		// compositor can bind to these even though this app's own capture UI can't
		// produce them, and the parser must not truncate at the underscore.
		handler({
			payload: { sessionId: 'emoji-nook-toggle', triggerDescription: 'Press <Super>KP_Add' },
		});

		await waitFor(() =>
			expect(updateMock).toHaveBeenCalledWith(
				expect.objectContaining({ shortcut: 'Super+KP_Add' }),
			),
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

	it('rejects an accelerator with an unsupported leading modifier', async () => {
		render(<App />);

		const shortcutChangedCall = await waitFor(() => {
			const call = vi
				.mocked(listen)
				.mock.calls.find(([eventName]) => eventName === 'shortcut-changed');
			if (!call) throw new Error('shortcut-changed listener not registered yet');
			return call;
		});
		const handler = shortcutChangedCall[1] as (event: { payload: unknown }) => void;

		// GTK's portable "<Primary>" (Ctrl-or-Cmd) isn't in this app's own modifier
		// vocabulary. Dropping it and parsing just the recognised suffix would
		// register a shortcut missing a modifier the compositor actually requires.
		handler({
			payload: { sessionId: 'emoji-nook-toggle', triggerDescription: 'Press <Primary><Shift>e' },
		});

		await new Promise((resolve) => setTimeout(resolve, 0));
		expect(updateMock).not.toHaveBeenCalled();
	});

	it('does not re-consume a stale cached external trigger after a later local edit', async () => {
		checkShortcutTriggerDescriptionMock.mockResolvedValue('Press <Super>e');

		const { rerender } = render(<App />);

		// Initial catch-up sync consumes the cached external trigger once.
		await waitFor(() =>
			expect(updateMock).toHaveBeenCalledWith(expect.objectContaining({ shortcut: 'Super+E' })),
		);
		expect(checkShortcutTriggerDescriptionMock).toHaveBeenCalledTimes(1);
		const updateCallsAfterInitialSync = updateMock.mock.calls.length;

		// Simulate a later local edit (e.g. saved via the Settings dialog) that
		// changes `settings` to a new object, then re-render as React would after
		// that state update. The Rust-side cache is not cleared on consumption, so
		// a naive re-check here would revert the local edit back to "Super+E".
		settingsMock.settings = { ...settingsMock.settings, shortcut: 'Ctrl+Alt+F' };
		rerender(<App />);

		await new Promise((resolve) => setTimeout(resolve, 0));
		expect(checkShortcutTriggerDescriptionMock).toHaveBeenCalledTimes(1);
		expect(updateMock.mock.calls.length).toBe(updateCallsAfterInitialSync);
	});

	it('does not re-consume a stale cached external trigger across a fresh picker mount', async () => {
		checkShortcutTriggerDescriptionMock.mockResolvedValue('Press <Super>e');

		const { unmount } = render(<App />);
		await waitFor(() =>
			expect(updateMock).toHaveBeenCalledWith(expect.objectContaining({ shortcut: 'Super+E' })),
		);
		unmount();

		// The picker window (and this whole component tree) is destroyed and
		// recreated on every show, so simulate that with a local edit in between and
		// a brand new mount — the persisted `lastSyncedTriggerStore` (unlike React
		// state) must survive this and still prevent the stale value from returning.
		settingsMock.settings = { ...settingsMock.settings, shortcut: 'Ctrl+Alt+F' };
		updateMock.mockClear();
		checkShortcutTriggerDescriptionMock.mockClear();

		render(<App />);

		await new Promise((resolve) => setTimeout(resolve, 0));
		expect(checkShortcutTriggerDescriptionMock).toHaveBeenCalledTimes(1);
		expect(updateMock).not.toHaveBeenCalled();
	});

	it('processes a live external rebind even if it matches an earlier one', async () => {
		render(<App />);

		const shortcutChangedCall = await waitFor(() => {
			const call = vi
				.mocked(listen)
				.mock.calls.find(([eventName]) => eventName === 'shortcut-changed');
			if (!call) throw new Error('shortcut-changed listener not registered yet');
			return call;
		});
		const handler = shortcutChangedCall[1] as (event: { payload: unknown }) => void;

		// Rebind externally to A.
		handler({ payload: { sessionId: 'emoji-nook-toggle', triggerDescription: 'Press <Super>a' } });
		await waitFor(() =>
			expect(updateMock).toHaveBeenCalledWith(expect.objectContaining({ shortcut: 'Super+A' })),
		);

		// Change the shortcut locally to something else, then rebind externally back
		// to A — the raw trigger text is now identical to the first live event, but
		// this is a genuinely new rebind and must still be applied, not discarded as
		// an already-seen catch-up value.
		settingsMock.settings = { ...settingsMock.settings, shortcut: 'Ctrl+Alt+F' };
		updateMock.mockClear();
		handler({ payload: { sessionId: 'emoji-nook-toggle', triggerDescription: 'Press <Super>a' } });

		await waitFor(() =>
			expect(updateMock).toHaveBeenCalledWith(expect.objectContaining({ shortcut: 'Super+A' })),
		);
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
