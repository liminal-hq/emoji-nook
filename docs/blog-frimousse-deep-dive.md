# Choosing a Headless Emoji Picker: Frimousse v0.3 in Emoji Nook

**TL;DR** — Emoji Nook's original spec called for emoji-mart. We switched to Frimousse, a headless React 19 emoji picker that gives you the logic (search, categories, keyboard navigation, skin tones) with zero visual opinion. It was the right call — but headless components come with their own category of surprises.

---

<!-- TODO: screenshot of the finished picker showing search, category bar, emoji grid, and footer preview -->

## Why Not emoji-mart?

The [project spec](../SPEC.md) originally listed emoji-mart as the emoji library. It's a reasonable default — battle-tested, full-featured, used everywhere. But once we started building a native-feeling Linux desktop app inside a Tauri v2 webview, emoji-mart's opinions became friction.

The problem isn't that emoji-mart looks bad. It's that it looks like *itself*. It ships its own CSS, its own layout, its own search bar styling, its own category tabs. If you want the picker to look like GNOME's Adwaita or KDE's Breeze, you're fighting the library with CSS overrides, `!important` declarations, and specificity hacks. Every theme token has to punch through someone else's stylesheet.

We needed the opposite: a library that provides the hard parts (emoji data, search indexing, keyboard navigation across 1800+ items, skin tone variants) and stays completely silent about how any of it looks.

That's Frimousse.

## What Frimousse Actually Is

[Frimousse](https://frimousse.laf.dev) (v0.3 at time of writing) is a headless React 19 emoji picker. "Headless" means it provides compound components — `EmojiPicker.Root`, `Search`, `Viewport`, `List`, `SkinTone`, `ActiveEmoji`, and so on — that carry all the behaviour but render no visual opinion. You get render props and data attributes. Every pixel of the UI is yours.

The emoji dataset (~12 kB) loads on demand, not at bundle time. The library handles categorisation into the standard Unicode groups, full-text search across emoji names and keywords, and keyboard navigation with arrow keys — all through a clean compound component API built for React 19.

Here's what matters for a desktop app: because Frimousse renders nothing visual, there's nothing to override. No base stylesheet to compete with. No scoped CSS to pierce. The styling surface is entirely yours from the start.

## Composing the Primitives

The core of Emoji Nook's frontend is `EmojiPickerPanel.tsx`, which composes Frimousse's primitives into a custom layout. The structure looks like this:

```tsx
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
          <div {...props} className="picker-category-header" data-category-id={slugify(category.label)}>
            {category.label}
          </div>
        ),
        Row: ({ children, ...props }) => (
          <div {...props} className="picker-row">{children}</div>
        ),
        Emoji: ({ emoji, ...props }) => (
          <button {...props} className="picker-emoji" title={emoji.label} aria-label={emoji.label}>
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
              <span className="preview-emoji">{emoji.emoji}</span>
              <span className="preview-label">{emoji.label}</span>
            </>
          ) : (
            <span className="preview-label">Pick an emoji…</span>
          )}
        </div>
      )}
    </EmojiPicker.ActiveEmoji>
  </div>
</EmojiPicker.Root>
```

A few things to notice:

- **`EmojiPicker.List` takes render components, not children.** You pass `CategoryHeader`, `Row`, and `Emoji` as component overrides. Frimousse spreads its own props (including data attributes for focus tracking) onto whatever you render, so the behaviour is preserved while the markup is entirely custom.
- **`EmojiPicker.SkinTone` uses render props** to hand you the list of skin tone variations. You decide the layout — in our case, a row of small radio buttons beside the search bar.
- **`EmojiPicker.ActiveEmoji` powers the footer preview.** It tracks whichever emoji the user is currently hovering or has navigated to with the keyboard, and exposes it through a render prop. No preview? You get `null`.
- **`CategoryBar` is our own component.** Frimousse doesn't ship category tabs. We built `CategoryBar.tsx` separately, using the viewport ref to observe scroll position and jump to categories. More on this below — it's where most of the surprises lived.

<!-- TODO: screenshot annotating the picker regions: search, skin tone, category bar, viewport, footer -->

## The Surprises

Headless components give you freedom, but freedom means you're responsible for things a batteries-included library would handle silently. Here's what we ran into.

### Focus Management and Keyboard Navigation

Frimousse ties keyboard navigation to focus. It uses `onFocusCapture` on the root element and tracks a `data-focused` attribute internally. Arrow keys are handled via a `document.addEventListener` — they work when the search input or viewport has focus, but not otherwise.

This is invisible when you're testing in a browser where the search input is always focused. But in a Tauri webview, users might click the category bar or the skin tone selector, moving focus outside the root's capture zone. Suddenly arrow keys stop working and there's no visible indication why.

The fix: we added `tabIndex={0}` to the `Viewport` element so users could tab into the grid area and restore keyboard navigation:

```tsx
<EmojiPicker.Viewport ref={viewportRef} className="picker-viewport" tabIndex={0}>
```

This one attribute made the difference between "keyboard nav works in dev" and "keyboard nav works for real users."

### Why Individual Emoji Buttons Have `tabIndex: -1`

When we first inspected Frimousse's rendered DOM, we noticed every emoji button had `tabIndex: -1`. This looked like a bug — how do you tab to an emoji to select it?

It's actually the right design. With 1800+ emoji in the grid, roving tabindex (where each button is sequentially focusable) would be unusable. Pressing Tab would cycle through every single emoji before reaching the next UI element. Instead, Frimousse manages its own internal focus highlight via the `data-active` attribute and handles arrow key navigation in JavaScript. The user presses Enter to select the highlighted emoji without ever tabbing to it.

We style the active state in CSS to make this visible:

```css
.picker-emoji[data-active] {
  background: var(--bg-hover);
}
```

### The Viewport Focus Outline Bug

Adding `tabIndex={0}` to the viewport solved keyboard navigation but created a new problem: WebKitGTK rendered a thick blue focus rectangle around the entire scrollable area whenever the viewport received focus. On a 370-pixel-wide picker, this was a heavy visual artefact that made it look broken.

Since Frimousse already highlights the active emoji via `data-active`, the viewport-level focus indicator is redundant. We suppressed it:

```css
.picker-viewport:focus,
.picker-viewport:focus-visible {
  outline: none;
}
```

This is one of those cases where the fix is a single CSS rule, but finding out *why* the blue rectangle appeared — and convincing yourself it's safe to remove — takes longer than the fix itself.

<!-- TODO: before/after screenshot showing the focus rectangle on the viewport -->

### `offsetTop` and `offsetParent` Unreliability

`CategoryBar` lets users click a category icon (Smileys, Animals, Food, etc.) to scroll the viewport to that section. The initial implementation used `offsetTop` to calculate scroll positions:

```js
// The naive approach — broken inside Frimousse's DOM nesting
const offset = header.offsetTop;
viewport.scrollTo({ top: offset, behavior: 'smooth' });
```

This worked in isolation but broke inside Frimousse's actual DOM. The problem is that `offsetTop` is relative to `offsetParent`, and Frimousse's internal wrapper elements create intermediate positioned containers. The `offsetTop` value was relative to an inner div, not the viewport's scroll container, producing wildly wrong scroll positions.

The fix was `getBoundingClientRect()`, which always returns coordinates relative to the visual viewport and doesn't care about DOM nesting:

```ts
const viewportRect = viewport.getBoundingClientRect();
const headerRect = header.getBoundingClientRect();
const offset = headerRect.top - viewportRect.top + viewport.scrollTop;
viewport.scrollTo({ top: offset, behavior: 'smooth' });
```

This works regardless of how many wrapper divs Frimousse puts between the viewport and the header, and it'll keep working if the library changes its internal structure.

### Async-Rendered Headers and the MutationObserver Fix

The category bar needs to know which section is currently visible so it can highlight the corresponding tab. We used an `IntersectionObserver` rooted on the viewport, watching for `[data-category-id]` header elements:

```ts
const io = new IntersectionObserver(
  (entries) => {
    for (const entry of entries) {
      if (entry.isIntersecting) {
        const id = (entry.target as HTMLElement).dataset.categoryId;
        if (id) setActiveId(id);
      }
    }
  },
  { root: viewport, rootMargin: '0px 0px -85% 0px', threshold: 0 },
);
```

The first version queried for headers once on mount, observed them, and called it done. It worked perfectly — until someone with a slower machine noticed the active tab was always stuck on "Smileys" and never updated.

The issue: Frimousse renders its emoji data asynchronously after a loading phase. When the `useEffect` fires on mount, Frimousse is still showing its `<Loading>` state. The `querySelectorAll('[data-category-id]')` call finds zero headers, the `IntersectionObserver` has nothing to watch, and `activeId` never changes.

The fix was a `MutationObserver` that watches for new children being inserted into the viewport and observes any new headers it finds:

```ts
const observed = new Set<Element>();

function observeHeaders() {
  const headers = viewport.querySelectorAll('[data-category-id]');
  headers.forEach((h) => {
    if (!observed.has(h)) {
      observed.add(h);
      io.observe(h);
    }
  });
}

observeHeaders(); // catch any already rendered

const mo = new MutationObserver(() => observeHeaders());
mo.observe(viewport, { childList: true, subtree: true });
```

The `observed` set ensures we don't double-observe headers. The `MutationObserver` fires whenever Frimousse finishes loading and inserts the category sections, at which point the `IntersectionObserver` picks them up and the category bar starts tracking correctly.

This is a general pattern worth remembering: if you're integrating with a headless library that renders asynchronously, don't assume the DOM is populated when your effect runs. Watch for mutations.

## The CSS Token System

This is where the headless approach pays its biggest dividend.

Emoji Nook reads the user's desktop theme from `xdg-desktop-portal` — colour scheme, accent colour, desktop environment — and injects CSS custom properties that the entire UI consumes. The token system lives in `App.css`:

```css
:root {
  --bg-primary: #fafafa;
  --bg-surface: #ffffff;
  --bg-hover: rgba(0, 0, 0, 0.06);
  --text-primary: #1a1a1a;
  --text-secondary: #666666;
  --accent: #3584e4;
  --border: rgba(0, 0, 0, 0.12);
  --radius-sm: 6px;
  --radius-md: 10px;
  --font-family: 'Cantarell', 'Noto Sans', system-ui, sans-serif;
  --emoji-size: 1.625rem;
  --row-height: 36px;
  /* ... */
}

@media (prefers-color-scheme: dark) {
  :root {
    --bg-primary: #2d2d2d;
    --bg-surface: #383838;
    --text-primary: #f0f0f0;
    --accent: #62a0ea;
    /* ... */
  }
}
```

Every component — the search bar, category tabs, emoji grid, skin tone selector, footer preview — references these tokens. The `useTheme` hook overrides them at runtime when the portal provides actual desktop values.

With a batteries-included picker like emoji-mart, you'd need to override *its* tokens with yours, fighting specificity at every level. With Frimousse, there's no "its" — there's only yours. The search input is a plain `<input>` that you style. The emoji buttons are plain `<button>` elements that you style. The category headers are plain `<div>` elements that you style.

No `!important`. No specificity wars. No "why is the hover state the wrong colour because the library's CSS loaded after mine."

<!-- TODO: side-by-side screenshot of the picker in GNOME Adwaita dark vs KDE Breeze light, showing the same tokens producing different visual results -->

## Would We Choose It Again?

Yes. Without hesitation.

The headless approach means zero visual debt. When we need to change the theme system, add show/hide animations, restructure the layout, or adapt the picker for a different form factor, Frimousse's primitives don't fight back. They're pure behaviour — search logic, keyboard navigation, skin tone state, emoji data loading — delivered through a clean compound component API.

The surprises we hit (async rendering, focus management, `offsetTop` unreliability) are real, and they cost time. But they're one-time costs. Once solved, the solutions are stable because they don't depend on library internals — they depend on standard DOM APIs (`getBoundingClientRect`, `MutationObserver`, `IntersectionObserver`) that won't change.

The alternative — wrestling with a styled component library to make it look like something it wasn't designed to be — would have been a recurring cost. Every theme change, every layout tweak, every new desktop environment would mean another round of CSS archaeology.

Frimousse let us build a picker that looks like it belongs on your desktop, whatever your desktop happens to be. That's exactly what we needed.

---

*(c) 2026 Liminal HQ, Scott Morris*
