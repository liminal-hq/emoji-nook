# Architecture

This document describes the high-level architecture of Emoji Nook: how the pieces fit together, how data flows through the system, and how the application adapts to Linux display server environments.

## System Overview

Emoji Nook is a system-wide emoji picker that runs as a background process on Linux. It surfaces a compact overlay window on a global shortcut, lets the user search and select an emoji, then injects it into the previously focused application via a clipboard shuffle technique.

<p align="center">
  <img src="images/display_server_routing.svg" alt="Display server detection and routing — Wayland vs X11 paths" width="100%">
</p>

```mermaid
graph TB
    subgraph User
        KB[Keyboard shortcut]
        APP[Target application]
    end

    subgraph EmojiNook["Emoji Nook"]
        subgraph Frontend["Frontend (React 19)"]
            Picker[Emoji Picker]
            Search[Search]
            Theme[Theme Hook]
            Settings[Settings Panel]
            SettingsHook[useSettings Hook]
        end

        subgraph Backend["Backend (Rust / Tauri v2)"]
            WM[Window Manager]
            SC[Shortcut Controller]
            INJ[Clipboard Shuffle]
            Tray[System Tray]
            Store[tauri-plugin-store]
            Auto[tauri-plugin-autostart]
        end

        subgraph Plugin["xdg-portal Plugin"]
            GS[Global Shortcuts]
            TH[Theme Info]
        end
    end

    subgraph System["Linux Desktop"]
        Portal[xdg-desktop-portal]
        Compositor[Wayland / X11]
        CB[Clipboard — arboard]
        Tools[ydotool / wtype / xdotool]
        WMHints[_NET_WM_USER_TIME / X11 activation]
    end

    KB --> SC
    SC --> WM
    WM --> Picker
    WM --> WMHints
    Picker --> INJ
    INJ --> CB
    CB --> Tools
    Tools --> APP
    Theme --> TH
    TH --> Portal
    GS --> Portal
    SC --> GS
    Portal --> Compositor
    Tray --> WM
    Store --> SettingsHook
    SettingsHook --> Settings
    SettingsHook --> SC
    Auto --> Store
```

## Component Architecture

### Frontend (React 19 + TypeScript)

The frontend is a single-page app rendered inside a Tauri webview. It's structured as a set of composable components around the Frimousse headless emoji picker, with a settings panel that replaces the picker view when open.

```mermaid
graph TD
    App["App.tsx"]
    App --> Shell["PickerShell"]
    App --> useTheme["useTheme()"]
    App --> useSettings["useSettings()"]

    App -->|view=picker| Panel["EmojiPickerPanel"]
    App -->|view=settings| SettingsPanel["SettingsPanel"]

    Panel --> SearchBar["EmojiPicker.Search"]
    Panel --> SkinTone["EmojiPicker.SkinTone"]
    Panel --> CatBar["CategoryBar"]
    Panel --> Viewport["EmojiPicker.Viewport"]
    Panel --> Footer["EmojiPicker.ActiveEmoji"]
    Panel --> Gear["Settings Gear"]

    Viewport --> List["EmojiPicker.List"]
    List --> CatHeader["CategoryHeader"]
    List --> Row["Row"]
    Row --> Emoji["Emoji Button"]

    SettingsPanel --> ShortcutCapture["Shortcut Capture"]
    SettingsPanel --> SkinTonePref["Skin Tone Select"]
    SettingsPanel --> CloseToggle["Close on Select"]
    SettingsPanel --> AutostartToggle["Autostart Toggle"]

    useTheme --> Portal["xdg-portal plugin"]
    Portal --> Tokens["CSS Custom Properties"]
    Tokens --> Shell

    useSettings --> StorePlugin["tauri-plugin-store"]
    useSettings --> Panel
    useSettings --> SettingsPanel

    style App fill:#3584e4,color:#fff
    style useTheme fill:#62a0ea,color:#fff
    style useSettings fill:#818cf8,color:#fff
    style Portal fill:#e66100,color:#fff
    style SettingsPanel fill:#2dd4bf,color:#fff
```

### Backend (Rust / Tauri v2)

The Rust backend manages the application lifecycle, system tray, shortcut registration, and emoji injection. It delegates Linux-specific portal operations to the xdg-portal plugin and X11 activation quirks to the desktop-integration plugin.

```mermaid
graph LR
    subgraph AppCrate["emoji-picker crate"]
        Lib["lib.rs — App setup"]
        Injection["injection.rs"]
        Lib --> Plugins
        Lib --> Commands

        subgraph Plugins
            Log["tauri-plugin-log"]
            Opener["tauri-plugin-opener"]
            Desktop["tauri-plugin-desktop-integration"]
            XDG["tauri-plugin-xdg-portal"]
            GlobalSC["tauri-plugin-global-shortcut"]
            StorePlugin["tauri-plugin-store"]
            Autostart["tauri-plugin-autostart"]
        end

        subgraph Commands
            InsertEmoji["insert_emoji"]
            ShowPicker["show_picker"]
            HidePicker["hide_picker"]
            UpdateShortcut["update_shortcut"]
        end

        InsertEmoji --> Injection
        Lib --> Desktop
    end

    subgraph PortalPlugin["tauri-plugin-xdg-portal"]
        PluginLib["lib.rs — Plugin registration"]
        PluginLib --> Cmds["commands.rs"]
        PluginLib --> Linux["linux.rs"]
        PluginLib --> Shortcuts["global_shortcuts.rs"]
        Cmds --> Models["models.rs"]
        Linux --> ASHPD["ashpd (D-Bus)"]
        Shortcuts --> ASHPD

        subgraph PortalCommands["IPC Commands"]
            CheckAvail["check_availability"]
            GetTheme["get_theme_info"]
        end

        Cmds --> PortalCommands
    end

    subgraph DesktopPlugin["tauri-plugin-desktop-integration"]
        DesktopLib["lib.rs — Activation helpers"]
        DesktopLib --> GTK["gtk_window() / present_with_time()"]
        DesktopLib --> X11["gdkx11 user-time + xid fallback"]
    end

    XDG --> PluginLib
    Desktop --> DesktopLib
```

## Data Flow

### Emoji Selection Pipeline

> **Visual:** See the [animated pipeline diagram](images/emoji_selection_pipeline.svg) for a visual overview of this flow.

This sequence shows what happens from the moment a user picks an emoji to the moment it appears in their target application.

```mermaid
sequenceDiagram
    actor User
    participant Picker as Emoji Picker
    participant App as App.tsx
    participant Tauri as Tauri Backend
    participant Injector as injection.rs
    participant CB as Clipboard (arboard)
    participant Tool as ydotool / wtype / xdotool
    participant Target as Target App

    User->>Picker: Click / Enter on emoji
    Picker->>App: onEmojiSelect({ emoji, label })
    App->>Tauri: invoke("insert_emoji", { emoji, label })

    Tauri->>Tauri: window.hide()
    Tauri->>Injector: std::thread::spawn → clipboard_shuffle(emoji)

    Injector->>CB: get_text() — save current contents
    Injector->>CB: set_text(emoji) — arboard serve thread active
    Note over Injector: sleep(100ms) — focus settles
    Injector->>Tool: Ctrl+V (ydotool → wtype → xdotool)
    Tool->>Target: Paste event
    Note over Injector: sleep(200ms) — paste completes
    Injector->>CB: drop() — serve thread stops
    Injector->>CB: new Clipboard → restore or clear
```

### Clipboard Shuffle Detail

> **Visual:** See the [animated clipboard shuffle diagram](images/clipboard_shuffle.svg) for a detailed visual of this flow.

The clipboard shuffle is the primary injection mechanism. It works on both Wayland and X11 by leveraging kernel-level input simulation.

```mermaid
graph LR
    subgraph Shuffle["Clipboard Shuffle (injection.rs)"]
        S1["1. Save clipboard"]
        S2["2. Write emoji"]
        S3["3. Wait 100ms"]
        S4["4. Ctrl+V"]
        S5["5. Wait 200ms"]
        S6["6. Restore / Clear"]
    end

    S1 --> S2 --> S3 --> S4 --> S5 --> S6

    subgraph Serve["arboard serve thread"]
        Active["Active: stages 2–5"]
        Dropped["Dropped after stage 5"]
    end

    S2 -.-> Active
    S5 -.-> Dropped

    subgraph PasteTool["Paste Simulation"]
        Y["ydotool (kernel uinput)"]
        W["wtype (Wayland native)"]
        X["xdotool (X11/XWayland)"]
        Y -->|fail| W -->|fail| X
    end

    S4 --> Y

    style Y fill:#2dd4bf,color:#000
    style Active fill:#fbbf24,color:#000
```

### Theme Detection Flow

> **Visual:** See the [animated theme detection diagram](images/theme_detection_flow.svg) for a visual overview of this pipeline.

The picker adapts its appearance to the host desktop environment by reading theme properties via `xdg-desktop-portal` and mapping them to CSS custom properties. Because the picker window is recreated on each activation, theme info is fetched on mount for every fresh window.

```mermaid
sequenceDiagram
    participant React as useTheme Hook
    participant IPC as Tauri IPC
    participant Plugin as xdg-portal Plugin
    participant DBus as xdg-desktop-portal
    participant DOM as Document Root

    React->>IPC: getThemeInfo() on mount
    IPC->>Plugin: get_theme_info()
    Plugin->>DBus: Settings.color_scheme()
    Plugin->>DBus: Settings.accent_color()
    Plugin->>DBus: Settings.contrast()
    Plugin->>Plugin: detect_desktop_environment()
    Plugin-->>IPC: ThemeInfo
    IPC-->>React: ThemeInfo

    React->>React: Select token set (Adwaita / Breeze)
    React->>DOM: style.setProperty(--bg-primary, ...)
    React->>DOM: style.setProperty(--accent, ...)
    React->>DOM: style.setProperty(--font-family, ...)
    React->>DOM: style.colorScheme = dark/light
```

### Settings Persistence Flow

> **Visual:** See the [animated settings diagram](images/settings_persistence.svg) for a visual overview of this flow.

Settings are persisted via `tauri-plugin-store` as a local JSON file and applied on startup and on save.

```mermaid
graph TD
    subgraph UI["Settings Panel"]
        Shortcut["Shortcut: Alt+Shift+E"]
        SkinTone["Skin tone: none"]
        Close["Close on select: true"]
        Autostart["Autostart: false"]
    end

    subgraph Hook["useSettings() Hook"]
        Load["loadSettings()"]
        Save["saveSettings()"]
        State["useState(settings)"]
    end

    subgraph Store["tauri-plugin-store"]
        JSON["settings.json"]
    end

    subgraph Effects["Side Effects on Save"]
        UpdateSC["update_shortcut IPC"]
        AutoToggle["tauri-plugin-autostart"]
        SkinApply["Apply to Frimousse"]
        ColorScheme["color-scheme CSS"]
    end

    UI -->|onSave| Save
    Save --> JSON
    JSON -->|startup| Load
    Load --> State
    State --> UI
    Save --> Effects

    UpdateSC -->|X11| ReRegister["unregister_all + on_shortcut"]
    UpdateSC -->|Wayland| Restart["Requires restart"]

    style Store fill:#fbbf24,color:#000
    style Effects fill:#2dd4bf,color:#000
```

## Display Server Adaptation

> **Visual:** See the [animated display server routing diagram](images/display_server_routing.svg) for a detailed visual of the Wayland vs X11 paths.

Emoji Nook detects the display server at startup by checking the `WAYLAND_DISPLAY` environment variable and routes operations through the appropriate backend.

```mermaid
flowchart TD
    Start([App Launch]) --> Detect{WAYLAND_DISPLAY set?}

    Detect -->|Yes| Wayland[Wayland Path]
    Detect -->|No| X11[X11 Path]

    subgraph Wayland[Wayland Path]
        W_SC["Global Shortcuts<br/>ashpd GlobalShortcuts portal<br/>bind_shortcuts() with retry"]
        W_INJ["Emoji Injection<br/>Clipboard shuffle via arboard<br/>ydotool → wtype fallback"]
    end

    subgraph X11[X11 Path]
        X_SC["Global Shortcuts<br/>tauri-plugin-global-shortcut<br/>on_shortcut() + unregister_all()"]
        X_INJ["Emoji Injection<br/>Clipboard shuffle via arboard<br/>ydotool → xdotool fallback"]
    end

    Wayland --> W_SC
    Wayland --> W_INJ
    X11 --> X_SC
    X11 --> X_INJ
```

## Window Lifecycle

> **Visual:** See the [animated window lifecycle diagram](images/window_lifecycle.svg) for an interactive state machine view.

The picker window has a simple three-state lifecycle. The app process stays resident in the tray, but the picker window itself is disposable and recreated for each activation under a fresh `picker-*` label.

```mermaid
stateDiagram-v2
    [*] --> Background: App starts in tray

    Background --> Visible: Global shortcut pressed
    Background --> Visible: Tray menu show picker

    Visible --> Background: Emoji selected
    Visible --> Background: Esc pressed
    Visible --> Background: Click outside (blur)
    Visible --> Background: New activation recreates picker window

    Visible --> Settings: Gear icon clicked
    Settings --> Visible: Save cancel or Esc

    note right of Settings
        Blur-to-close suppressed
        Native dropdowns trigger blur
    end note

    Background --> [*]: Tray quit
```

### Window Configuration

The picker window is configured as a frameless overlay template in Rust. The app starts without any picker window, and later activations create fresh `picker-*` windows with the same overlay properties:

| Property      | Value     | Purpose                            |
| ------------- | --------- | ---------------------------------- |
| Startup       | none      | Tray-first process with no window  |
| `decorations` | `false`   | Frameless                          |
| `transparent` | `true`    | Rounded corners float over desktop |
| `alwaysOnTop` | `true`    | Stays above other windows          |
| `center`      | `true`    | Centred on screen                  |
| `resizable`   | `false`   | Fixed compact size                 |
| `skipTaskbar` | `true`    | Background process, tray-only      |
| Size          | 370 x 380 | Compact picker dimensions          |

On X11, each fresh picker window is also handed to the desktop-integration plugin. The plugin asks GTK to `present_with_time(...)` and stamps `_NET_WM_USER_TIME` via `gdkx11` so Cinnamon/Muffin receives a native activation timestamp for the fresh picker window.

## Native Theming

> **Visual:** See the [animated theme detection diagram](images/theme_detection_flow.svg) for a visual overview of this pipeline.

The picker adapts its appearance to the host desktop environment by reading theme properties via `xdg-desktop-portal` and mapping them to CSS custom properties.

```mermaid
graph LR
    subgraph Portal["xdg-desktop-portal"]
        CS[Colour Scheme]
        AC[Accent Colour]
        CO[Contrast]
    end

    subgraph Detection
        DE["Desktop Environment<br/>from XDG_CURRENT_DESKTOP"]
    end

    subgraph TokenSets["Token Sets"]
        Adwaita["Adwaita Tokens<br/>GNOME · Cinnamon · MATE · XFCE"]
        Breeze["Breeze Tokens<br/>KDE Plasma"]
    end

    subgraph CSSProps["CSS Custom Properties"]
        BG["--bg-primary<br/>--bg-surface"]
        Text["--text-primary<br/>--text-secondary"]
        Accent["--accent"]
        Shape["--radius-sm<br/>--radius-md<br/>--shadow"]
        Font["--font-family"]
        ColorScheme["color-scheme (dark/light)"]
    end

    CS --> TokenSets
    AC --> Accent
    CO --> TokenSets
    DE --> TokenSets

    Adwaita --> CSSProps
    Breeze --> CSSProps

    style Adwaita fill:#3584e4,color:#fff
    style Breeze fill:#2980b9,color:#fff
```

Theme info is fetched whenever a fresh picker window mounts. The `color-scheme` CSS property is set on the document root so native form controls (selects, checkboxes) match the detected theme.

## System Tray

The app provides a system tray icon with a context menu:

- **Show Picker** — recreates and focuses a fresh picker window
- **Quit** — exits the application

The tray uses the default app icon and the tooltip "Emoji Nook". The tray provides a fallback for showing the picker when global shortcuts are unavailable (e.g. portal permission denied on Wayland).

## Directory Structure

```
emoji-nook/
├── apps/
│   └── emoji-picker/
│       ├── src/                    # React frontend
│       │   ├── components/         # UI components
│       │   │   ├── EmojiPickerPanel.tsx   # Main picker (Frimousse)
│       │   │   ├── PickerShell.tsx        # Compact container
│       │   │   ├── CategoryBar.tsx        # Category tab bar
│       │   │   └── SettingsPanel.tsx       # Settings UI
│       │   ├── hooks/              # React hooks
│       │   │   ├── useTheme.ts            # Portal theme detection
│       │   │   └── useSettings.ts         # Settings persistence
│       │   ├── utils/              # Logger bridge
│       │   ├── App.tsx             # Root view, view routing, lifecycle
│       │   └── App.css             # All styles + CSS custom properties
│       └── src-tauri/              # Rust backend
│           ├── src/
│           │   ├── lib.rs                 # Setup, tray, shortcuts, commands
│           │   └── injection.rs           # Clipboard shuffle
│           └── capabilities/              # Tauri v2 permission grants
├── plugins/
│   ├── desktop-integration/
│   │   └── src/                    # Rust plugin
│   │       └── lib.rs              # X11 activation + user-time helpers
│   └── xdg-portal/
│       ├── src/                    # Rust plugin
│       │   ├── lib.rs                     # Plugin registration
│       │   ├── commands.rs                # IPC commands
│       │   ├── models.rs                  # ThemeInfo, Availability types
│       │   ├── linux.rs                   # ashpd D-Bus integration
│       │   ├── global_shortcuts.rs        # Portal shortcut session
│       │   └── remote_desktop.rs          # (stub) Future use
│       ├── guest-js/               # TypeScript API bindings
│       ├── dist-js/                # Pre-built JS bindings
│       └── permissions/            # Plugin permission definitions
├── docs/
│   ├── architecture.md             # ← You are here
│   ├── linux-setup.md              # System dependency setup guide
│   ├── images/                     # Animated SVG diagrams
│   └── implementation-plans/       # Phased implementation plans
└── scripts/
    └── setup-linux.sh              # Auto-install script
```

## Key Dependencies

| Layer           | Library                                                   | Purpose                                 |
| --------------- | --------------------------------------------------------- | --------------------------------------- |
| Emoji           | [Frimousse](https://github.com/liveblocks/frimousse) v0.3 | Headless React 19 emoji picker          |
| Portal          | [ashpd](https://github.com/bilelmoussaoui/ashpd)          | D-Bus interface to `xdg-desktop-portal` |
| Framework       | [Tauri](https://v2.tauri.app/) v2                         | Desktop application shell               |
| Clipboard       | [arboard](https://crates.io/crates/arboard)               | Cross-platform clipboard access         |
| Settings        | tauri-plugin-store                                        | Persistent JSON key-value store         |
| Autostart       | tauri-plugin-autostart                                    | XDG autostart desktop file management   |
| Shortcuts (X11) | tauri-plugin-global-shortcut                              | X11 global shortcut registration        |
| Activation      | tauri-plugin-desktop-integration                          | Native X11 user-time activation         |
| Logging         | tauri-plugin-log                                          | Structured logging with console bridge  |

### Runtime Dependencies

Emoji injection requires a keystroke simulation tool:

| Tool      | Scope                             | Mechanism               |
| --------- | --------------------------------- | ----------------------- |
| `ydotool` | Primary — works everywhere        | Kernel `/dev/uinput`    |
| `wtype`   | Wayland fallback (Sway, Hyprland) | Native Wayland protocol |
| `xdotool` | X11/XWayland fallback             | X11 protocol            |

## Known Limitations

- **Window dragging** does not work on WebKitGTK — see [#5](https://github.com/liminal-hq/emoji-nook/issues/5)
- **Wayland shortcut changes** require app restart (portal session cannot be re-bound dynamically)
- **Wayland shortcut from non-IDE terminals** may fail due to D-Bus session context differences
- **Live theme changes** are not detected in real-time — theme is re-fetched on each picker show
- **RemoteDesktop portal injection** is deferred — clipboard shuffle is used for all injection
