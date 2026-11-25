"""
Ticket #6 FFmpeg 合成邊界測試 (Testing Seam)
輸入 2 個測試 MP4、裁切秒數、字幕字串與 1 個 BGM，
真實呼叫 FFmpeg 驗證輸出 MP4 具備正確音軌與影片串流。
"""

import json
import os
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

os.environ["HUISHI_ALLOWED_EMAIL"] = "artist@example.com"
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import ffmpeg_composer  # noqa: E402


class TestFfmpegCompose(unittest.TestCase):
    def test_compose_two_mp4_with_trim_subtitles_and_bgm_fadeout(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            tmp_path = Path(tmp)
            out_dir = tmp_path / "outputs"
            vid_dir = out_dir / "videos"
            bgm_dir = tmp_path / "bgm"
            vid_dir.mkdir(parents=True, exist_ok=True)
            bgm_dir.mkdir(parents=True, exist_ok=True)

            clip1 = vid_dir / "shot1.mp4"
            clip2 = vid_dir / "shot2.mp4"
            bgm_file = bgm_dir / "ambient.mp3"

            subprocess.run(
                [
                    "ffmpeg", "-y", "-f", "lavfi", "-i", "color=c=0x181A1E:s=640x360:d=3",
                    "-c:v", "libx264", "-pix_fmt", "yuv420p", str(clip1),
                ],
                check=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
            )
            subprocess.run(
                [
                    "ffmpeg", "-y", "-f", "lavfi", "-i", "color=c=0x304840:s=640x360:d=3",
                    "-c:v", "libx264", "-pix_fmt", "yuv420p", str(clip2),
                ],
                check=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
            )
            subprocess.run(
                [
                    "ffmpeg", "-y", "-f", "lavfi", "-i", "sine=frequency=440:duration=2",
                    "-c:a", "libmp3lame", str(bgm_file),
                ],
                check=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
            )

            self.assertEqual(ffmpeg_composer.list_bgm_files(bgm_dir), ["ambient.mp3"])

            shots = [
                {
                    "id": "shot-1",
                    "videoPath": "videos/shot1.mp4",
                    "trimStartSec": 0.5,
                    "trimEndSec": 2.5,
                    "subtitleText": "第一幕：夜雨街角",
                },
                {
                    "id": "shot-2",
                    "videoPath": "videos/shot2.mp4",
                    "trimStartSec": 0.5,
                    "trimEndSec": 2.5,
                    "subtitleText": "第二幕：微光黎明",
                },
            ]

            res = ffmpeg_composer.compose_storyboard_video(
                job_id="export-test-1",
                shots=shots,
                bgm_filename="ambient.mp3",
                burn_subtitles=True,
                fade_duration=0.4,
                output_dir=out_dir,
                bgm_dir=bgm_dir,
            )
            exported_file = out_dir / res["output_drive_path"]
            self.assertTrue(exported_file.is_file())

            probe = subprocess.run(
                [
                    "ffprobe", "-v", "quiet", "-print_format", "json",
                    "-show_streams", "-show_format", str(exported_file),
                ],
                check=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True,
            )
            meta = json.loads(probe.stdout)
            codec_types = {s["codec_type"] for s in meta["streams"]}
            self.assertEqual(codec_types, {"video", "audio"})
            dur = float(meta["format"]["duration"])
            self.assertGreater(dur, 3.0)
            self.assertLess(dur, 4.2)


if __name__ == "__main__":
    unittest.main()
