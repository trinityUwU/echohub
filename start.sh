#!/bin/bash
set -e

# ─────────────────────────────────────────────────────────────────────────────
# EchoHub — Universal start script
# Works on: Ubuntu/Debian, Arch Linux, Fedora, macOS
# Usage: ./start.sh          → production build + launch
#        ./start.sh --dev    → dev mode (hot reload)
#        ./start.sh --stop   → stop all processes
# ─────────────────────────────────────────────────────────────────────────────

DEV_MODE=false
[[ "$1" == "--dev" ]] && DEV_MODE=true
[[ "$1" == "--stop" ]] && { ./stop.sh; exit 0; }

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
LOG="$ROOT/logs"
mkdir -p "$LOG" "$HOME/.local/share/echohub/vllm-envs"

# ── Colors ────────────────────────────────────────────────────────────────────
RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'
BLUE='\033[0;34m'; BOLD='\033[1m'; RESET='\033[0m'

log_step() { echo -e "\n${BOLD}${BLUE}▶ $1${RESET}"; }
log_ok()   { echo -e "  ${GREEN}✓${RESET} $1"; }
log_warn() { echo -e "  ${YELLOW}⚠${RESET} $1"; }
log_err()  { echo -e "  ${RED}✗${RESET} $1"; }

echo -e "${BOLD}EchoHub — Starting up${RESET}"
echo -e "────────────────────────────────────────"

# ── Detect OS ─────────────────────────────────────────────────────────────────
detect_os() {
    if [[ -f /etc/arch-release ]]; then echo "arch"
    elif [[ -f /etc/debian_version ]]; then echo "debian"
    elif [[ -f /etc/fedora-release ]]; then echo "fedora"
    elif [[ "$(uname)" == "Darwin" ]]; then echo "macos"
    else echo "unknown"
    fi
}
OS=$(detect_os)
log_step "Detected OS: $OS"

# ── Install system dependencies ───────────────────────────────────────────────
install_deps() {
    log_step "Checking system dependencies"
    case "$OS" in
        arch)
            PKGS="base-devel cmake webkit2gtk-4.1 gtk3 libayatana-appindicator openssl librsvg python"
            for pkg in $PKGS; do
                pacman -Q "$pkg" &>/dev/null || { log_warn "$pkg missing — installing..."; sudo pacman -S --noconfirm "$pkg"; }
            done ;;
        debian)
            PKGS="build-essential cmake pkg-config libwebkit2gtk-4.1-dev libssl-dev libgtk-3-dev libayatana-appindicator3-dev librsvg2-dev python3 python3-venv python3-pip"
            for pkg in $PKGS; do
                dpkg -s "$pkg" &>/dev/null || { log_warn "$pkg missing — installing..."; sudo apt-get install -y "$pkg"; }
            done ;;
        fedora)
            PKGS="gcc gcc-c++ cmake webkit2gtk4.1-devel openssl-devel gtk3-devel libappindicator-gtk3-devel librsvg2-devel python3 python3-pip"
            for pkg in $PKGS; do
                rpm -q "$pkg" &>/dev/null || sudo dnf install -y "$pkg"
            done ;;
        macos)
            command -v cmake &>/dev/null || { log_warn "cmake missing — installing via brew..."; brew install cmake python3; }
            ;;
    esac
    log_ok "System dependencies ready"
}
install_deps

# ── Rust ──────────────────────────────────────────────────────────────────────
log_step "Checking Rust"
if ! command -v cargo &>/dev/null; then
    log_warn "Rust not found — installing via rustup..."
    curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y --no-modify-path
    source "$HOME/.cargo/env"
fi
log_ok "Rust $(rustc --version | cut -d' ' -f2)"

# ── Bun ───────────────────────────────────────────────────────────────────────
log_step "Checking Bun"
if ! command -v bun &>/dev/null; then
    log_warn "Bun not found — installing..."
    curl -fsSL https://bun.sh/install | bash
    export PATH="$HOME/.bun/bin:$PATH"
fi
log_ok "Bun $(bun --version)"

# ── Python backend venv ───────────────────────────────────────────────────────
log_step "Python backend"
cd "$ROOT/backend"
if [[ ! -d ".venv" ]]; then
    log_warn "Creating backend venv..."
    python3 -m venv .venv
fi

# Install/update deps
.venv/bin/pip install --quiet --upgrade pip
.venv/bin/pip install --quiet fastapi "uvicorn[standard]" huggingface_hub loguru pydantic httpx python-dotenv

# Inference engine compilation is handled by the InstallerApp on first launch

# ── Migrate legacy vLLM venv if needed ────────────────────────────────────────
LEGACY_VLLM="$ROOT/.venv-vllm"
NEW_VLLM_DIR="$HOME/.local/share/echohub/vllm-envs/0.21.0"
if [[ -d "$LEGACY_VLLM" ]] && [[ ! -d "$NEW_VLLM_DIR" ]]; then
    log_warn "Migrating legacy vLLM env to managed location (~7 GB, may take a moment)..."
    mkdir -p "$(dirname "$NEW_VLLM_DIR")"
    cp -r "$LEGACY_VLLM" "$NEW_VLLM_DIR"
    log_ok "vLLM 0.21.0 migrated to $NEW_VLLM_DIR"
fi

# ── Frontend dependencies ─────────────────────────────────────────────────────
log_step "Frontend dependencies"
cd "$ROOT/frontend"
if [[ ! -d "node_modules" ]]; then
    log_warn "Installing frontend dependencies..."
    bun install --frozen-lockfile 2>/dev/null || bun install
fi
log_ok "Frontend dependencies ready"

# ── Display backend detection (Wayland/X11) ────────────────────────────────────
SESSION="${ECHOHUB_DISPLAY_BACKEND:-${XDG_SESSION_TYPE:-}}"
[[ -z "$SESSION" && -n "$WAYLAND_DISPLAY" ]] && SESSION="wayland"
[[ -z "$SESSION" && -n "$DISPLAY" ]] && SESSION="x11"
if [[ "$SESSION" == "wayland" ]]; then
    export GDK_BACKEND=x11
    export WEBKIT_DISABLE_COMPOSITING_MODE=1
    log_ok "Wayland session — using XWayland"
fi

# ── Build or dev ──────────────────────────────────────────────────────────────
echo -e "\n${BOLD}${GREEN}All checks passed — launching EchoHub${RESET}"
echo -e "────────────────────────────────────────"

if [[ "$DEV_MODE" == "true" ]]; then
    log_ok "Dev mode: hot reload enabled"
    export VITE_MSW=false
    exec cargo tauri dev
else
    # Build if needed
    if [[ ! -d "dist" ]] || [[ "$(find src -newer dist -name '*.tsx' -o -name '*.ts' 2>/dev/null | head -1)" ]]; then
        log_step "Building frontend..."
        bun run build
    fi
    log_step "Building Tauri app..."
    cargo tauri build --no-bundle 2>&1 | tee "$LOG/tauri-build.log" | tail -5
    # Launch the built binary
    BINARY=$(find src-tauri/target/release -maxdepth 1 -name "app" -o -name "echohub" 2>/dev/null | head -1)
    if [[ -n "$BINARY" ]]; then
        log_ok "Launching $BINARY"
        exec "$BINARY"
    else
        log_warn "Binary not found — falling back to dev mode"
        export VITE_MSW=false
        exec cargo tauri dev
    fi
fi
