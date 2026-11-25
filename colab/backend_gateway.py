"""
繪師 (Huishi) — BackendGateway (FastAPI on Google Colab)
ADR-02: Firebase Auth ID Token 簽章與單人 Email 白名單驗證
ADR-03: 動態 VRAM 偵測 (>=24GB L4/A100 高畫質 vs <24GB T4 GGUF/FP8)
Ticket #3: 單張生圖管線 (/render/image) 與 Range Request 媒體串流 (/media/{path})
"""

from __future__ import annotations

import mimetypes
import os
from datetime import datetime
from pathlib import Path
from typing import Any, Callable, Optional
from zoneinfo import ZoneInfo

from fastapi import BackgroundTasks, Depends, FastAPI, Header, HTTPException, Query, Request, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import Response, StreamingResponse
from pydantic import BaseModel

import comfy_client
import ffmpeg_composer

TAIPEI_TZ = ZoneInfo("Asia/Taipei")

ALLOWED_EMAIL = os.getenv("HUISHI_ALLOWED_EMAIL", "qseft951753@gmail.com").strip().lower()
FIREBASE_CRED_PATH = os.getenv(
    "FIREBASE_SERVICE_ACCOUNT_JSON",
    "/content/drive/MyDrive/麻糬紅豆湯/繪師/AI_Studio/config/serviceAccountKey.json",
)

_firebase_initialized = False


def init_firebase_admin() -> None:
    """Initialize Firebase Admin SDK lazily when service account file is available."""
    global _firebase_initialized
    if _firebase_initialized:
        return
    try:
        import firebase_admin
        from firebase_admin import credentials

        if not firebase_admin._apps:
            if os.path.exists(FIREBASE_CRED_PATH):
                cred = credentials.Certificate(FIREBASE_CRED_PATH)
                firebase_admin.initialize_app(cred)
            else:
                firebase_admin.initialize_app()
        _firebase_initialized = True
    except Exception:
        pass


def default_token_verifier(id_token: str) -> dict[str, Any]:
    """Verify Firebase Auth ID Token via firebase_admin.auth."""
    init_firebase_admin()
    from firebase_admin import auth

    return auth.verify_id_token(id_token)


_token_verifier: Callable[[str], dict[str, Any]] = default_token_verifier
_job_updater: Optional[Callable[[str, dict[str, Any]], None]] = None
_storyboard_updater: Optional[Callable[[str, dict[str, Any]], None]] = None
_txt2img_runner = comfy_client.run_comfyui_txt2img
_i2v_runner = comfy_client.run_comfyui_i2v


def set_token_verifier(verifier: Callable[[str], dict[str, Any]]) -> None:
    global _token_verifier
    _token_verifier = verifier


def set_job_updater(updater: Optional[Callable[[str, dict[str, Any]], None]]) -> None:
    global _job_updater
    _job_updater = updater


def set_storyboard_updater(updater: Optional[Callable[[str, dict[str, Any]], None]]) -> None:
    global _storyboard_updater
    _storyboard_updater = updater


def set_txt2img_runner(runner: Callable[..., dict[str, str]]) -> None:
    global _txt2img_runner
    _txt2img_runner = runner


def set_i2v_runner(runner: Callable[..., dict[str, str]]) -> None:
    global _i2v_runner
    _i2v_runner = runner


def update_render_job_doc(job_id: str, fields: dict[str, Any]) -> None:
    """Persist RenderJob state transitions to Firestore renderJobs/{job_id}."""
    if _job_updater is not None:
        _job_updater(job_id, fields)
        return
    try:
        init_firebase_admin()
        from firebase_admin import firestore

        db = firestore.client()
        db.collection("renderJobs").document(job_id).set(fields, merge=True)
    except Exception:
        pass


def update_storyboard_doc(storyboard_id: str, fields: dict[str, Any]) -> None:
    """Persist Storyboard and Shot progress to Firestore storyboards/{storyboard_id}."""
    if _storyboard_updater is not None:
        _storyboard_updater(storyboard_id, fields)
        return
    try:
        init_firebase_admin()
        from firebase_admin import firestore

        db = firestore.client()
        db.collection("storyboards").document(storyboard_id).set(fields, merge=True)
    except Exception:
        pass


def detect_gpu_vram() -> dict[str, Any]:
    """ADR-03: Detect GPU model and total VRAM using PyTorch."""
    try:
        import torch

        if torch.cuda.is_available():
            props = torch.cuda.get_device_properties(0)
            vram_gb = round(props.total_memory / (1024 ** 3), 2)
            vram_mode = "high_vram" if vram_gb >= 24.0 else "low_vram"
            workflow_tier = (
                "L4/A100 高畫質 Workflow" if vram_mode == "high_vram" else "T4 量化版 GGUF/FP8 Workflow"
            )
            return {
                "gpu_available": True,
                "gpu_name": props.name,
                "vram_gb": vram_gb,
                "vram_mode": vram_mode,
                "workflow_tier": workflow_tier,
            }
    except Exception:
        pass

    return {
        "gpu_available": False,
        "gpu_name": "CPU Fallback (No CUDA)",
        "vram_gb": 0.0,
        "vram_mode": "low_vram",
        "workflow_tier": "CPU / 模擬模式",
    }


def _verify_token_string(token: str) -> dict[str, Any]:
    try:
        decoded = _token_verifier(token)
    except Exception as exc:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail=f"Invalid or expired Firebase ID token: {exc}",
        ) from exc

    email = str(decoded.get("email", "")).strip().lower()
    email_verified = bool(decoded.get("email_verified", False))

    if not email or not email_verified or email != ALLOWED_EMAIL:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Email is not in BackendGateway whitelist",
        )
    return decoded


def verify_firebase_token(authorization: Optional[str] = Header(default=None)) -> dict[str, Any]:
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Missing or invalid Authorization Bearer token",
        )
    token = authorization.split(" ", 1)[1].strip()
    if not token:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Empty Bearer token")
    return _verify_token_string(token)


def verify_media_token(
    authorization: Optional[str] = Header(default=None),
    token: Optional[str] = Query(default=None),
) -> dict[str, Any]:
    raw_token = None
    if authorization and authorization.startswith("Bearer "):
        raw_token = authorization.split(" ", 1)[1].strip()
    elif token:
        raw_token = token.strip()

    if not raw_token:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Missing media authentication token",
        )
    return _verify_token_string(raw_token)


class RenderImageRequest(BaseModel):
    job_id: str
    prompt: str
    style_preset: dict[str, Any]


def _execute_single_image_job(job_id: str, prompt: str, style_preset: dict[str, Any]) -> None:
    update_render_job_doc(
        job_id,
        {
            "status": "processing",
            "progress": 20,
            "updatedAt": datetime.now(TAIPEI_TZ).isoformat(),
        },
    )
    try:
        gpu_info = detect_gpu_vram()
        result = _txt2img_runner(
            job_id=job_id,
            prompt_text=prompt,
            style_preset=style_preset,
            vram_mode=gpu_info["vram_mode"],
        )
        update_render_job_doc(
            job_id,
            {
                "status": "completed",
                "progress": 100,
                "outputDrivePath": result["output_drive_path"],
                "thumbnailWebp": result["thumbnail_webp"],
                "updatedAt": datetime.now(TAIPEI_TZ).isoformat(),
            },
        )
    except Exception as exc:
        update_render_job_doc(
            job_id,
            {
                "status": "failed",
                "progress": 0,
                "errorMessage": str(exc),
                "updatedAt": datetime.now(TAIPEI_TZ).isoformat(),
            },
        )


app = FastAPI(title="繪師 BackendGateway", version="0.3.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/health")
def health_check(user: dict[str, Any] = Depends(verify_firebase_token)) -> dict[str, Any]:
    gpu_info = detect_gpu_vram()
    return {
        "status": "online",
        "service": "BackendGateway",
        "app": "繪師",
        "user_email": user.get("email"),
        "checked_at_taipei": datetime.now(TAIPEI_TZ).isoformat(),
        **gpu_info,
    }


@app.post("/render/image")
def render_single_image(
    req: RenderImageRequest,
    background_tasks: BackgroundTasks,
    _user: dict[str, Any] = Depends(verify_firebase_token),
) -> dict[str, Any]:
    now_iso = datetime.now(TAIPEI_TZ).isoformat()
    update_render_job_doc(
        req.job_id,
        {
            "id": req.job_id,
            "kind": "single_image",
            "status": "queued",
            "progress": 5,
            "updatedAt": now_iso,
        },
    )
    background_tasks.add_task(_execute_single_image_job, req.job_id, req.prompt, req.style_preset)
    return {"job_id": req.job_id, "status": "queued", "accepted_at_taipei": now_iso}


class RenderStoryboardRequest(BaseModel):
    job_id: str
    storyboard_id: str
    storyboard: dict[str, Any]
    style_presets_map: dict[str, dict[str, Any]] = {}
    reroll_shot_id: Optional[str] = None


def _execute_storyboard_batch_job(req: RenderStoryboardRequest) -> None:
    shots: list[dict[str, Any]] = list(req.storyboard.get("shots") or [])
    total = max(1, len(shots))
    global_style_id = req.storyboard.get("globalStylePresetId")

    update_render_job_doc(
        req.job_id,
        {
            "status": "processing",
            "progress": 5,
            "updatedAt": datetime.now(TAIPEI_TZ).isoformat(),
        },
    )

    try:
        gpu_info = detect_gpu_vram()
        vram_mode = gpu_info["vram_mode"]

        for idx, shot in enumerate(shots):
            shot_id = shot.get("id", f"shot-{idx + 1}")
            is_reroll_target = req.reroll_shot_id == shot_id

            if req.reroll_shot_id and not is_reroll_target:
                continue

            # Testing Seam (斷點續傳): 跳過已完成之 Shot
            if (
                not req.reroll_shot_id
                and shot.get("status") == "completed"
                and shot.get("keyframeImagePath")
                and shot.get("videoPath")
            ):
                continue

            shot["status"] = "processing"
            update_storyboard_doc(
                req.storyboard_id,
                {"shots": shots, "updatedAt": datetime.now(TAIPEI_TZ).isoformat()},
            )

            img_style_id = shot.get("imageStylePresetId") or global_style_id
            img_preset = req.style_presets_map.get(img_style_id or "", {})
            vid_style_id = shot.get("videoStylePresetId")
            vid_preset = req.style_presets_map.get(vid_style_id or "", {})

            prompt_text = shot.get("visualDescription") or "cinematic scene"

            # 1. Keyframe txt2img
            img_res = _txt2img_runner(
                job_id=f"{req.job_id}_{shot_id}",
                prompt_text=prompt_text,
                style_preset=img_preset,
                vram_mode=vram_mode,
            )
            shot["keyframeImagePath"] = img_res["output_drive_path"]
            shot["keyframeThumbnailBase64"] = img_res["thumbnail_webp"]
            update_storyboard_doc(
                req.storyboard_id,
                {"shots": shots, "updatedAt": datetime.now(TAIPEI_TZ).isoformat()},
            )

            # 2. Image-to-Video I2V (內部強制呼叫 /free 釋放顯存)
            vid_res = _i2v_runner(
                job_id=req.job_id,
                shot_id=shot_id,
                keyframe_drive_path=img_res["output_drive_path"],
                prompt_text=prompt_text,
                video_style_preset=vid_preset,
                vram_mode=vram_mode,
            )
            shot["videoPath"] = vid_res["video_path"]
            shot["status"] = "completed"
            update_storyboard_doc(
                req.storyboard_id,
                {"shots": shots, "updatedAt": datetime.now(TAIPEI_TZ).isoformat()},
            )

            completed_cnt = sum(1 for s in shots if s.get("status") == "completed")
            update_render_job_doc(
                req.job_id,
                {
                    "progress": int((completed_cnt / total) * 100),
                    "updatedAt": datetime.now(TAIPEI_TZ).isoformat(),
                },
            )

        update_render_job_doc(
            req.job_id,
            {
                "status": "completed",
                "progress": 100,
                "updatedAt": datetime.now(TAIPEI_TZ).isoformat(),
            },
        )
    except Exception as exc:
        for s in shots:
            if s.get("status") == "processing":
                s["status"] = "failed"
        update_storyboard_doc(
            req.storyboard_id,
            {"shots": shots, "updatedAt": datetime.now(TAIPEI_TZ).isoformat()},
        )
        update_render_job_doc(
            req.job_id,
            {
                "status": "failed",
                "errorMessage": str(exc),
                "updatedAt": datetime.now(TAIPEI_TZ).isoformat(),
            },
        )


@app.post("/render/storyboard")
def render_storyboard_batch(
    req: RenderStoryboardRequest,
    background_tasks: BackgroundTasks,
    _user: dict[str, Any] = Depends(verify_firebase_token),
) -> dict[str, Any]:
    now_iso = datetime.now(TAIPEI_TZ).isoformat()
    update_render_job_doc(
        req.job_id,
        {
            "id": req.job_id,
            "kind": "storyboard_batch",
            "storyboardId": req.storyboard_id,
            "status": "queued",
            "progress": 0,
            "updatedAt": now_iso,
        },
    )
    background_tasks.add_task(_execute_storyboard_batch_job, req)
    return {"job_id": req.job_id, "status": "queued", "accepted_at_taipei": now_iso}


class RenderExportRequest(BaseModel):
    job_id: str
    storyboard_id: str
    shots: list[dict[str, Any]]
    bgm_filename: Optional[str] = None
    burn_subtitles: bool = True


def _execute_export_job(req: RenderExportRequest) -> None:
    update_render_job_doc(
        req.job_id,
        {
            "status": "processing",
            "progress": 25,
            "updatedAt": datetime.now(TAIPEI_TZ).isoformat(),
        },
    )
    try:
        res = ffmpeg_composer.compose_storyboard_video(
            job_id=req.job_id,
            shots=req.shots,
            bgm_filename=req.bgm_filename,
            burn_subtitles=req.burn_subtitles,
        )
        update_render_job_doc(
            req.job_id,
            {
                "status": "completed",
                "progress": 100,
                "outputDrivePath": res["output_drive_path"],
                "updatedAt": datetime.now(TAIPEI_TZ).isoformat(),
            },
        )
    except Exception as exc:
        update_render_job_doc(
            req.job_id,
            {
                "status": "failed",
                "progress": 0,
                "errorMessage": str(exc),
                "updatedAt": datetime.now(TAIPEI_TZ).isoformat(),
            },
        )


@app.get("/bgm")
def list_available_bgm(_user: dict[str, Any] = Depends(verify_firebase_token)) -> dict[str, Any]:
    return {"files": ffmpeg_composer.list_bgm_files()}


@app.post("/render/export")
def render_final_export(
    req: RenderExportRequest,
    background_tasks: BackgroundTasks,
    _user: dict[str, Any] = Depends(verify_firebase_token),
) -> dict[str, Any]:
    now_iso = datetime.now(TAIPEI_TZ).isoformat()
    update_render_job_doc(
        req.job_id,
        {
            "id": req.job_id,
            "kind": "ffmpeg_export",
            "storyboardId": req.storyboard_id,
            "status": "queued",
            "progress": 5,
            "updatedAt": now_iso,
        },
    )
    background_tasks.add_task(_execute_export_job, req)
    return {"job_id": req.job_id, "status": "queued", "accepted_at_taipei": now_iso}


@app.get("/media/{media_path:path}")
def stream_media(
    media_path: str,
    request: Request,
    _user: dict[str, Any] = Depends(verify_media_token),
):
    base_dir = comfy_client.OUTPUT_DIR.resolve()
    target = (base_dir / media_path).resolve()
    if not str(target).startswith(str(base_dir)) or not target.is_file():
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Media file not found")

    file_size = target.stat().st_size
    content_type = mimetypes.guess_type(str(target))[0] or "application/octet-stream"
    range_header = request.headers.get("range")

    if range_header and range_header.startswith("bytes="):
        spec = range_header.replace("bytes=", "", 1).split(",")[0].strip()
        start_str, end_str = spec.split("-", 1)
        start = int(start_str) if start_str else 0
        end = int(end_str) if end_str else file_size - 1
        end = min(end, file_size - 1)
        if start > end or start >= file_size:
            raise HTTPException(status_code=416, detail="Requested Range Not Satisfiable")
        chunk_len = end - start + 1

        def iter_range():
            with open(target, "rb") as f:
                f.seek(start)
                remaining = chunk_len
                while remaining > 0:
                    data = f.read(min(65536, remaining))
                    if not data:
                        break
                    remaining -= len(data)
                    yield data

        return StreamingResponse(
            iter_range(),
            status_code=206,
            media_type=content_type,
            headers={
                "Content-Range": f"bytes {start}-{end}/{file_size}",
                "Accept-Ranges": "bytes",
                "Content-Length": str(chunk_len),
            },
        )

    return Response(
        content=target.read_bytes(),
        media_type=content_type,
        headers={"Accept-Ranges": "bytes", "Content-Length": str(file_size)},
    )
