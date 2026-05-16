#!/bin/bash
set -e

# ─── Wayland / display detection ──────────────────────────────────────────────
# WebKitGTK on Wayland can crash with "Error 71 (Protocol error)".
# We detect the session type and apply the safest display backend.

detect_display_backend() {
  # Explicit override
  if [ -n "$ECHOHUB_DISPLAY_BACKEND" ]; then
    echo "$ECHOHUB_DISPLAY_BACKEND"
    return
  fi

  # XDG_SESSION_TYPE is set by login managers (GDM, SDDM, LightDM)
  local session="${XDG_SESSION_TYPE:-}"

  # Fallback: check if WAYLAND_DISPLAY is set
  if [ -z "$session" ] && [ -n "$WAYLAND_DISPLAY" ]; then
    session="wayland"
  fi
  if [ -z "$session" ] && [ -n "$DISPLAY" ]; then
    session="x11"
  fi

  echo "${session:-x11}"
}

SESSION=$(detect_display_backend)

if [ "$SESSION" = "wayland" ]; then
  # Check if XWayland is available (most compositors ship it)
  if command -v Xwayland &>/dev/null || xdpyinfo -display :0 &>/dev/null 2>&1; then
    export GDK_BACKEND=x11
    export WEBKIT_DISABLE_COMPOSITING_MODE=1
    echo "[tauri-dev] Wayland session detected — using XWayland fallback"
  else
    # Pure Wayland, no XWayland: try native (experimental)
    echo "[tauri-dev] WARNING: No XWayland found. Trying native Wayland (may be unstable)."
    echo "[tauri-dev] If the window crashes, install xwayland or set ECHOHUB_DISPLAY_BACKEND=x11"
  fi
else
  # X11 or unknown — no override needed
  echo "[tauri-dev] X11 session detected"
fi

export VITE_MSW=true

cd "$(dirname "$0")"
exec cargo tauri dev
