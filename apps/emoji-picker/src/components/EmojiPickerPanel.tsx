// Renders the Frimousse emoji picker with search, categories, and keyboard navigation
//
// (c) Copyright 2026 Liminal HQ, Scott Morris
// SPDX-License-Identifier: Apache-2.0 OR MIT

import type { RefObject } from 'react';
import { useCallback, useRef, useEffect } from 'react';
import { EmojiPicker } from 'frimousse';
import type { SkinTone } from 'frimousse';
import CategoryBar from './CategoryBar';

export interface EmojiSelection {
	emoji: string;
	label: string;
}

interface EmojiPickerPanelProps {
	searchRef?: RefObject<HTMLInputElement | null>;
	skinTone: SkinTone;
	onSkinToneChange: (skinTone: SkinTone) => void;
	onEmojiSelect: (selection: EmojiSelection) => void;
	onOpenSettings?: () => void;
}

/** Convert a category label like "Smileys & emotion" to a slug like "smileys-emotion". */
function slugify(label: string): string {
	return label
		.toLowerCase()
		.replace(/&/g, '')
		.replace(/\s+/g, '-')
		.replace(/-+/g, '-')
		.replace(/^-|-$/g, '');
}

export default function EmojiPickerPanel({
	searchRef: externalSearchRef,
	skinTone,
	onSkinToneChange,
	onEmojiSelect,
	onOpenSettings,
}: EmojiPickerPanelProps) {
	const internalSearchRef = useRef<HTMLInputElement>(null);
	const searchRef = externalSearchRef ?? internalSearchRef;
	const viewportRef = useRef<HTMLDivElement>(null);

	useEffect(() => {
		searchRef.current?.focus();
	}, [searchRef]);

	const handleSelect = useCallback(
		(emoji: EmojiSelection) => {
			console.info(`emoji selected: ${emoji.emoji} (${emoji.label})`);
			onEmojiSelect(emoji);
		},
		[onEmojiSelect],
	);

	return (
		<EmojiPicker.Root
			onEmojiSelect={handleSelect}
			skinTone={skinTone}
			columns={9}
			className="picker-root"
		>
			<div className="picker-header">
				<EmojiPicker.Search
					ref={searchRef}
					placeholder="Search emoji…"
					className="picker-search"
					autoFocus
				/>
				<EmojiPicker.SkinTone emoji="✋">
					{({ skinToneVariations }) => (
						<div className="skin-tone-selector" role="radiogroup" aria-label="Skin tone">
							{skinToneVariations.map(({ skinTone: st, emoji }) => (
								<button
									key={st}
									role="radio"
									aria-checked={st === skinTone}
									className={`skin-tone-btn${st === skinTone ? ' active' : ''}`}
									onClick={() => onSkinToneChange(st)}
									title={st}
								>
									{emoji}
								</button>
							))}
						</div>
					)}
				</EmojiPicker.SkinTone>
			</div>

			<CategoryBar viewportRef={viewportRef} />

			<EmojiPicker.Viewport ref={viewportRef} className="picker-viewport" tabIndex={0}>
				<EmojiPicker.Loading>
					<span className="picker-loading">Loading emoji…</span>
				</EmojiPicker.Loading>
				<EmojiPicker.Empty>
					{({ search }) => (
						<span className="picker-empty">No results for &ldquo;{search}&rdquo;</span>
					)}
				</EmojiPicker.Empty>
				<EmojiPicker.List
					components={{
						CategoryHeader: ({ category, ...props }) => (
							<div
								{...props}
								className="picker-category-header"
								data-category-id={slugify(category.label)}
							>
								{category.label}
							</div>
						),
						Row: ({ children, ...props }) => (
							<div {...props} className="picker-row">
								{children}
							</div>
						),
						Emoji: ({ emoji, ...props }) => (
							<button
								{...props}
								className="picker-emoji"
								title={emoji.label}
								aria-label={emoji.label}
							>
								{emoji.emoji}
							</button>
						),
					}}
				/>
			</EmojiPicker.Viewport>

			<div className="picker-footer">
				<EmojiPicker.ActiveEmoji>
					{({ emoji }) => (
						<div className="picker-preview">
							{emoji ? (
								<>
									<span className="preview-emoji">
										{emoji.emoji}
									</span>
									<span className="preview-label">
										{emoji.label}
									</span>
								</>
							) : (
								<span className="preview-label">
									Pick an emoji…
								</span>
							)}
							{onOpenSettings && (
								<button
									className="settings-gear"
									onClick={onOpenSettings}
									title="Settings"
									aria-label="Settings"
								>
									&#9881;
								</button>
							)}
						</div>
					)}
				</EmojiPicker.ActiveEmoji>
			</div>
		</EmojiPicker.Root>
	);
}
