#!/bin/sh
# SPDX-License-Identifier: GPL-2.0-or-later
set -eu
cd "$(dirname "$0")"
/usr/bin/xcrun clang++ -O3 -std=c++17 -I rubberband render.cpp rubberband/single/RubberBandSingle.cpp -framework Accelerate -o "${1:-rubberband-speed}"
