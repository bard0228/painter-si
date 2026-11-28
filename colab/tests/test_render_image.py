"""
Ticket #3 + 進階升級測試：單張生圖、比例/直橫、雙神模切換、Img2Img/Inpaint 與 Range Request
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
        backend_gateway.set_edit_runner(comfy_client.run_comfyui_edit)

    def test_checkpoint_aspect_ratio_and_webp_compression(self) -> None:
        preset = {
            "positivePromptTemplate": "{prompt}, cinematic",
            "negativePromptTemplate": "blurry",
            "sampler": "dpmpp_2m",
            "steps": 25,
            "cfgScale": 6.0,
            "checkpointName": "Juggernaut-XL_v9_RunDiffusionPhoto_v2.safetensors",
            "loraName": "film.safetensors",
        }
        portrait_wf = comfy_client.build_txt2img_workflow(
            "a quiet alley", preset, aspect_ratio="3:4", orientation="portrait", seed=42
        )
        landscape_wf = comfy_client.build_txt2img_workflow(
            "a quiet alley", preset, aspect_ratio="3:4", orientation="landscape", seed=42
        )

        self.assertEqual(portrait_wf["1"]["inputs"]["ckpt_name"], "Juggernaut-XL_v9_RunDiffusionPhoto_v2.safetensors")
        self.assertEqual(portrait_wf["4"]["inputs"]["width"], 896)
        self.assertEqual(portrait_wf["4"]["inputs"]["height"], 1152)
        self.assertEqual(landscape_wf["4"]["inputs"]["width"], 1152)
        self.assertEqual(landscape_wf["4"]["inputs"]["height"], 896)
        self.assertIn("8", portrait_wf)

        buf = io.BytesIO()
        Image.new("RGB", (800, 800), (30, 40, 50)).save(buf, format="PNG")
        uri = comfy_client.compress_to_webp_data_uri(buf.getvalue())
        self.assertTrue(uri.startswith("data:image/webp;base64,"))

    def test_img2img_and_inpaint_workflows(self) -> None:
        preset = {"positivePromptTemplate": "{prompt}", "checkpointName": "animagine-xl-3.1.safetensors"}
        img2img_wf = comfy_client.build_edit_workflow(
            "src.png", "add starry sky", preset, denoise=0.45, uploaded_mask_name=None, seed=7
        )
        self.assertEqual(img2img_wf["5"]["inputs"]["denoise"], 0.45)
        self.assertEqual(img2img_wf["5"]["inputs"]["latent_image"], ["10", 0])
        self.assertNotIn("11", img2img_wf)

        inpaint_wf = comfy_client.build_edit_workflow(
            "src.png", "smiling face", preset, denoise=0.65, uploaded_mask_name="mask.png", seed=7
        )
        self.assertIn("11", inpaint_wf)
        self.assertIn("12", inpaint_wf)
        self.assertEqual(inpaint_wf["5"]["inputs"]["latent_image"], ["12", 0])

    def test_render_image_and_edit_state_transitions(self) -> None:
        events = []
        backend_gateway.set_job_updater(lambda jid, fields: events.append((jid, fields["status"])))
        backend_gateway.set_txt2img_runner(
            lambda **_kw: {
                "output_drive_path": "images/job-1.png",
                "thumbnail_webp": "data:image/webp;base64,AAAA",
            }
        )
        backend_gateway.set_edit_runner(
            lambda **_kw: {
                "output_drive_path": "images/job-edit-1.png",
                "thumbnail_webp": "data:image/webp;base64,BBBB",
            }
        )

        res = self.client.post(
            "/render/image",
            headers={"Authorization": "Bearer valid.token"},
            json={
                "job_id": "job-1",
                "prompt": "rainy neon street",
                "style_preset": {"name": "Cinematic", "positivePromptTemplate": "{prompt}"},
                "aspect_ratio": "9:16",
                "orientation": "landscape",
            },
        )
        self.assertEqual(res.status_code, 200)

        edit_res = self.client.post(
            "/render/edit",
            headers={"Authorization": "Bearer valid.token"},
            json={
                "job_id": "job-edit-1",
                "source_drive_path": "images/job-1.png",
                "prompt": "brighter moonlight",
                "style_preset": {"name": "Cinematic", "positivePromptTemplate": "{prompt}"},
                "denoise": 0.4,
            },
        )
        self.assertEqual(edit_res.status_code, 200)
        self.assertEqual(
            events,
            [
                ("job-1", "queued"),
                ("job-1", "processing"),
                ("job-1", "completed"),
                ("job-edit-1", "queued"),
                ("job-edit-1", "processing"),
                ("job-edit-1", "completed"),
            ],
        )

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

    def test_multi_reference_workflows_sdxl_and_flux(self):
        # 1. SDXL FaceID with 3 reference images -> ImageBatch + IPAdapterFaceID
        wf_sdxl_face = comfy_client.build_txt2img_workflow(
            "wearing a black suit in Tokyo cafe",
            {"checkpointName": "RealVisXL_V5.0_fp16.safetensors", "steps": 28, "cfgScale": 5.5},
            uploaded_ref_names=["ref0.png", "ref1.png", "ref2.png"],
            reference_mode="face",
            reference_weight=0.8,
        )
        self.assertEqual(wf_sdxl_face["20"]["class_type"], "LoadImage")
        self.assertEqual(wf_sdxl_face["21"]["class_type"], "LoadImage")
        self.assertEqual(wf_sdxl_face["22"]["class_type"], "LoadImage")
        self.assertEqual(wf_sdxl_face["24"]["class_type"], "ImageBatch")
        self.assertEqual(wf_sdxl_face["25"]["class_type"], "ImageBatch")
        self.assertEqual(wf_sdxl_face["30"]["class_type"], "IPAdapterUnifiedLoaderFaceID")
        self.assertEqual(wf_sdxl_face["31"]["class_type"], "IPAdapterFaceID")
        self.assertEqual(wf_sdxl_face["5"]["inputs"]["model"], ["31", 0])

        # 2. SDXL Subject with 2 reference images -> IPAdapter Plus
        wf_sdxl_sub = comfy_client.build_txt2img_workflow(
            "placed on wooden table in sunlight",
            {"checkpointName": "animagine-xl-3.1.safetensors"},
            uploaded_ref_names=["obj0.png", "obj1.png"],
            reference_mode="subject",
            reference_weight=0.75,
        )
        self.assertEqual(wf_sdxl_sub["30"]["class_type"], "IPAdapterUnifiedLoader")
        self.assertEqual(wf_sdxl_sub["31"]["class_type"], "IPAdapter")
        self.assertEqual(wf_sdxl_sub["5"]["inputs"]["model"], ["31", 0])

        # 3. FLUX Face with 2 reference images -> PuLID Flux
        wf_flux_face = comfy_client.build_txt2img_workflow(
            "walking on beach at sunset",
            {"checkpointName": "flux1-dev-fp8.safetensors"},
            uploaded_ref_names=["f0.png", "f1.png"],
            reference_mode="face",
            reference_weight=0.85,
        )
        self.assertEqual(wf_flux_face["30"]["class_type"], "PulidFluxModelLoader")
        self.assertEqual(wf_flux_face["33"]["class_type"], "ApplyPulidFlux")
        self.assertEqual(wf_flux_face["5"]["inputs"]["model"], ["33", 0])

        # 4. FLUX Subject with 2 reference images -> FLUX Redux StyleModelApply chain
        wf_flux_sub = comfy_client.build_txt2img_workflow(
            "floating in outer space",
            {"checkpointName": "flux1-dev-fp8.safetensors"},
            uploaded_ref_names=["s0.png", "s1.png"],
            reference_mode="subject",
            reference_weight=0.7,
        )
        self.assertEqual(wf_flux_sub["30"]["class_type"], "StyleModelLoader")
        self.assertEqual(wf_flux_sub["31"]["class_type"], "CLIPVisionLoader")
        self.assertEqual(wf_flux_sub["33"]["class_type"], "StyleModelApply")
        self.assertEqual(wf_flux_sub["35"]["class_type"], "StyleModelApply")
        self.assertEqual(wf_flux_sub["5"]["inputs"]["positive"], ["35", 0])


if __name__ == "__main__":
    unittest.main()
