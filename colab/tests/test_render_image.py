"""
Ticket #3 單張生圖管線與 Range Request 測試
"""

import io
import os
import sys
import tempfile
import unittest
from pathlib import Path

from PIL import Image

os.environ["HUISHI_ALLOWED_EMAIL"] = "artist@example.com"
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from fastapi.testclient import TestClient  # noqa: E402
import backend_gateway  # noqa: E402
import comfy_client  # noqa: E402


class TestRenderImageAndMedia(unittest.TestCase):
    def setUp(self) -> None:
        self.client = TestClient(backend_gateway.app)
        backend_gateway.set_token_verifier(
            lambda _t: {"email": "artist@example.com", "email_verified": True}
        )

    def tearDown(self) -> None:
        backend_gateway.set_job_updater(None)
        backend_gateway.set_txt2img_runner(comfy_client.run_comfyui_txt2img)

    def test_vram_workflow_adaptation_and_webp_compression(self) -> None:
        preset = {
            "positivePromptTemplate": "{prompt}, cinematic",
            "negativePromptTemplate": "blurry",
            "sampler": "dpmpp_2m",
            "steps": 25,
            "cfgScale": 6.0,
            "loraName": "film.safetensors",
        }
        high_wf = comfy_client.build_txt2img_workflow("a quiet alley", preset, vram_mode="high_vram", seed=42)
        low_wf = comfy_client.build_txt2img_workflow("a quiet alley", preset, vram_mode="low_vram", seed=42)

        self.assertEqual(high_wf["4"]["inputs"]["width"], 1024)
        self.assertEqual(low_wf["4"]["inputs"]["width"], 768)
        self.assertIn("8", high_wf)  # LoraLoader node

        buf = io.BytesIO()
        Image.new("RGB", (800, 800), (30, 40, 50)).save(buf, format="PNG")
        uri = comfy_client.compress_to_webp_data_uri(buf.getvalue())
        self.assertTrue(uri.startswith("data:image/webp;base64,"))

    def test_render_image_state_transitions(self) -> None:
        events = []
        backend_gateway.set_job_updater(lambda jid, fields: events.append((jid, fields["status"])))
        backend_gateway.set_txt2img_runner(
            lambda **_kw: {
                "output_drive_path": "images/job-1.png",
                "thumbnail_webp": "data:image/webp;base64,AAAA",
            }
        )

        res = self.client.post(
            "/render/image",
            headers={"Authorization": "Bearer valid.token"},
            json={
                "job_id": "job-1",
                "prompt": "rainy neon street",
                "style_preset": {"name": "Cinematic", "positivePromptTemplate": "{prompt}"},
            },
        )
        self.assertEqual(res.status_code, 200)
        self.assertEqual(events, [("job-1", "queued"), ("job-1", "processing"), ("job-1", "completed")])

    def test_media_range_request_206_and_traversal_block(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            comfy_client.OUTPUT_DIR = Path(tmp)
            img_dir = Path(tmp) / "images"
            img_dir.mkdir(parents=True, exist_ok=True)
            (img_dir / "sample.bin").write_bytes(b"0123456789ABCDEF")

            res = self.client.get(
                "/media/images/sample.bin",
                headers={"Authorization": "Bearer valid.token", "Range": "bytes=0-7"},
            )
            self.assertEqual(res.status_code, 206)
            self.assertEqual(res.content, b"01234567")
            self.assertEqual(res.headers["content-range"], "bytes 0-7/16")

            traversal = self.client.get(
                "/media/../../etc/passwd",
                headers={"Authorization": "Bearer valid.token"},
            )
            self.assertEqual(traversal.status_code, 404)


if __name__ == "__main__":
    unittest.main()
