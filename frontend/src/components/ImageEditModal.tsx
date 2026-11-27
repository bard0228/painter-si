import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { RenderJob, StylePreset } from '../types/domain';
import { translatePromptToEnglish } from '../services/promptTranslator';
import { ArchSelect } from './ArchSelect';

interface ImageEditModalProps {
  open: boolean;
  sourceJob: RenderJob | null;
  presets: StylePreset[];
  defaultPresetId: string;
  onClose: () => void;
  onSubmitEdit: (payload: {
    sourceJob: RenderJob;
    prompt: string;
    stylePreset: StylePreset;
    denoise: number;
    maskBase64: string | null;
  }) => Promise<void>;
}

export const ImageEditModal: React.FC<ImageEditModalProps> = ({
  open,
  sourceJob,
  presets,
  defaultPresetId,
  onClose,
  onSubmitEdit,
}) => {
  const [mode, setMode] = useState<'img2img' | 'inpaint'>('img2img');
  const [prompt, setPrompt] = useState('');
  const [presetId, setPresetId] = useState(defaultPresetId);
  const [denoise, setDenoise] = useState(0.45);
  const [brushSize, setBrushSize] = useState(28);
  const [hasPainted, setHasPainted] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const imgRef = useRef<HTMLImageElement | null>(null);
  const drawingRef = useRef(false);
  const lastPosRef = useRef<{ x: number; y: number } | null>(null);

  useEffect(() => {
    if (!open || !sourceJob) return;
    setMode('img2img');
    setPrompt('');
    setPresetId(sourceJob.stylePresetId || defaultPresetId);
    setDenoise(0.45);
    setHasPainted(false);
    setError(null);
  }, [open, sourceJob, defaultPresetId]);

  const syncCanvasSize = () => {
    const canvas = canvasRef.current;
    const img = imgRef.current;
    if (!canvas || !img) return;
    const w = img.naturalWidth || 512;
    const h = img.naturalHeight || 512;
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w;
      canvas.height = h;
    }
  };

  const getCanvasCoords = (clientX: number, clientY: number) => {
    const canvas = canvasRef.current;
    if (!canvas) return { x: 0, y: 0 };
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / Math.max(1, rect.width);
    const scaleY = canvas.height / Math.max(1, rect.height);
    return {
      x: (clientX - rect.left) * scaleX,
      y: (clientY - rect.top) * scaleY,
    };
  };

  const drawStroke = (x: number, y: number) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const scaledBrush = Math.max(8, (brushSize / 320) * canvas.width);
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.strokeStyle = 'rgba(244, 244, 240, 0.85)';
    ctx.fillStyle = 'rgba(244, 244, 240, 0.85)';
    ctx.lineWidth = scaledBrush;

    const prev = lastPosRef.current;
    if (prev) {
      ctx.beginPath();
      ctx.moveTo(prev.x, prev.y);
      ctx.lineTo(x, y);
      ctx.stroke();
    } else {
      ctx.beginPath();
      ctx.arc(x, y, scaledBrush / 2, 0, Math.PI * 2);
      ctx.fill();
    }
    lastPosRef.current = { x, y };
    setHasPainted(true);
  };

  const handlePointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    drawingRef.current = true;
    const pt = getCanvasCoords(e.clientX, e.clientY);
    lastPosRef.current = null;
    drawStroke(pt.x, pt.y);
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!drawingRef.current) return;
    const pt = getCanvasCoords(e.clientX, e.clientY);
    drawStroke(pt.x, pt.y);
  };

  const handlePointerUp = () => {
    drawingRef.current = false;
    lastPosRef.current = null;
  };

  const clearMask = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (ctx) ctx.clearRect(0, 0, canvas.width, canvas.height);
    setHasPainted(false);
  };

  const exportBinaryMaskPng = (): string | null => {
    const srcCanvas = canvasRef.current;
    if (!srcCanvas || !hasPainted) return null;

    const out = document.createElement('canvas');
    out.width = srcCanvas.width;
    out.height = srcCanvas.height;
    const octx = out.getContext('2d');
    if (!octx) return null;

    // Black background = keep original; White painted strokes = repaint area
    octx.fillStyle = '#000000';
    octx.fillRect(0, 0, out.width, out.height);
    octx.drawImage(srcCanvas, 0, 0);

    const imgData = octx.getImageData(0, 0, out.width, out.height);
    const d = imgData.data;
    for (let i = 0; i < d.length; i += 4) {
      const bright = d[i] > 20 || d[i + 1] > 20 || d[i + 2] > 20;
      const v = bright ? 255 : 0;
      d[i] = v;
      d[i + 1] = v;
      d[i + 2] = v;
      d[i + 3] = 255;
    }
    octx.putImageData(imgData, 0, 0);
    return out.toDataURL('image/png');
  };

  if (!open || !sourceJob || typeof document === 'undefined') return null;

  const selectedPreset = presets.find((p) => p.id === presetId) || presets[0] || null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!prompt.trim()) {
      setError('請輸入修改指令（支援中文）');
      return;
    }
    if (!selectedPreset) {
      setError('找不到可用的 StylePreset');
      return;
    }
    if (mode === 'inpaint' && !hasPainted) {
      setError('局部重繪模式請先用手指在圖片上塗抹要修改的區域');
      return;
    }

    setSubmitting(true);
    setError(null);
    try {
      const { englishPrompt } = await translatePromptToEnglish(prompt);
      const maskBase64 = mode === 'inpaint' ? exportBinaryMaskPng() : null;
      await onSubmitEdit({
        sourceJob,
        prompt: englishPrompt,
        stylePreset: selectedPreset,
        denoise,
        maskBase64,
      });
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSubmitting(false);
    }
  };

  return createPortal(
    <div
      className="fixed inset-0 z-[125] flex items-center justify-center p-4 bg-black/80 backdrop-blur-[5px]"
      onClick={onClose}
    >
      <div
        className="dj-modal-enter w-full max-w-[390px] max-h-[88vh] overflow-y-auto bg-[#121418] border border-white/25 p-4 space-y-4 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label="微調與局部重繪"
      >
        <div className="flex items-center justify-between border-b border-white/14 pb-2.5">
          <div>
            <h3 className="dj-serif text-sm font-semibold tracking-widest text-[#F4F4F0]">
              影像微調 / 局部重繪
            </h3>
            <p className="dj-tnum text-[10px] text-[#6E7371]">IMG2IMG & INPAINT</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="min-w-[48px] min-h-[48px] border border-white/14 text-xs text-[#9A9E9C] hover:text-[#F4F4F0]"
          >
            ✕
          </button>
        </div>

        {/* 模式切換 */}
        <div className="grid grid-cols-2 gap-2">
          {[
            { id: 'img2img' as const, label: '全圖微調 (Img2Img)' },
            { id: 'inpaint' as const, label: '局部塗抹 (Inpaint)' },
          ].map((m) => (
            <button
              key={m.id}
              type="button"
              onClick={() => {
                setMode(m.id);
                if (m.id === 'inpaint') setDenoise(0.65);
                else setDenoise(0.45);
              }}
              className={`min-h-[48px] border text-[11px] font-medium tracking-wider transition-all active:scale-[0.96] ${
                mode === m.id
                  ? 'bg-[#F4F4F0] text-[#0E0F12] border-[#F4F4F0]'
                  : 'bg-[#181A1E] text-[#9A9E9C] border-white/14'
              }`}
            >
              {m.label}
            </button>
          ))}
        </div>

        {/* 圖片與塗抹畫布 */}
        {sourceJob.thumbnailWebp && (
          <div className="space-y-2">
            <div className="relative border border-white/20 bg-black overflow-hidden">
              <img
                ref={imgRef}
                src={sourceJob.thumbnailWebp}
                alt="Source"
                onLoad={syncCanvasSize}
                className="w-full h-auto block select-none pointer-events-none"
              />
              {mode === 'inpaint' && (
                <canvas
                  ref={canvasRef}
                  onPointerDown={handlePointerDown}
                  onPointerMove={handlePointerMove}
                  onPointerUp={handlePointerUp}
                  onPointerCancel={handlePointerUp}
                  style={{ touchAction: 'none' }}
                  className="absolute inset-0 w-full h-full cursor-crosshair"
                />
              )}
            </div>

            {mode === 'inpaint' && (
              <div className="flex items-center justify-between gap-3 pt-1">
                <label className="flex items-center gap-2 flex-1">
                  <span className="text-[11px] text-[#9A9E9C] shrink-0">筆刷 {brushSize}px</span>
                  <input
                    type="range"
                    min={12}
                    max={64}
                    value={brushSize}
                    onChange={(e) => setBrushSize(Number(e.target.value))}
                    className="w-full accent-[#F4F4F0]"
                  />
                </label>
                <button
                  type="button"
                  onClick={clearMask}
                  className="min-h-[48px] px-3 border border-white/14 text-[11px] text-[#9A9E9C] hover:text-[#F4F4F0]"
                >
                  清除塗抹
                </button>
              </div>
            )}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-3.5">
          <div className="space-y-1.5">
            <span className="text-xs text-[#9A9E9C] block">套用風格 (StylePreset)</span>
            <ArchSelect
              value={selectedPreset?.id || ''}
              onChange={setPresetId}
              options={presets.map((p) => ({ value: p.id, label: p.name }))}
            />
          </div>

          <label className="block space-y-1.5">
            <div className="flex items-center justify-between text-xs">
              <span className="text-[#9A9E9C]">修改幅度 (Denoise)</span>
              <span className="dj-tnum text-[#F4F4F0]">
                {denoise.toFixed(2)}{' '}
                {denoise <= 0.4 ? '細微修正' : denoise <= 0.6 ? '中度修改' : '大幅重繪'}
              </span>
            </div>
            <input
              type="range"
              min={0.2}
              max={0.85}
              step={0.05}
              value={denoise}
              onChange={(e) => setDenoise(Number(e.target.value))}
              className="w-full accent-[#F4F4F0]"
            />
          </label>

          <label className="block space-y-1.5">
            <div className="flex items-center justify-between">
              <span className="text-xs text-[#9A9E9C]">修改描述（支援中文自動轉英文）</span>
            </div>
            <textarea
              rows={2}
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              placeholder={
                mode === 'inpaint'
                  ? '描述塗抹區域想改成什麼，例如：換成溫暖的微笑表情'
                  : '描述想微調的方向，例如：背景改成星空與滿月，光影更柔和'
              }
              className="w-full p-3 bg-[#0E0F12] border border-white/14 text-xs text-[#F4F4F0] placeholder:text-[#6E7371] focus:outline-none focus:border-white/40"
            />
          </label>

          {error && (
            <div className="p-2.5 border border-[#B86B4B] bg-[#B86B4B]/10 text-xs text-[#F4F4F0]">
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={submitting}
            className="dj-btn dj-btn-primary w-full text-xs"
            data-testid="submit-edit-btn"
          >
            {submitting
              ? '送出修改任務中...'
              : mode === 'inpaint'
                ? '送出局部重繪 (Inpaint)'
                : '送出全圖微調 (Img2Img)'}
          </button>
        </form>
      </div>
    </div>,
    document.body
  );
};
