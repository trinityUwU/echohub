#!/bin/bash
set -e
# Build EchoHub distribution packages (.AppImage, .deb)
cd "$(dirname "$0")/frontend"
echo "Building frontend…"
bun run build
echo "Building Tauri packages…"
cargo tauri build
echo ""
echo "Packages available in:"
ls src-tauri/target/release/bundle/appimage/*.AppImage 2>/dev/null && echo "  AppImage ✓"
ls src-tauri/target/release/bundle/deb/*.deb 2>/dev/null && echo "  .deb ✓"
