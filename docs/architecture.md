# Architecture

This document describes the high-level architecture of Emoji Nook: how the pieces fit together, how data flows through the system, and how the application adapts to Linux display server environments.

## System Overview

Emoji Nook is a system-wide emoji picker that runs as a background process on Linux. It surfaces a compact overlay window on a global shortcut, lets the user search and select an emoji, then injects it into the previously focused application.

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
        end

        subgraph Backend["Backend (Rust / Tauri v2)"]
            WM[Window Manager]
            SC[Shortcut Controller]
            INJ[Emoji Injector]
            Tray[System Tray]
            Store[Settings Store]
        end

        subgraph Plugin["xdg-portal Plugin"]
            GS[Global Shortcuts]
            RD[Remote Desktop]
            TH[Theme Info]
        end
    end

    subgraph System["Linux Desktop"]
        Portal[xdg-desktop-portal]
        Compositor[Wayland / X11]
        CB[Clipboard]
    end

    KB --> SC
    SC --> WM
    WM --> Picker
    Picker --> INJ
    INJ --> APP
    Theme --> TH
    TH --> Portal
    GS --> Portal
    RD --> Portal
    INJ --> CB
    INJ --> RD
    SC --> GS
    Portal --> Compositor
    Tray --> WM
    Store --> SC
    Settings --> Store
```

## Component Architecture

### Frontend (React 19 + TypeScript)

The frontend is a single-page app rendered inside a Tauri webview. It's structured as a set of composable components around the Frimousse headless emoji picker.

```mermaid
graph TD
    App["App.tsx"]
    App --> Shell["PickerShell"]
    App --> useTheme["useTheme()"]

    Shell --> Panel["EmojiPickerPanel"]

    Panel --> SearchBar["EmojiPicker.Search"]
    Panel --> SkinTone["EmojiPicker.SkinTone"]
    Panel --> CatBar["CategoryBar"]
    Panel --> Viewport["EmojiPicker.Viewport"]
    Panel --> Footer["EmojiPicker.ActiveEmoji"]

    Viewport --> List["EmojiPicker.List"]
    List --> CatHeader["CategoryHeader"]
    List --> Row["Row"]
    Row --> Emoji["Emoji Button"]

    useTheme --> Portal["xdg-portal plugin"]
    Portal --> Tokens["CSS Custom Properties"]
    Tokens --> Shell

    style App fill:#3584e4,color:#fff
    style useTheme fill:#62a0ea,color:#fff
    style Portal fill:#e66100,color:#fff
```

### Backend (Rust / Tauri v2)

The Rust backend manages the application lifecycle, system tray, shortcut registration, and emoji injection. It delegates Linux-specific portal operations to the xdg-portal plugin.

```mermaid
graph LR
    subgraph AppCrate["emoji-picker crate"]
        Lib["lib.rs — App setup"]
        Lib --> Plugins
        Lib --> Commands

        subgraph Plugins
            Log["tauri-plugin-log"]
            Opener["tauri-plugin-opener"]
            XDG["tauri-plugin-xdg-portal"]
        end

        subgraph Commands
            InsertEmoji["insert_emoji"]
        end
    end

    subgraph PluginCrate["tauri-plugin-xdg-portal"]
        PluginLib["lib.rs — Plugin registration"]
        PluginLib --> Cmds["commands.rs"]
        PluginLib --> Linux["linux.rs"]
        Cmds --> Models["models.rs"]
        Linux --> ASHPD["ashpd (D-Bus)"]

        subgraph PortalCommands["IPC Commands"]
            CheckAvail["check_availability"]
            GetTheme["get_theme_info"]
            BindShortcut["bind_global_shortcut"]
            InjectText["inject_text"]
        end

        Cmds --> PortalCommands
    end

    XDG --> PluginLib
```

## Data Flow

### Emoji Selection Flow

> **Visual:** See the [animated pipeline diagram](images/emoji_selection_pipeline.svg) for a visual overview of this flow.

This sequence shows what happens from the moment a user picks an emoji to the moment it appears in their target application.

```mermaid
sequenceDiagram
    actor User
    participant Picker as Emoji Picker
    participant App as App.tsx
    participant Tauri as Tauri Backend
    participant Injector as Emoji Injector
    participant Target as Target App

    User->>Picker: Click / Enter on emoji
    Picker->>App: onEmojiSelect({ emoji, label })
    App->>Tauri: invoke("insert_emoji", { emoji, label })

    Note over Tauri: Future: hide window,<br/>inject into target app

    Tauri->>Injector: inject(emoji)

    alt Wayland + RemoteDesktop available
        Injector->>Target: Portal keyboard injection
    else X11 or fallback
        Injector->>Injector: Save clipboard
        Injector->>Injector: Write emoji to clipboard
        Injector->>Target: Simulate Ctrl+V
        Injector->>Injector: Restore clipboard
    end
```

### Theme Detection Flow

On startup, the frontend fetches the desktop theme from the xdg-portal plugin and injects CSS custom properties to match the native look.

```mermaid
sequenceDiagram
    participant React as useTheme Hook
    participant IPC as Tauri IPC
    participant Plugin as xdg-portal Plugin
    participant DBus as xdg-desktop-portal
    participant DOM as Document Root

    React->>IPC: invoke("get_theme_info")
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
```

## Display Server Adaptation

Emoji Nook detects the display server at startup and routes operations through the appropriate backend. This is critical because Wayland's security model prevents the direct input injection and shortcut listening that X11 allows.

```mermaid
flowchart TD
    Start([App Launch]) --> Detect{WAYLAND_DISPLAY<br/>set?}

    Detect -->|Yes| Wayland[Wayland Path]
    Detect -->|No| X11[X11 Path]

    subgraph Wayland Path
        W_SC[Global Shortcuts<br/>via xdg-portal]
        W_INJ[Emoji Injection<br/>via RemoteDesktop portal]
        W_FB[Fallback: Clipboard Shuffle<br/>via wl-clipboard]
        W_INJ -.->|on failure| W_FB
    end

    subgraph X11 Path
        X_SC[Global Shortcuts<br/>via tauri-plugin-global-shortcut]
        X_INJ[Emoji Injection<br/>via enigo / xdotool]
        X_FB[Fallback: Clipboard Shuffle<br/>via xclip]
        X_INJ -.->|on failure| X_FB
    end

    Wayland --> W_SC
    Wayland --> W_INJ
    X11 --> X_SC
    X11 --> X_INJ
```

## Window Lifecycle

The picker window has a simple three-state lifecycle. It is created once at startup and never destroyed — only shown and hidden to avoid re-creation cost.

```mermaid
stateDiagram-v2
    [*] --> Hidden: App starts

    Hidden --> Visible: Global shortcut pressed
    Hidden --> Visible: Tray → Show Picker

    Visible --> Hidden: Emoji selected
    Visible --> Hidden: Esc pressed
    Visible --> Hidden: Click outside
    Visible --> Hidden: Shortcut pressed again

    Visible --> Settings: Gear icon clicked
    Settings --> Visible: Save / Cancel

    Hidden --> [*]: Tray → Quit
```

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
        DE[Desktop Environment<br/>from XDG_CURRENT_DESKTOP]
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

## Directory Structure

```
emoji-nook/
├── apps/
│   └── emoji-picker/
│       ├── src/                    # React frontend
│       │   ├── components/         # Picker UI components
│       │   ├── hooks/              # useTheme, useSettings
│       │   └── utils/              # Logger bridge
│       └── src-tauri/              # Rust backend
│           ├── src/                # App commands and setup
│           └── capabilities/       # Tauri v2 permission grants
├── plugins/
│   └── xdg-portal/
│       ├── src/                    # Rust plugin (commands, models, linux)
│       ├── guest-js/               # TypeScript API bindings
│       ├── dist-js/                # Pre-built JS bindings
│       └── permissions/            # Plugin permission definitions
└── docs/
    ├── architecture.md             # ← You are here
    └── implementation-plans/       # Phased implementation plans
```
