# Project Specification: Tauri Global Emoji Picker

## 1. Overview

The goal of this project is to build a lightweight, system-wide emoji picker using Tauri. The application will run in the background with a minimal memory footprint. When a user triggers a global keyboard shortcut, a frameless window will appear centred on the screen, allowing them to search for and select an emoji. Upon selection, the window will hide, and the chosen emoji will be automatically injected into the previously focused application's text field.

This project is structured as a workspace, concurrently developing a custom Tauri plugin (`tauri-plugin-xdg-portal`) to handle the strict security requirements of modern Linux Wayland environments.

## 2. Tech Stack & Dependencies

- **Framework:** Tauri (v2 recommended)
- **Backend:** Rust
  - `tauri` (Core features: `tray-icon`, `image-png` or `image-ico`): For system tray support to keep the app running in the background.
  - `tauri-plugin-global-shortcut`: For listening to system-wide key presses on X11, macOS, and Windows.
  - `tauri-plugin-store`: For persisting user preferences, such as custom shortcut keybindings.
  - `tauri-plugin-xdg-portal` (Custom Workspace Plugin): Bridges Tauri with the Linux `xdg-desktop-portal` D-Bus interfaces via `ashpd`. Used specifically on Wayland for secure global shortcuts and input injection.
  - `enigo`: For simulating keyboard events (injecting the emoji or triggering paste) on non-Wayland environments.
  - `arboard`: For interacting with the system clipboard (if using the "clipboard shuffle" injection method).
- **Frontend:** React 19 (with TypeScript)
  - _Emoji Library:_ `emoji-mart` (handles rendering, categorisation, and search logic out of the box).
- **Linux Specific Build Dependencies:**
  - Base: `libwebkit2gtk-4.1-dev`, `build-essential`, `curl`, `wget`, `file`, `libssl-dev`, `libgtk-3-dev`, `libayatana-appindicator3-dev`, `librsvg2-dev`
  - X11 / `enigo`: `libxdo-dev` (requires `xdotool` at runtime).
  - Wayland Clipboard: `wl-clipboard` (required at runtime for `arboard` on Wayland).

## 3. Core Behaviours & User Flow

1. **Launch:** The application starts in the background. No window is immediately visible to the user. A system tray icon will appear to indicate the app is active and listening for shortcuts.
2. **Activation:** The user presses a registered global shortcut (e.g., `Alt + Shift + E`).
3. **Display:** The Tauri window becomes visible, centres itself on the screen, and requests system focus.
4. **Interaction:**
   - The search input within the emoji picker is immediately autofocused.
   - The user types to filter emojis or uses the mouse/arrow keys to navigate.
   - A gear icon is visible on the main UI. Clicking this triggers a "flip" animation, transitioning the window to a mini settings panel where the user can adjust preferences (e.g., modifying the global keybinding).
5. **Selection:** The user presses `Enter` or clicks an emoji.
6. **Injection:**
   - The frontend sends the selected emoji character to the Rust backend via IPC.
   - The Tauri window hides itself.
   - Focus is automatically returned by the OS to the previously active application.
   - The Rust backend injects the emoji into the active text field.
7. **Termination:** The user right-clicks the system tray icon and selects "Quit" to fully exit the background process.

## 4. Technical Implementation Details

### 4.1 Window Configuration (`tauri.conf.json`)

The main window must be configured to act as an overlay rather than a standard application window.

- `visible`: `false` (Hidden on startup)
- `decorations`: `false` (Frameless)
- `transparent`: `true` (Allows for rounded corners and shadow effects via CSS)
- `alwaysOnTop`: `true` (Ensures it appears above the current working window)
- `center`: `true`

### 4.2 Settings & Configuration

- **Persistence:** Use `tauri-plugin-store` to manage a local JSON configuration file. This will store the user's preferred global shortcut and any future settings.
- **UI State:** The React 19 frontend will manage the state of the active view. Triggering the settings gear will unmount/hide `emoji-mart` and display a shortcut-capture input component, wrapped in a CSS transform to create the flip effect. When saved, the new shortcut will be pushed to the Rust backend to re-register the global listener.

### 4.3 Rust Backend Responsibilities

- **System Tray Management:** Use `TrayIconBuilder` to create a system tray icon with a simple context menu (e.g., "Quit", "Settings"). Listen for the "Quit" event to gracefully terminate the application.
- **Global Shortcut Registration:** Initialise the shortcut listener on startup by reading the saved combination from the Tauri store. Dynamically route this to `tauri-plugin-global-shortcut` or `tauri-plugin-xdg-portal` based on the display server.
- **IPC Commands:** Expose commands for inserting emojis, updating settings, and window management.
- **Window Management:** Handle the `hide()` command swiftly to ensure the OS hands focus back to the target application. Ensure closing the window via `Esc` merely hides it rather than terminating the process.
- **Text Injection Logic (The "Clipboard Shuffle" Fallback):** If direct input injection fails or is unsupported:
  1. Read current clipboard contents and store them in memory.
  2. Write the selected emoji to the clipboard.
  3. Introduce a small delay (e.g., 50ms) to ensure the target window has regained focus.
  4. Use `enigo` (or Wayland alternatives) to simulate `Ctrl + V` (Windows/Linux) or `Cmd + V` (macOS).
  5. Introduce another small delay.
  6. Restore the original clipboard contents.

## 5. Linux Architecture: Wayland vs. X11

Linux presents unique challenges due to the co-existence of X11 (the legacy display server) and Wayland (the modern, security-focused display server protocol). The application must account for both compositors dynamically.

### 5.1 Wayland Considerations (Primary Target)

Wayland's core design isolates applications. An application cannot inherently listen to inputs directed at other windows (preventing keyloggers) nor inject inputs into them (preventing malicious control).

- **Global Shortcuts:**
  - `tauri-plugin-global-shortcut` relies on legacy APIs that often fail or are ignored by Wayland compositors (like GNOME's Mutter or KDE's KWin).
  - _Modern Solution:_ Utilise the custom workspace plugin `tauri-plugin-xdg-portal`. It interfaces with `org.freedesktop.portal.GlobalShortcuts` via `ashpd`, allowing the app to request global shortcut registrations securely under Wayland's strict protocol. The OS will handle prompting the user for permission.
- **Input Injection (Typing/Pasting):**
  - `enigo` cannot natively inject keystrokes into Wayland without specific backends or root-level daemons (like `ydotool`).
  - _Modern Solution:_ Utilise `tauri-plugin-xdg-portal` to interact with `org.freedesktop.portal.RemoteDesktop`. This allows the app to request a session to inject keyboard events securely into the Wayland compositor, bypassing restricted virtual keyboard protocols.
  - _Fallback Clipboard Strategy:_ Updating the clipboard using Wayland protocols (via `arboard` utilizing `wl-clipboard`), and then prompting the user to manually paste.

### 5.2 X11 Considerations (Fallback/Co-existence)

X11 lacks the strict isolation of Wayland, making it significantly easier to develop for, though it is being phased out by major distributions.

- **Global Shortcuts:** `tauri-plugin-global-shortcut` will generally work out-of-the-box, easily capturing keys regardless of which window is focused.
- **Input Injection:** `enigo` works reliably on X11 by utilizing `xdotool` under the hood to simulate both direct character typing and `Ctrl+V` combinations.
- **Clipboard:** `arboard` interacts smoothly with the X11 clipboard via `xclip` or `xsel`.

### 5.3 Recommended Linux Strategy

1. **Detection:** Upon launch, the Rust backend should detect the display server by checking environment variables (e.g., `std::env::var("WAYLAND_DISPLAY")`).
2. **Dynamic Behaviour:**
   - If `WAYLAND_DISPLAY` is present, route global shortcuts and input injection entirely through `tauri-plugin-xdg-portal`.
   - If X11 is detected, proceed with the standard `enigo`/`xdotool` and `tauri-plugin-global-shortcut` pipeline.

## 6. Known Challenges & Edge Cases

- **Focus Race Conditions:** If the backend simulates the paste command before the OS has fully returned focus to the original application, the emoji will be lost. Tuning the delay between `window.hide()` and the keystroke simulation will be critical.
- **OS Permissions:** macOS will require "Accessibility" permissions to simulate keystrokes. Wayland will require the user to accept a portal prompt.
- **Tiling Window Managers:** On Linux (e.g., Sway, i3), hiding a window might not predictably return focus to the previous application; it might focus the next window in the layout stack.

## 7. Development Milestones

- [ ] **Phase 1: Workspace & Foundation.** Scaffold a generic Tauri workspace. Initialize the emoji picker Tauri project with React 19, configure the frameless/transparent window, and implement the frontend `emoji-mart` UI. Add the `tray-icon` feature.
- [ ] **Phase 2: Custom XDG Portal Plugin.** Develop `tauri-plugin-xdg-portal` within the workspace. Integrate `ashpd` to support the `GlobalShortcuts` and `RemoteDesktop` portals for Wayland support.
- [ ] **Phase 3: Settings & Persistence.** Build the "flip" settings UI in React. Integrate `tauri-plugin-store` to capture, save, and load a custom keybinding.
- [ ] **Phase 4: Activation.** Integrate `tauri-plugin-global-shortcut` (for X11/macOS/Windows) and the custom `tauri-plugin-xdg-portal` (for Wayland) to show/hide the window using the stored keybinding. Implement `Esc` to close.
- [ ] **Phase 5: Communication.** Set up IPC to pass the selected emoji from the frontend to Rust and subsequently hide the window.
- [ ] **Phase 6: Injection.** Implement text injection utilizing `enigo` (X11/macOS/Windows) and `tauri-plugin-xdg-portal`'s Remote Desktop interface (Wayland). Implement clipboard fallback logic if needed.
- [ ] **Phase 7: Polish.** Refine focus delays, handle OS permission edge cases gracefully, and finalise the system tray menu.
