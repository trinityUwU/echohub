# EchoHub

Local LLM interface. Browse HuggingFace, download GGUF/AWQ/GPTQ models, load them with llama-cpp-python or vLLM, and chat — all offline.

## Stack

| Layer | Tech |
|---|---|
| Shell | Rust · Tauri v2 |
| Frontend | React 18 · TypeScript · Tailwind · Vite · Bun |
| Backend | Python 3.11+ · FastAPI · uvicorn |
| Inference | llama-cpp-python (GGUF, all platforms) · vLLM optional (AWQ/GPTQ, NVIDIA only) |
| Models dir | `/mnt/models/echohub/` |

## Ports

| Service | Port |
|---|---|
| FastAPI backend | 37821 |
| Vite dev server | 37822 |
| vLLM (internal) | 37823 |

---

## Prerequisites

### All platforms

- **Rust** ≥ 1.77 — https://rustup.rs
- **Bun** ≥ 1.0 — https://bun.sh
- **Python** 3.11+
- **cmake**, **gcc/clang** (for llama-cpp-python compilation)

### Ubuntu / Debian

```bash
sudo apt update
sudo apt install -y \
  build-essential cmake pkg-config \
  libwebkit2gtk-4.1-dev libssl-dev libgtk-3-dev libayatana-appindicator3-dev \
  libxdo-dev librsvg2-dev \
  python3 python3-venv python3-pip
```

> **Wayland users (Ubuntu 22.04+):** if the app window crashes on launch, see the [Wayland section](#wayland--display-issues) below.

### Arch Linux

```bash
sudo pacman -S --needed \
  base-devel cmake webkit2gtk-4.1 gtk3 libayatana-appindicator \
  openssl pkg-config librsvg xdotool \
  python
```

**CUDA support on Arch** (for llama-cpp-python with RTX GPU):

```bash
sudo pacman -S cuda gcc14   # or gcc15 depending on your CUDA version
```

The `start.sh` script handles the llama-cpp compilation with the correct flags automatically.

### Fedora / RHEL

```bash
sudo dnf install -y \
  gcc gcc-c++ cmake webkit2gtk4.1-devel openssl-devel \
  gtk3-devel libappindicator-gtk3-devel librsvg2-devel \
  python3 python3-pip
```

### macOS

```bash
brew install cmake python3
```

Xcode command line tools required: `xcode-select --install`

---

## First run (dev mode)

```bash
git clone https://github.com/trinityUwU/echohub
cd echohub

# Start backend + Tauri app (handles display detection automatically)
./start.sh
```

`start.sh` will:
1. Detect your GPU (NVIDIA / AMD / Apple Silicon / CPU)
2. Create the Python venv and compile llama-cpp-python with the right backend
3. Start the FastAPI backend on port 37821
4. Launch the Tauri app (Vite dev server + native window)

---

## Wayland / display issues

EchoHub uses WebKitGTK. On some Wayland compositors it crashes with `Error 71 (Protocol error)`.

**Automatic fix** — the launch scripts detect Wayland and switch to XWayland automatically.  
You need XWayland installed:

```bash
# Ubuntu / Debian
sudo apt install xwayland

# Arch
sudo pacman -S xorg-xwayland

# Fedora
sudo dnf install xorg-x11-server-Xwayland
```

**Manual override** if auto-detection fails:

```bash
# Force X11 backend
ECHOHUB_DISPLAY_BACKEND=x11 ./frontend/tauri-dev.sh

# Or export permanently in your shell profile
export ECHOHUB_DISPLAY_BACKEND=x11
```

**GNOME on Wayland (Ubuntu 22.04+, Fedora 38+):**  
XWayland is included by default — no extra install needed. The script handles it.

**KDE Plasma / Hyprland / Sway:**  
Install `xorg-xwayland` (Arch) or `xwayland` (Debian/Ubuntu), then the script auto-detects.

---

## Manual launch (without start.sh)

### Backend only

```bash
cd backend
python3 -m venv .venv
.venv/bin/pip install fastapi uvicorn loguru pydantic huggingface_hub httpx python-dotenv

# NVIDIA CUDA
CMAKE_ARGS="-DGGML_CUDA=on" .venv/bin/pip install llama-cpp-python

# AMD ROCm
CMAKE_ARGS="-DGGML_HIPBLAS=on" .venv/bin/pip install llama-cpp-python

# Apple Silicon
CMAKE_ARGS="-DGGML_METAL=on" .venv/bin/pip install llama-cpp-python

# CPU only
.venv/bin/pip install llama-cpp-python

cp .env.example .env   # add HF_TOKEN for gated models

PYTHONPATH=$(pwd)/.. .venv/bin/uvicorn backend.main:app --port 37821
```

### Tauri app (dev)

```bash
cd frontend
bun install
./tauri-dev.sh   # handles Wayland detection + MSW mock data
```

### Frontend only (browser, no native window)

```bash
cd frontend
VITE_MSW=true bun run dev
# Open http://localhost:37822
```

---

## Scripts

| Script | Description |
|---|---|
| `./start.sh` | Start backend + Tauri app (production dev) |
| `./stop.sh` | Kill all EchoHub processes |
| `./restart.sh` | stop + start |
| `./frontend/tauri-dev.sh` | Tauri dev with auto display detection |

## HF Token (gated models)

Create `.env` in `backend/`:

```bash
cp backend/.env.example backend/.env
# Edit and add:
HF_TOKEN=hf_your_token_here
```

Required for gated models (Llama, Gemma, Mistral-7B-v0.1…).

## Stop

```bash
./stop.sh
```
