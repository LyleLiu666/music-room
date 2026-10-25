#!/bin/sh
set -eu
music_root=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
music_app="$HOME/Applications/Music Room Launcher.app"
mkdir -p "$music_app/Contents/MacOS"
xcrun swiftc "$music_root/scripts/mac-launcher/main.swift" -o "$music_app/Contents/MacOS/MusicRoomLauncher" -framework AppKit
/usr/bin/plutil -create xml1 "$music_app/Contents/Info.plist"
/usr/bin/plutil -insert CFBundleIdentifier -string local.music-room.launcher "$music_app/Contents/Info.plist"
/usr/bin/plutil -insert CFBundleName -string 'Music Room Launcher' "$music_app/Contents/Info.plist"
/usr/bin/plutil -insert CFBundleExecutable -string MusicRoomLauncher "$music_app/Contents/Info.plist"
/usr/bin/plutil -insert CFBundlePackageType -string APPL "$music_app/Contents/Info.plist"
/usr/bin/plutil -insert LSUIElement -bool YES "$music_app/Contents/Info.plist"
/usr/bin/plutil -insert MusicRoomLauncherScript -string "$music_root/启动 Music Room.command" "$music_app/Contents/Info.plist"
/usr/bin/plutil -insert CFBundleURLTypes -json '[{"CFBundleURLName":"Music Room local start","CFBundleURLSchemes":["music-room-local"]}]' "$music_app/Contents/Info.plist"
/usr/bin/codesign --force --sign - "$music_app"
/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister -f "$music_app"
echo "已安装：$music_app"
