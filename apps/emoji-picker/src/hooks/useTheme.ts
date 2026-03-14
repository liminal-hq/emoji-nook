// Fetches desktop theme info from the xdg-portal plugin and injects CSS custom properties
//
// (c) Copyright 2026 Liminal HQ, Scott Morris
// SPDX-License-Identifier: Apache-2.0 OR MIT

import { useEffect, useState } from "react";
import { portal } from "tauri-plugin-xdg-portal";
import type { ThemeInfo, DesktopEnvironment } from "tauri-plugin-xdg-portal";

/** Convert 0.0–1.0 sRGB to hex colour string. */
function rgbToHex(r: number, g: number, b: number): string {
  const toHex = (v: number) =>
    Math.round(Math.max(0, Math.min(1, v)) * 255)
      .toString(16)
      .padStart(2, "0");
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
}

/** Style tokens for Adwaita-like desktops (GNOME, Cinnamon, MATE, XFCE). */
function adwaitaTokens(isDark: boolean, accent?: string) {
  const a = accent ?? (isDark ? "#62a0ea" : "#3584e4");
  return {
    "--bg-primary": isDark ? "#242424" : "#fafafa",
    "--bg-surface": isDark ? "#303030" : "#ffffff",
    "--bg-hover": isDark ? "rgba(255,255,255,0.08)" : "rgba(0,0,0,0.06)",
    "--bg-active": isDark ? "rgba(255,255,255,0.14)" : "rgba(0,0,0,0.10)",
    "--text-primary": isDark ? "#f0f0f0" : "#1a1a1a",
    "--text-secondary": isDark ? "#aaaaaa" : "#666666",
    "--text-tertiary": isDark ? "#777777" : "#999999",
    "--accent": a,
    "--border": isDark ? "rgba(255,255,255,0.10)" : "rgba(0,0,0,0.12)",
    "--radius-sm": "8px",
    "--radius-md": "12px",
    "--shadow": isDark
      ? "0 2px 12px rgba(0,0,0,0.4), 0 0 0 1px rgba(255,255,255,0.06)"
      : "0 2px 8px rgba(0,0,0,0.12), 0 0 0 1px rgba(0,0,0,0.06)",
    "--font-family": '"Cantarell", "Noto Sans", system-ui, sans-serif',
  };
}

/** Style tokens for Breeze-like desktops (KDE Plasma). */
function breezeTokens(isDark: boolean, accent?: string) {
  const a = accent ?? (isDark ? "#63beff" : "#2980b9");
  return {
    "--bg-primary": isDark ? "#1b1e20" : "#eff0f1",
    "--bg-surface": isDark ? "#232629" : "#ffffff",
    "--bg-hover": isDark ? "rgba(255,255,255,0.07)" : "rgba(0,0,0,0.05)",
    "--bg-active": isDark ? "rgba(255,255,255,0.12)" : "rgba(0,0,0,0.09)",
    "--text-primary": isDark ? "#eff0f1" : "#232629",
    "--text-secondary": isDark ? "#bdc3c7" : "#7f8c8d",
    "--text-tertiary": isDark ? "#7f8c8d" : "#bdc3c7",
    "--accent": a,
    "--border": isDark ? "rgba(255,255,255,0.08)" : "rgba(0,0,0,0.10)",
    "--radius-sm": "4px",
    "--radius-md": "6px",
    "--shadow": isDark
      ? "0 1px 6px rgba(0,0,0,0.5), 0 0 0 1px rgba(255,255,255,0.04)"
      : "0 1px 4px rgba(0,0,0,0.10), 0 0 0 1px rgba(0,0,0,0.05)",
    "--font-family": '"Noto Sans", "Segoe UI", system-ui, sans-serif',
  };
}

function getTokens(de: DesktopEnvironment, isDark: boolean, accent?: string) {
  if (de === "kde") return breezeTokens(isDark, accent);
  return adwaitaTokens(isDark, accent);
}

function applyTokens(tokens: Record<string, string>) {
  const root = document.documentElement;
  for (const [key, value] of Object.entries(tokens)) {
    root.style.setProperty(key, value);
  }
}

export function useTheme() {
  const [theme, setTheme] = useState<ThemeInfo | null>(null);

  useEffect(() => {
    portal
      .getThemeInfo()
      .then((info) => {
        console.info("theme info:", info);
        setTheme(info);

        const isDark =
          info.colourScheme === "prefer-dark" ||
          (info.colourScheme === "no-preference" &&
            window.matchMedia("(prefers-color-scheme: dark)").matches);
        const accent = info.accentColour
          ? rgbToHex(info.accentColour.r, info.accentColour.g, info.accentColour.b)
          : undefined;

        const tokens = getTokens(info.desktopEnvironment, isDark, accent);
        applyTokens(tokens);
      })
      .catch((err) => {
        console.warn("failed to fetch theme info, using CSS defaults:", err);
      });
  }, []);

  return theme;
}
