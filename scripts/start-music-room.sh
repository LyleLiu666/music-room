#!/bin/sh
set -eu
music_script_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
if [ -x "$music_script_dir/music-room" ]; then
  music_executable="$music_script_dir/music-room"
else
  music_executable="$music_script_dir/../release/music-room"
fi
if [ ! -x "$music_executable" ]; then
  echo '找不到 music-room 二进制，请先运行 npm run build:binary。' >&2
  exit 1
fi
exec "$music_executable" serve "$@"
