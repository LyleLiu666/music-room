"""本机 ACE-Step 翻唱。双击本机启动器，或用 --help 查看批处理参数。"""
import argparse
from datetime import datetime
import json
import math
from pathlib import Path
import subprocess
import sys
import tempfile

import numpy as np
import soundfile as sf

ROOT = Path.home() / "Music/ACE-Cover-Trial-20261124"
ROCK = ("Mandarin female frontwoman singing with a distinctly raspy husky low alto voice, "
        "gritty soulful rock belting, strong clear consonants. Live alternative rock "
        "band, overdriven electric guitar power chords, muscular electric bass, punchy "
        "acoustic kick and snare, dynamic cymbals. Keep the recognizable vocal melody and Mandarin phrasing.")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("song", nargs="?", type=Path, help="原唱 WAV、MP3 或 FLAC")
    parser.add_argument("--start", type=float, help="截取起点（秒）")
    parser.add_argument("--seconds", type=float, default=30, help="截取时长（默认 30 秒）")
    parser.add_argument("--lyrics", type=Path, help="片段歌词 UTF-8 文本")
    parser.add_argument("--style", help="目标风格，默认沙哑女声摇滚")
    parser.add_argument("--language", default="zh", help="演唱语言，默认 zh")
    parser.add_argument("--bpm", type=int, default=0, help="已知原曲速度时可填")
    parser.add_argument("--seed", type=int, default=71)
    args = parser.parse_args()
    song = args.song
    if song is None:
        selected = subprocess.check_output(
            ["osascript", "-e", 'POSIX path of (choose file with prompt "选择要翻唱的原曲")'],
            text=True).strip()
        song = Path(selected)
        if args.start is None:
            args.start = float(input("从第几秒开始？直接回车从头开始：") or 0)
        if args.style is None:
            args.style = input("想怎么唱？直接回车用沙哑女声摇滚，也可以输入英文风格描述：").strip()
    if args.lyrics:
        lyrics = args.lyrics.read_text(encoding="utf-8-sig").strip()
    else:
        print("粘贴片段歌词，最后另起一行输入一个点 . 并回车：", flush=True)
        lines = []
        for line in sys.stdin:
            if line.strip() == ".":
                break
            lines.append(line)
        lyrics = "".join(lines).strip()
    start = args.start or 0
    if not lyrics or not math.isfinite(start) or start < 0 or not math.isfinite(args.seconds) or args.seconds <= 0:
        parser.error("请提供片段歌词、有效起点与时长")
    song = song.expanduser().resolve()
    with sf.SoundFile(song) as f:
        sr = f.samplerate
        if start >= len(f) / sr:
            parser.error("截取起点已超出原曲")
        f.seek(round(start * sr))
        data = f.read(min(round(args.seconds * sr), len(f) - f.tell()), always_2d=True)
    seconds = len(data) / sr
    if seconds < 10 or data.shape[1] not in (1, 2) or not np.isfinite(data).all() or not data.any():
        parser.error("请选择至少 10 秒、包含声音的单声道或立体声片段")
    parent = ROOT / "翻唱作品"
    parent.mkdir(exist_ok=True)
    work = Path(tempfile.mkdtemp(prefix=datetime.now().strftime("%Y%m%d-%H%M%S-"), dir=parent))
    print(f"本次作品目录：{work}", flush=True)
    sf.write(work / "原唱.wav", data, sr, subtype="PCM_24")
    params = dict(task_type="cover", synth_model="acestep-v15-turbo-Q5_K_M.gguf",
                  caption=args.style or (ROCK if args.language == "zh" else ROCK.replace("Mandarin ", "")), lyrics=lyrics, bpm=args.bpm, duration=seconds,
                  vocal_language=args.language, seed=args.seed, inference_steps=8,
                  audio_cover_strength=0.625, output_format="wav24")
    (work / "cover.json").write_text(json.dumps(params, ensure_ascii=False, indent=2))
    (work / "source.json").write_text(json.dumps(dict(song=str(song), start=start, seconds=seconds), ensure_ascii=False))
    with (work / "运行日志.txt").open("w") as log:
        subprocess.run([ROOT / "build/ace-synth", "--models", ROOT / "models", "--request", "cover.json",
                        "--src-audio", "原唱.wav"], cwd=work, stdout=log, stderr=log, check=True)
    audio, rate = sf.read(work / "cover0.wav", always_2d=True)
    if rate != 48000 or audio.shape[1] != 2 or abs(len(audio)/rate-seconds) > 1 or not np.isfinite(audio).all() or not audio.any():
        raise ValueError(f"翻唱音频校验失败，请查看 {work}")
    (work / "cover0.wav").rename(work / "翻唱.wav")
    print(f"完成：{work / '翻唱.wav'}", flush=True)
    if args.song is None:
        subprocess.run(["open", str(work)], check=False)


if __name__ == "__main__":
    try:
        main()
    except (OSError, ValueError, RuntimeError, subprocess.CalledProcessError) as exc:
        sys.exit(f"未完成：{exc}")
