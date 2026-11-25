"""
ComfyUI API Client & Workflow Builder for 繪師 BackendGateway (Ticket #3)
ADR-03:
- 切換或執行生圖任務前強制呼叫 ComfyUI /free 釋放顯存避免 OOM
- 依 VRAM 模式 (>=24GB high_vram vs <24GB low_vram) 自動組裝對應 Workflow
"""

from __future__ import annotations

import base64
import io
import json
import os
import time
import urllib.parse
import urllib.request
from pathlib import Path
from typing import Any, Optional

from PIL import Image

COMFYUI_URL = os.getenv("COMFYUI_URL", "http://127.0.0.1:8188").rstrip("/")
OUTPUT_DIR = Path(
    os.getenv("HUISHI_OUTPUT_DIR", "/content/drive/MyDrive/麻糬紅豆湯/繪師/AI_Studio/outputs")
)

HIGH_VRAM_CKPT = os.getenv("HUISHI_CKPT_HIGH", "sd_xl_base_1.0.safetensors")
LOW_VRAM_CKPT = os.getenv("HUISHI_CKPT_LOW", "sd_xl_turbo_1.0_fp16.safetensors")


def build_txt2img_workflow(
    prompt_text: str,
    style_preset: dict[str, Any],
    vram_mode: str = "low_vram",
    seed: Optional[int] = None,
) -> dict[str, Any]:
    """Build ComfyUI API workflow JSON adapted to high_vram (>=24GB) or low_vram (<24GB)."""
    pos_tpl = style_preset.get("positivePromptTemplate") or "{prompt}"
    positive = pos_tpl.replace("{prompt}", prompt_text) if "{prompt}" in pos_tpl else f"{prompt_text}, {pos_tpl}"
    negative = style_preset.get("negativePromptTemplate") or "lowres, blurry, watermark"
    sampler = style_preset.get("sampler") or "euler"
    steps = int(style_preset.get("steps") or 24)
    cfg = float(style_preset.get("cfgScale") or 6.5)
    lora_name = (style_preset.get("loraName") or "").strip()

    is_high = vram_mode == "high_vram"
    ckpt_name = HIGH_VRAM_CKPT if is_high else LOW_VRAM_CKPT
    width, height = (1024, 1024) if is_high else (768, 768)
    actual_seed = seed if seed is not None else int(time.time() * 1000) % (2**31 - 1)

    model_ref: list[Any] = ["1", 0]
    clip_ref: list[Any] = ["1", 1]

    workflow: dict[str, Any] = {
        "1": {
            "class_type": "CheckpointLoaderSimple",
            "inputs": {"ckpt_name": ckpt_name},
        },
        "4": {
            "class_type": "EmptyLatentImage",
            "inputs": {"width": width, "height": height, "batch_size": 1},
        },
        "5": {
            "class_type": "KSampler",
            "inputs": {
                "seed": actual_seed,
                "steps": steps,
                "cfg": cfg,
                "sampler_name": sampler,
                "scheduler": "normal",
                "denoise": 1.0,
                "model": model_ref,
                "positive": ["2", 0],
                "negative": ["3", 0],
                "latent_image": ["4", 0],
            },
        },
        "6": {
            "class_type": "VAEDecode",
            "inputs": {"samples": ["5", 0], "vae": ["1", 2]},
        },
        "7": {
            "class_type": "SaveImage",
            "inputs": {"filename_prefix": "huishi", "images": ["6", 0]},
        },
    }

    if lora_name:
        workflow["8"] = {
            "class_type": "LoraLoader",
            "inputs": {
                "lora_name": lora_name,
                "strength_model": 0.85,
                "strength_clip": 0.85,
                "model": ["1", 0],
                "clip": ["1", 1],
            },
        }
        workflow["5"]["inputs"]["model"] = ["8", 0]
        clip_ref = ["8", 1]

    workflow["2"] = {
        "class_type": "CLIPTextEncode",
        "inputs": {"text": positive, "clip": clip_ref},
    }
    workflow["3"] = {
        "class_type": "CLIPTextEncode",
        "inputs": {"text": negative, "clip": clip_ref},
    }

    return workflow


def free_comfyui_vram(comfy_url: str = COMFYUI_URL) -> None:
    """ADR-03: Call ComfyUI /free endpoint to unload models and prevent OOM."""
    req = urllib.request.Request(
        f"{comfy_url}/free",
        data=json.dumps({"unload_models": True, "free_memory": True}).encode("utf-8"),
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=10) as resp:
        resp.read()


def compress_to_webp_data_uri(image_bytes: bytes, max_size: int = 512, quality: int = 80) -> str:
    """Compress raw PNG/JPEG bytes into a lightweight WebP data URI for Firestore."""
    img = Image.open(io.BytesIO(image_bytes)).convert("RGB")
    img.thumbnail((max_size, max_size), Image.Resampling.LANCZOS)
    buf = io.BytesIO()
    img.save(buf, format="WEBP", quality=quality)
    b64 = base64.b64encode(buf.getvalue()).decode("ascii")
    return f"data:image/webp;base64,{b64}"


def run_comfyui_txt2img(
    job_id: str,
    prompt_text: str,
    style_preset: dict[str, Any],
    vram_mode: str = "low_vram",
    comfy_url: str = COMFYUI_URL,
    output_dir: Path = OUTPUT_DIR,
) -> dict[str, str]:
    """Execute txt2img via ComfyUI API, save PNG to Drive, and return relative path + WebP thumbnail."""
    free_comfyui_vram(comfy_url)
    workflow = build_txt2img_workflow(prompt_text, style_preset, vram_mode=vram_mode)

    payload = json.dumps({"prompt": workflow, "client_id": f"huishi-{job_id}"}).encode("utf-8")
    req = urllib.request.Request(
        f"{comfy_url}/prompt",
        data=payload,
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=30) as resp:
        prompt_id = json.loads(resp.read().decode("utf-8"))["prompt_id"]

    # Poll /history/{prompt_id}
    image_meta = None
    for _ in range(180):
        with urllib.request.urlopen(f"{comfy_url}/history/{prompt_id}", timeout=15) as hresp:
            history = json.loads(hresp.read().decode("utf-8"))
        if prompt_id in history:
            outputs = history[prompt_id].get("outputs", {})
            for node_out in outputs.values():
                images = node_out.get("images") or []
                if images:
                    image_meta = images[0]
                    break
            if image_meta:
                break
        time.sleep(1.0)

    if not image_meta:
        raise TimeoutError(f"ComfyUI prompt {prompt_id} did not produce output image")

    query = urllib.parse.urlencode({
        "filename": image_meta["filename"],
        "subfolder": image_meta.get("subfolder", ""),
        "type": image_meta.get("type", "output"),
    })
    with urllib.request.urlopen(f"{comfy_url}/view?{query}", timeout=30) as vresp:
        raw_bytes = vresp.read()

    images_dir = output_dir / "images"
    images_dir.mkdir(parents=True, exist_ok=True)
    rel_path = f"images/{job_id}.png"
    (output_dir / rel_path).write_bytes(raw_bytes)

    thumb_webp = compress_to_webp_data_uri(raw_bytes)
    return {
        "output_drive_path": rel_path,
        "thumbnail_webp": thumb_webp,
    }


HIGH_VRAM_I2V_MODEL = os.getenv("HUISHI_I2V_HIGH", "wan2.1_i2v_720p_14B_fp16.safetensors")
LOW_VRAM_I2V_MODEL = os.getenv("HUISHI_I2V_LOW", "wan2.1_i2v_480p_1.3B_fp8.safetensors")


def build_i2v_workflow(
    uploaded_image_name: str,
    prompt_text: str,
    video_style_preset: Optional[dict[str, Any]] = None,
    vram_mode: str = "low_vram",
    seed: Optional[int] = None,
) -> dict[str, Any]:
    """Build ComfyUI Image-to-Video workflow adapted to high_vram vs low_vram."""
    preset = video_style_preset or {}
    pos_tpl = preset.get("positivePromptTemplate") or "{prompt}, smooth cinematic motion"
    positive = pos_tpl.replace("{prompt}", prompt_text) if "{prompt}" in pos_tpl else f"{prompt_text}, {pos_tpl}"
    negative = preset.get("negativePromptTemplate") or "flickering, morphing, distorted, blurry"
    sampler = preset.get("sampler") or "euler"
    steps = int(preset.get("steps") or 20)
    cfg = float(preset.get("cfgScale") or 6.0)
    is_high = vram_mode == "high_vram"
    model_name = HIGH_VRAM_I2V_MODEL if is_high else LOW_VRAM_I2V_MODEL
    width, height = (1024, 576) if is_high else (768, 432)
    actual_seed = seed if seed is not None else int(time.time() * 1000) % (2**31 - 1)

    return {
        "1": {
            "class_type": "LoadImage",
            "inputs": {"image": uploaded_image_name},
        },
        "2": {
            "class_type": "CheckpointLoaderSimple",
            "inputs": {"ckpt_name": model_name},
        },
        "3": {
            "class_type": "CLIPTextEncode",
            "inputs": {"text": positive, "clip": ["2", 1]},
        },
        "4": {
            "class_type": "CLIPTextEncode",
            "inputs": {"text": negative, "clip": ["2", 1]},
        },
        "5": {
            "class_type": "WanImageToVideo",
            "inputs": {
                "positive": ["3", 0],
                "negative": ["4", 0],
                "vae": ["2", 2],
                "start_image": ["1", 0],
                "width": width,
                "height": height,
                "length": 49,
                "batch_size": 1,
            },
        },
        "6": {
            "class_type": "KSampler",
            "inputs": {
                "seed": actual_seed,
                "steps": steps,
                "cfg": cfg,
                "sampler_name": sampler,
                "scheduler": "normal",
                "denoise": 1.0,
                "model": ["2", 0],
                "positive": ["5", 0],
                "negative": ["5", 1],
                "latent_image": ["5", 2],
            },
        },
        "7": {
            "class_type": "VAEDecode",
            "inputs": {"samples": ["6", 0], "vae": ["2", 2]},
        },
        "8": {
            "class_type": "VHS_VideoCombine",
            "inputs": {
                "images": ["7", 0],
                "frame_rate": 16,
                "format": "video/h264-mp4",
                "filename_prefix": "huishi_i2v",
            },
        },
    }


def upload_image_to_comfyui(image_path: Path, comfy_url: str = COMFYUI_URL) -> str:
    """Upload keyframe PNG to ComfyUI /upload/image using multipart/form-data."""
    boundary = f"----HuishiBoundary{int(time.time() * 1000)}"
    img_bytes = image_path.read_bytes()
    body = (
        f"--{boundary}\r\n"
        f'Content-Disposition: form-data; name="image"; filename="{image_path.name}"\r\n'
        f"Content-Type: image/png\r\n\r\n"
    ).encode("utf-8") + img_bytes + f"\r\n--{boundary}--\r\n".encode("utf-8")

    req = urllib.request.Request(
        f"{comfy_url}/upload/image",
        data=body,
        headers={"Content-Type": f"multipart/form-data; boundary={boundary}"},
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=30) as resp:
        data = json.loads(resp.read().decode("utf-8"))
    return data.get("name", image_path.name)


def run_comfyui_i2v(
    job_id: str,
    shot_id: str,
    keyframe_drive_path: str,
    prompt_text: str,
    video_style_preset: Optional[dict[str, Any]] = None,
    vram_mode: str = "low_vram",
    comfy_url: str = COMFYUI_URL,
    output_dir: Path = OUTPUT_DIR,
) -> dict[str, str]:
    """ADR-03: Unload previous model via /free, then run ComfyUI I2V and save MP4 to Drive."""
    free_comfyui_vram(comfy_url)
    uploaded_name = upload_image_to_comfyui(output_dir / keyframe_drive_path, comfy_url=comfy_url)
    workflow = build_i2v_workflow(
        uploaded_image_name=uploaded_name,
        prompt_text=prompt_text,
        video_style_preset=video_style_preset,
        vram_mode=vram_mode,
    )

    payload = json.dumps({"prompt": workflow, "client_id": f"huishi-{job_id}-{shot_id}"}).encode("utf-8")
    req = urllib.request.Request(
        f"{comfy_url}/prompt",
        data=payload,
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=30) as resp:
        prompt_id = json.loads(resp.read().decode("utf-8"))["prompt_id"]

    video_meta = None
    for _ in range(300):
        with urllib.request.urlopen(f"{comfy_url}/history/{prompt_id}", timeout=15) as hresp:
            history = json.loads(hresp.read().decode("utf-8"))
        if prompt_id in history:
            outputs = history[prompt_id].get("outputs", {})
            for node_out in outputs.values():
                gifs = node_out.get("gifs") or node_out.get("videos") or []
                if gifs:
                    video_meta = gifs[0]
                    break
            if video_meta:
                break
        time.sleep(1.5)

    if not video_meta:
        raise TimeoutError(f"ComfyUI I2V prompt {prompt_id} did not produce output video")

    query = urllib.parse.urlencode({
        "filename": video_meta["filename"],
        "subfolder": video_meta.get("subfolder", ""),
        "type": video_meta.get("type", "output"),
    })
    with urllib.request.urlopen(f"{comfy_url}/view?{query}", timeout=60) as vresp:
        raw_mp4 = vresp.read()

    videos_dir = output_dir / "videos"
    videos_dir.mkdir(parents=True, exist_ok=True)
    rel_path = f"videos/{job_id}_{shot_id}.mp4"
    (output_dir / rel_path).write_bytes(raw_mp4)
    return {"video_path": rel_path}
