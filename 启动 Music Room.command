#!/bin/sh
# 双击运行：仅启动这台 Mac 的 Music Room，并打开实际服务地址。
set -eu
music_binary=/Users/liu_y/code/music/release/music-room
if [ ! -x "$music_binary" ]; then
  echo "找不到 Music Room：$music_binary。请在项目目录运行 npm run build:binary。" >&2
  exit 1
fi
music_result=$(mktemp)
trap 'rm -f "$music_result"' EXIT
"$music_binary" start --workspace "$HOME/Music/MusicRoom" --port 57923 > "$music_result"
cat "$music_result"
music_url=$(/usr/bin/plutil -extract url raw -o - "$music_result")
case "$music_url" in
  http://127.0.0.1:*) /usr/bin/open "$music_url" ;;
  *) echo "启动器返回了非本机地址，未打开：$music_url" >&2; exit 1 ;;
esac
