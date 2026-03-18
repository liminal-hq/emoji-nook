# Native Desktop Theming in a Tauri v2 App on Linux

**TL;DR** — We built a pipeline that queries `xdg-desktop-portal` over D-Bus, detects the desktop environment, and injects CSS custom properties so a Tauri v2 app matches GNOME Adwaita or KDE Breeze — dark or light, with the user's accent colour — without shipping a single hardcoded colour value.

---

<!-- TODO: screenshot — side-by-side of the picker on GNOME dark Adwaita vs KDE Breeze light -->

## The Problem

Most cross-platform desktop apps ignore the host system's theme. They ship a fixed design — usually something vaguely macOS-flavoured — and call it done. On macOS and Windows this is barely tolerable because each platform has one dominant visual language. On Linux it's jarring.

Linux has GNOME, KDE Plasma, XFCE, Cinnamon, MATE, and a constellation of tiling window managers. Each has its own visual language: different background colours, different corner radii, different typefaces, different shadow styles. A dark-mode GNOME desktop running Adwaita looks nothing like a dark-mode KDE desktop running Breeze. An app that ignores this sticks out.

You might think `prefers-color-scheme` solves the dark/light distinction. It does not — at least not reliably. Tauri v2 on Linux renders through WebKitGTK, and WebKitGTK does not always reflect the portal's colour scheme preference in its `prefers-color-scheme` media query. On some setups it works. On others it returns `light` regardless of your desktop settings. You cannot depend on it as your only signal.

We needed something more reliable and more expressive — not just dark-or-light, but *which flavour* of dark-or-light.

## The Architecture: Portal to CSS

The full pipeline from desktop setting to rendered pixel looks like this:

```
xdg-desktop-portal (D-Bus)
    ↓
ashpd crate queries Settings interface
    ↓
Rust plugin reads colour_scheme, accent_color, contrast
    ↓
Rust detects desktop environment from XDG_CURRENT_DESKTOP
    ↓
ThemeInfo struct returned over Tauri IPC
    ↓
React useTheme hook receives ThemeInfo
    ↓
Token set selected (Adwaita or Breeze) based on DE
    ↓
CSS custom properties applied to document.documentElement
    ↓
All components consume --bg-primary, --accent, etc.
```

No component in the frontend knows what desktop it is running on. No component knows whether the theme is dark or light. Every component simply reads CSS custom properties, and the theming pipeline fills those properties with the right values.

### Step 1: Querying the Portal (Rust)

The Rust plugin uses `ashpd`, a Rust crate that provides typed bindings to `xdg-desktop-portal`'s D-Bus interfaces. The `get_theme_info` function queries three settings:

```rust
let settings = ashpd::desktop::settings::Settings::new()
    .await
    .map_err(|e| PortalError::Internal(e.to_string()))?;

// Colour scheme: 0 = no preference, 1 = prefer dark, 2 = prefer light
let colour_scheme = match settings.color_scheme().await {
    Ok(ashpd::desktop::settings::ColorScheme::PreferDark) => ColourScheme::PreferDark,
    Ok(ashpd::desktop::settings::ColorScheme::PreferLight) => ColourScheme::PreferLight,
    _ => ColourScheme::NoPreference,
};

// Accent colour: (r, g, b) tuple in 0.0–1.0 sRGB range
let accent_colour = settings.accent_color().await.ok().map(|c| AccentColour {
    r: c.red(),
    g: c.green(),
    b: c.blue(),
});

// Contrast: 0 = normal, 1 = high
let high_contrast = settings
    .contrast()
    .await
    .map(|c| c == ashpd::desktop::settings::Contrast::High)
    .unwrap_or(false);
```

Desktop environment detection is a simple `XDG_CURRENT_DESKTOP` parse. The variable can be colon-separated (Ubuntu sets it to `ubuntu:GNOME`), so we check for substring matches:

```rust
pub fn detect_desktop_environment() -> DesktopEnvironment {
    let desktop = std::env::var("XDG_CURRENT_DESKTOP").unwrap_or_default();
    let desktop_upper = desktop.to_uppercase();

    if desktop_upper.contains("GNOME") {
        DesktopEnvironment::Gnome
    } else if desktop_upper.contains("KDE") {
        DesktopEnvironment::Kde
    } else if desktop_upper.contains("CINNAMON") || desktop_upper.contains("X-CINNAMON") {
        DesktopEnvironment::Cinnamon
    } else if desktop_upper.contains("MATE") {
        DesktopEnvironment::Mate
    } else if desktop_upper.contains("XFCE") {
        DesktopEnvironment::Xfce
    } else {
        DesktopEnvironment::Unknown
    }
}
```

Everything is bundled into a `ThemeInfo` struct and returned over Tauri IPC:

```rust
pub struct ThemeInfo {
    pub colour_scheme: ColourScheme,        // prefer-dark, prefer-light, no-preference
    pub accent_colour: Option<AccentColour>, // sRGB floats, absent if DE doesn't report one
    pub high_contrast: bool,
    pub desktop_environment: DesktopEnvironment, // gnome, kde, cinnamon, mate, xfce, unknown
}
```

### Step 2: Selecting Tokens (TypeScript)

On the frontend, the `useTheme` hook calls `portal.getThemeInfo()` and selects a token set based on the desktop environment. The mapping is straightforward: KDE gets Breeze tokens, everything else gets Adwaita tokens.

```typescript
function getTokens(de: DesktopEnvironment, isDark: boolean, accent?: string) {
    if (de === 'kde') return breezeTokens(isDark, accent);
    return adwaitaTokens(isDark, accent);
}
```

### Step 3: Applying Properties

The selected tokens are written directly onto `document.documentElement` as inline styles:

```typescript
function applyTokens(tokens: Record<string, string>) {
    const root = document.documentElement;
    for (const [key, value] of Object.entries(tokens)) {
        root.style.setProperty(key, value);
    }
}
```

Inline styles on `:root` override the CSS-file defaults. The components never need to change — they always read from the same custom property names.

## Two Token Sets

The two token sets encode the visual language of each desktop environment. Here are the actual values from the codebase.

### Adwaita (GNOME, Cinnamon, MATE, XFCE)

| Property | Dark | Light |
|----------|------|-------|
| `--bg-primary` | `#242424` | `#fafafa` |
| `--bg-surface` | `#303030` | `#ffffff` |
| `--bg-hover` | `rgba(255,255,255,0.08)` | `rgba(0,0,0,0.06)` |
| `--bg-active` | `rgba(255,255,255,0.14)` | `rgba(0,0,0,0.10)` |
| `--text-primary` | `#f0f0f0` | `#1a1a1a` |
| `--text-secondary` | `#aaaaaa` | `#666666` |
| `--text-tertiary` | `#777777` | `#999999` |
| `--accent` | `#62a0ea` (default) | `#3584e4` (default) |
| `--border` | `rgba(255,255,255,0.10)` | `rgba(0,0,0,0.12)` |
| `--radius-sm` | `8px` | `8px` |
| `--radius-md` | `12px` | `12px` |
| `--font-family` | `"Cantarell", "Noto Sans", system-ui, sans-serif` | same |

Shadows are softer: `0 2px 12px rgba(0,0,0,0.4)` in dark mode, `0 2px 8px rgba(0,0,0,0.12)` in light. Both include a subtle `0 0 0 1px` ring for definition.

<!-- TODO: screenshot — picker with Adwaita dark tokens applied -->

### Breeze (KDE Plasma)

| Property | Dark | Light |
|----------|------|-------|
| `--bg-primary` | `#1b1e20` | `#eff0f1` |
| `--bg-surface` | `#232629` | `#ffffff` |
| `--bg-hover` | `rgba(255,255,255,0.07)` | `rgba(0,0,0,0.05)` |
| `--bg-active` | `rgba(255,255,255,0.12)` | `rgba(0,0,0,0.09)` |
| `--text-primary` | `#eff0f1` | `#232629` |
| `--text-secondary` | `#bdc3c7` | `#7f8c8d` |
| `--text-tertiary` | `#7f8c8d` | `#bdc3c7` |
| `--accent` | `#63beff` (default) | `#2980b9` (default) |
| `--border` | `rgba(255,255,255,0.08)` | `rgba(0,0,0,0.10)` |
| `--radius-sm` | `4px` | `4px` |
| `--radius-md` | `6px` | `6px` |
| `--font-family` | `"Noto Sans", "Segoe UI", system-ui, sans-serif` | same |

Breeze shadows are crisper and tighter: `0 1px 6px` instead of `0 2px 12px`. The corner radii are noticeably smaller — 4px/6px vs 8px/12px — reflecting Plasma's more geometric aesthetic.

<!-- TODO: screenshot — picker with Breeze dark tokens applied -->

Both token sets accept an accent colour override from the portal. If the portal reports one (GNOME 47+ and recent Plasma versions do), it replaces the default. If it does not, each set falls back to a sensible default that matches the DE's stock accent.

## The `no-preference` Problem

The portal's `color_scheme()` returns one of three values: `prefer-dark`, `prefer-light`, or `no-preference`. Early in development, when the hook received `no-preference`, it fell through to light mode. This seemed reasonable — `no-preference` should mean the user hasn't expressed an opinion, so pick a neutral default.

It was wrong.

On many desktop configurations, particularly older GNOME setups and some XFCE environments, the portal returns `no-preference` even when the user is running a dark theme. The portal simply does not expose the preference. Falling through to light mode meant the picker appeared with a blinding white background on a dark desktop.

The fix was to use `window.matchMedia` as a secondary signal:

```typescript
const isDark =
    info.colourScheme === 'prefer-dark' ||
    (info.colourScheme === 'no-preference' &&
        window.matchMedia('(prefers-color-scheme: dark)').matches);
```

If the portal says `prefer-dark`, trust it. If the portal says `no-preference`, ask WebKitGTK via `matchMedia`. It is not perfectly reliable (as mentioned earlier), but it is more likely to reflect the actual desktop state than a blind default to light. And if `matchMedia` also returns `light` on a dark desktop, the user at least gets a coherent light theme rather than a random mismatch.

This was caught during code review. It is exactly the kind of subtle platform behaviour that is hard to predict without testing across multiple desktop environments.

## Re-fetching on Show

Theme information is fetched twice: once on mount, and once every time the picker is shown.

```typescript
// Fetch on mount
useEffect(() => {
    fetchAndApply();
}, [fetchAndApply]);

// Re-fetch when the picker is shown — catches theme changes
// between hide/show cycles without needing a live portal listener
useEffect(() => {
    const unlisten = listen('picker-shown', () => {
        fetchAndApply();
    });
    return () => {
        unlisten.then((fn) => fn());
    };
}, [fetchAndApply]);
```

The Tauri backend emits a `picker-shown` event every time the picker window becomes visible. The `useTheme` hook listens for this event and re-queries the portal.

Why not a live listener? Because the picker is hidden most of the time. It pops up for a few seconds, the user picks an emoji, and it disappears. Setting up a persistent D-Bus signal listener for `SettingChanged` — keeping it alive, reconnecting on portal crashes, debouncing rapid changes — adds complexity for a scenario that almost never occurs while the picker is visible. Re-fetching on show is simpler and catches every theme change that matters: the ones that happen between uses.

If the user switches from light to dark mode while the picker is hidden, opens the picker, it queries the portal, gets the new colour scheme, selects the right tokens, and applies them. The user sees the correct theme immediately. No flicker, no stale state.

## The `color-scheme` CSS Property

There is one more line in the theme hook that is easy to overlook but important:

```typescript
document.documentElement.style.colorScheme = isDark ? 'dark' : 'light';
```

This sets the CSS `color-scheme` property on the root element. It tells the browser rendering engine which colour scheme the page is using. Without it, native form controls — `<select>` dropdowns, checkboxes, scrollbars, text input carets — render using the browser's default scheme, which is typically light.

The result without `color-scheme: dark` is a dark-themed app with bright white scrollbar tracks, light dropdown menus, and checkboxes that look like they belong on a different page entirely. Setting the property ensures that all native controls follow the app's theme. WebKitGTK respects this property and renders dark scrollbars, dark dropdowns, and dark checkboxes when it is set to `dark`.

## CSS Custom Properties: The Full Set

The complete set of custom properties consumed by the app:

| Property | Purpose | Example (Adwaita dark) |
|----------|---------|----------------------|
| `--bg-primary` | Page/panel background | `#242424` |
| `--bg-surface` | Card/elevated surface background | `#303030` |
| `--bg-hover` | Hover state overlay | `rgba(255,255,255,0.08)` |
| `--bg-active` | Active/pressed state overlay | `rgba(255,255,255,0.14)` |
| `--text-primary` | Body text | `#f0f0f0` |
| `--text-secondary` | Secondary labels, descriptions | `#aaaaaa` |
| `--text-tertiary` | Placeholders, disabled text | `#777777` |
| `--accent` | Interactive elements, focus rings | `#62a0ea` |
| `--border` | Borders, dividers | `rgba(255,255,255,0.10)` |
| `--radius-sm` | Small element corners (buttons, inputs) | `8px` |
| `--radius-md` | Larger element corners (panels, cards) | `12px` |
| `--shadow` | Elevation shadow | `0 2px 12px rgba(0,0,0,0.4), ...` |
| `--font-family` | Typeface stack | `"Cantarell", ...` |

The CSS file (`App.css`) provides fallback values for every property using `:root` defaults and a `@media (prefers-color-scheme: dark)` block:

```css
:root {
    --bg-primary: #fafafa;
    --bg-surface: #ffffff;
    --text-primary: #1a1a1a;
    --accent: #3584e4;
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

If the portal is unavailable — the user is on a minimal window manager without a portal daemon, or the D-Bus query fails — the `useTheme` hook logs a warning and does nothing. The CSS defaults take over, and `prefers-color-scheme` provides basic dark/light adaptation. The app degrades gracefully from "matches your exact DE" to "respects dark/light" to "looks reasonable" — never crashes, never renders broken.

<!-- TODO: screenshot — fallback rendering on a minimal WM without portal -->

## A Pattern for Other Apps

This approach is not specific to Emoji Nook. Any Tauri or Electron app on Linux can implement the same pipeline:

1. **Query the portal** — use `ashpd` (Rust), `libportal` (C/Vala), or raw D-Bus calls to read `org.freedesktop.appearance` settings.
2. **Detect the desktop environment** — read `XDG_CURRENT_DESKTOP` and classify it.
3. **Select a token set** — map the DE family to a set of design tokens that match its visual language.
4. **Inject as CSS custom properties** — apply them to the document root, overriding defaults.
5. **Set `color-scheme`** — so native controls follow along.
6. **Fall back gracefully** — if the portal is not available, rely on `prefers-color-scheme` and sensible defaults.

The key insight is that **you need both the colour scheme and the desktop environment** to get the visual language right. Knowing that the user wants dark mode is not enough. Dark GNOME uses `#242424` backgrounds, Cantarell, and 12px corners. Dark KDE uses `#1b1e20`, Noto Sans, and 4px corners. An app that picks the right darkness level but the wrong shape language still feels foreign.

The portal gives you the colour scheme. The environment variable gives you the visual family. Together, they let you build something that blends in.

---

*(c) 2026 Liminal HQ, Scott Morris*
