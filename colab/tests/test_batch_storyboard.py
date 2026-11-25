"""
Ticket #5 批次逐鏡生圖與圖生影 (I2V) 佇列測試
Testing Seam (狀態機斷點續傳邊界):
1. Shot #1 已完成後中斷，重啟時應跳過 Shot #1，僅執行剩餘 Shot #2
2. 指定 reroll_shot_id 時，僅重算該單一 Shot
"""

import os
import sys
import unittest
from pathlib import Path

os.environ["HUISHI_ALLOWED_EMAIL"] = "artist@example.com"
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from fastapi.testclient import TestClient  # noqa: E402
import backend_gateway  # noqa: E402
import comfy_client  # noqa: E402


class TestBatchStoryboardQueue(unittest.TestCase):
    def setUp(self) -> None:
        self.client = TestClient(backend_gateway.app)
        backend_gateway.set_token_verifier(
            lambda _t: {"email": "artist@example.com", "email_verified": True}
        )

    def tearDown(self) -> None:
        backend_gateway.set_job_updater(None)
        backend_gateway.set_storyboard_updater(None)
        backend_gateway.set_txt2img_runner(comfy_client.run_comfyui_txt2img)
        backend_gateway.set_i2v_runner(comfy_client.run_comfyui_i2v)

    def test_checkpoint_resume_skips_completed_shot(self) -> None:
        executed_txt2img = []
        executed_i2v = []
        board_snapshots = []

        backend_gateway.set_job_updater(lambda _jid, _f: None)
        backend_gateway.set_storyboard_updater(lambda _sid, f: board_snapshots.append(f))

        def fake_txt2img(**kw):
            executed_txt2img.append(kw["job_id"])
            return {
                "output_drive_path": f"images/{kw['job_id']}.png",
                "thumbnail_webp": "data:image/webp;base64,OK",
            }

        def fake_i2v(**kw):
            executed_i2v.append(kw["shot_id"])
            return {"video_path": f"videos/{kw['job_id']}_{kw['shot_id']}.mp4"}

        backend_gateway.set_txt2img_runner(fake_txt2img)
        backend_gateway.set_i2v_runner(fake_i2v)

        storyboard = {
            "id": "sb-1",
            "title": "Test",
            "shots": [
                {
                    "id": "shot-1",
                    "order": 1,
                    "visualDescription": "first shot",
                    "status": "completed",
                    "keyframeImagePath": "images/old.png",
                    "videoPath": "videos/old.mp4",
                },
                {
                    "id": "shot-2",
                    "order": 2,
                    "visualDescription": "second shot",
                    "status": "pending",
                },
            ],
        }

        res = self.client.post(
            "/render/storyboard",
            headers={"Authorization": "Bearer valid.token"},
            json={
                "job_id": "job-batch-1",
                "storyboard_id": "sb-1",
                "storyboard": storyboard,
                "style_presets_map": {},
            },
        )
        self.assertEqual(res.status_code, 200)
        # Shot #1 must be skipped; only Shot #2 executed
        self.assertEqual(executed_txt2img, ["job-batch-1_shot-2"])
        self.assertEqual(executed_i2v, ["shot-2"])
        last_shots = board_snapshots[-1]["shots"]
        self.assertEqual(last_shots[0]["videoPath"], "videos/old.mp4")
        self.assertEqual(last_shots[1]["status"], "completed")
        self.assertEqual(last_shots[1]["videoPath"], "videos/job-batch-1_shot-2.mp4")

    def test_reroll_single_shot_only(self) -> None:
        executed_i2v = []
        backend_gateway.set_job_updater(lambda _jid, _f: None)
        backend_gateway.set_storyboard_updater(lambda _sid, _f: None)
        backend_gateway.set_txt2img_runner(
            lambda **kw: {
                "output_drive_path": f"images/{kw['job_id']}.png",
                "thumbnail_webp": "data:image/webp;base64,NEW",
            }
        )
        backend_gateway.set_i2v_runner(
            lambda **kw: executed_i2v.append(kw["shot_id"]) or {"video_path": "videos/reroll.mp4"}
        )

        storyboard = {
            "id": "sb-1",
            "shots": [
                {"id": "shot-1", "order": 1, "status": "completed", "keyframeImagePath": "a.png", "videoPath": "a.mp4"},
                {"id": "shot-2", "order": 2, "status": "completed", "keyframeImagePath": "b.png", "videoPath": "b.mp4"},
            ],
        }

        res = self.client.post(
            "/render/storyboard",
            headers={"Authorization": "Bearer valid.token"},
            json={
                "job_id": "job-reroll-1",
                "storyboard_id": "sb-1",
                "storyboard": storyboard,
                "reroll_shot_id": "shot-1",
            },
        )
        self.assertEqual(res.status_code, 200)
        self.assertEqual(executed_i2v, ["shot-1"])


if __name__ == "__main__":
    unittest.main()
