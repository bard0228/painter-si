"""
FFmpeg Storyboard Video Composer for 繪師 BackendGateway (Ticket #6)
- 支援各鏡頭頭尾秒數裁切 (trimStartSec, trimEndSec)
- 支援淡入淡出轉場 (xfade)
- 支援硬字幕燒錄 (SRT subtitles filter)
- 支援 Google Drive /bgm 音軌混音與尾段淡出 (afade)
"""

from __future__ import annotations

import os
import subprocess
import tempfile
from pathlib import Path
from typing import Any, Optional

OUTPUT_DIR = Path(
    os.getenv("HUISHI_OUTPUT_DIR", "/content/drive/MyDrive/麻糬紅豆湯/繪師/AI_Studio/outputs")
)
BGM_DIR = Path(
    os.getenv("HUISHI_BGM_DIR", "/content/drive/MyDrive/麻糬紅豆湯/繪師/AI_Studio/bgm")
)

AUDIO_EXTS = {".mp3", ".wav", ".m4a", ".aac", ".ogg", ".flac"}


def list_bgm_files(bgm_dir: Path = BGM_DIR) -> list[str]:
    """List available BGM audio files in Drive /bgm folder."""
    if not bgm_dir.exists() or not bgm_dir.is_dir():
        return []
    return sorted(
        p.name for p in bgm_dir.iterdir() if p.is_file() and p.suffix.lower() in AUDIO_EXTS
    )


def _format_srt_time(seconds: float) -> str:
    ms_total = max(0, int(round(seconds * 1000)))
    hrs = ms_total // 3_600_000
    mins = (ms_total % 3_600_000) // 60_000
    secs = (ms_total % 60_000) // 1000
    ms = ms_total % 1000
    return f"{hrs:02d}:{mins:02d}:{secs:02d},{ms:03d}"


def compose_storyboard_video(
    job_id: str,
    shots: list[dict[str, Any]],
    bgm_filename: Optional[str] = None,
    burn_subtitles: bool = True,
    fade_duration: float = 0.4,
    output_dir: Path = OUTPUT_DIR,
    bgm_dir: Path = BGM_DIR,
) -> dict[str, str]:
    """Trim, concatenate with xfade, burn subtitles, mix BGM with tail fade-out, and export MP4."""
    valid_shots = [s for s in shots if s.get("videoPath")]
    if not valid_shots:
        raise ValueError("No shots with videoPath available to compose")

    exports_dir = output_dir / "exports"
    exports_dir.mkdir(parents=True, exist_ok=True)
    final_rel = f"exports/{job_id}.mp4"
    final_path = output_dir / final_rel

    with tempfile.TemporaryDirectory() as tmp_str:
        tmp_dir = Path(tmp_str)
        trimmed_clips: list[tuple[Path, float, str]] = []

        for idx, shot in enumerate(valid_shots):
            src_path = (output_dir / str(shot["videoPath"])).resolve()
            if not src_path.is_file():
                raise FileNotFoundError(f"Shot video not found: {shot['videoPath']}")

            t_start = max(0.0, float(shot.get("trimStartSec") or 0.0))
            t_end = float(shot.get("trimEndSec") or 4.0)
            dur = max(0.5, t_end - t_start)

            clip_out = tmp_dir / f"clip_{idx:03d}.mp4"
            cmd_trim = [
                "ffmpeg",
                "-y",
                "-ss",
                f"{t_start:.3f}",
                "-t",
                f"{dur:.3f}",
                "-i",
                str(src_path),
                "-vf",
                "scale=1280:720:force_original_aspect_ratio=decrease,pad=1280:720:(ow-iw)/2:(oh-ih)/2,setsar=1,fps=24",
                "-c:v",
                "libx264",
                "-preset",
                "veryfast",
                "-pix_fmt",
                "yuv420p",
                "-an",
                str(clip_out),
            ]
            subprocess.run(cmd_trim, check=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
            trimmed_clips.append((clip_out, dur, str(shot.get("subtitleText") or "").strip()))

        # Build xfade filtergraph across trimmed clips
        cmd = ["ffmpeg", "-y"]
        for clip_path, _, _ in trimmed_clips:
            cmd.extend(["-i", str(clip_path)])

        has_bgm = False
        bgm_path: Optional[Path] = None
        if bgm_filename:
            candidate = (bgm_dir / bgm_filename).resolve()
            if candidate.is_file() and str(candidate).startswith(str(bgm_dir.resolve())):
                has_bgm = True
                bgm_path = candidate

        if has_bgm and bgm_path is not None:
            cmd.extend(["-stream_loop", "-1", "-i", str(bgm_path)])

        filter_parts: list[str] = []
        total_dur = trimmed_clips[0][1]

        if len(trimmed_clips) == 1:
            v_label = "[0:v]"
        else:
            prev_label = "[0:v]"
            offset = max(0.1, trimmed_clips[0][1] - fade_duration)
            for idx in range(1, len(trimmed_clips)):
                out_label = f"[v{idx}]"
                filter_parts.append(
                    f"{prev_label}[{idx}:v]xfade=transition=fade:duration={fade_duration:.3f}:offset={offset:.3f}{out_label}"
                )
                prev_label = out_label
                if idx < len(trimmed_clips) - 1:
                    offset = max(0.1, offset + trimmed_clips[idx][1] - fade_duration)
            total_dur = sum(c[1] for c in trimmed_clips) - fade_duration * (len(trimmed_clips) - 1)
            v_label = prev_label

        # Generate SRT subtitles and burn into video if enabled
        srt_entries: list[str] = []
        cursor = 0.0
        for idx, (_, dur, sub_text) in enumerate(trimmed_clips):
            eff_dur = dur if idx == 0 else max(0.2, dur - fade_duration)
            if burn_subtitles and sub_text:
                s_time = _format_srt_time(cursor)
                e_time = _format_srt_time(cursor + eff_dur)
                srt_entries.append(f"{len(srt_entries) + 1}\n{s_time} --> {e_time}\n{sub_text}\n")
            cursor += eff_dur

        if burn_subtitles and srt_entries:
            srt_path = tmp_dir / "subtitles.srt"
            srt_path.write_text("\n".join(srt_entries), encoding="utf-8")
            escaped_srt = str(srt_path).replace("\\", "/").replace(":", "\\:")
            filter_parts.append(
                f"{v_label}subtitles='{escaped_srt}':force_style='FontSize=20,PrimaryColour=&H00F4F4F0,OutlineColour=&H000E0F12,Outline=2'[vout]"
            )
            v_label = "[vout]"

        if has_bgm:
            bgm_idx = len(trimmed_clips)
            fade_dur = min(1.5, max(0.3, total_dur * 0.25))
            fade_start = max(0.0, total_dur - fade_dur)
            filter_parts.append(
                f"[{bgm_idx}:a]atrim=0:{total_dur:.3f},asetpts=PTS-STARTPTS,"
                f"afade=t=out:st={fade_start:.3f}:d={fade_dur:.3f}[aout]"
            )

        if filter_parts:
            cmd.extend(["-filter_complex", ";".join(filter_parts)])

        cmd.extend(["-map", v_label])
        if has_bgm:
            cmd.extend(["-map", "[aout]", "-c:a", "aac", "-b:a", "192k"])

        cmd.extend(
            [
                "-c:v",
                "libx264",
                "-preset",
                "fast",
                "-pix_fmt",
                "yuv420p",
                "-movflags",
                "+faststart",
                "-t",
                f"{total_dur:.3f}",
                str(final_path),
            ]
        )
        subprocess.run(cmd, check=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE)

    return {"output_drive_path": final_rel}
