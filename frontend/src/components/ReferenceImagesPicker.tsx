import React, { useRef, useState } from 'react';

export type ReferenceMode = 'face' | 'subject';

interface ReferenceImagesPickerProps {
  images: string[];
  mode: ReferenceMode;
  weight: number;
  onChangeImages: (next: string[]) => void;
  onChangeMode: (next: ReferenceMode) => void;
  onChangeWeight: (next: number) => void;
  label?: string;
}

const MAX_REF_IMAGES = 4;

async function compressFileToDataUrl(file: File, maxDim = 768): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('讀取參考圖失敗'));
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error('圖片格式不支援'));
      img.onload = () => {
        const scale = Math.min(1, maxDim / Math.max(img.width, img.height));
        const w = Math.max(64, Math.round(img.width * scale));
        const h = Math.max(64, Math.round(img.height * scale));
        const canvas = document.createElement('canvas');
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          resolve(String(reader.result));
          return;
        }
        ctx.drawImage(img, 0, 0, w, h);
        resolve(canvas.toDataURL('image/jpeg', 0.86));
      };
      img.src = String(reader.result);
    };
    reader.readAsDataURL(file);
  });
}

export const ReferenceImagesPicker: React.FC<ReferenceImagesPickerProps> = ({
  images,
  mode,
  weight,
  onChangeImages,
  onChangeMode,
  onChangeWeight,
  label = '參考主體／人臉鎖定（選填，最多 4 張）',
}) => {
  const [expanded, setExpanded] = useState(false);
  const [loading, setLoading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const handleFilesSelected = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    if (files.length === 0) return;
    setLoading(true);
    try {
      const slotsLeft = MAX_REF_IMAGES - images.length;
      const toProcess = files.slice(0, Math.max(0, slotsLeft));
      const encoded = await Promise.all(toProcess.map((f) => compressFileToDataUrl(f)));
      onChangeImages([...images, ...encoded].slice(0, MAX_REF_IMAGES));
      if (!expanded) setExpanded(true);
    } finally {
      setLoading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const removeAt = (idx: number) => {
    onChangeImages(images.filter((_, i) => i !== idx));
  };

  return (
    <div className="border-t border-white/10 pt-2.5 space-y-2">
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="w-full min-h-[48px] px-3 bg-[#0E0F12] border border-white/14 hover:border-white/30 text-xs text-[#9A9E9C] flex items-center justify-between active:scale-[0.98] transition-all"
        data-testid="toggle-reference-picker-btn"
      >
        <span className="truncate pr-2">
          {label}
          {images.length > 0 && (
            <span className="dj-tnum ml-1.5 text-[#4C7C62]">
              （已選 {images.length} 張 / {mode === 'face' ? '鎖人臉' : '鎖主體'}）
            </span>
          )}
        </span>
        <span
          className={`dj-tnum text-[10px] shrink-0 transition-transform duration-300 ${
            expanded ? 'rotate-180' : ''
          }`}
        >
          ▼
        </span>
      </button>

      <div className={`dj-accordion ${expanded ? 'is-open' : ''}`}>
        <div className="dj-accordion-inner">
          <div className="pt-2.5 space-y-3">
            {/* 鎖定模式切換 */}
            <div className="grid grid-cols-2 gap-1.5">
              {(
                [
                  { id: 'face' as const, title: '鎖定人臉', sub: 'FaceID / PuLID' },
                  { id: 'subject' as const, title: '鎖定主體／物品', sub: 'IP-Adapter / Redux' },
                ] as const
              ).map((item) => {
                const active = mode === item.id;
                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => onChangeMode(item.id)}
                    className={`min-h-[48px] px-2.5 py-1.5 border text-left transition-all active:scale-[0.96] ${
                      active
                        ? 'bg-[#F4F4F0] text-[#0E0F12] border-[#F4F4F0]'
                        : 'bg-[#0E0F12] text-[#9A9E9C] border-white/14 hover:border-white/30'
                    }`}
                  >
                    <span className="block text-xs font-medium">{item.title}</span>
                    <span
                      className={`dj-tnum block text-[10px] ${
                        active ? 'text-[#0E0F12]/70' : 'text-[#6E7371]'
                      }`}
                    >
                      {item.sub}
                    </span>
                  </button>
                );
              })}
            </div>

            {/* 相似度權重滑桿 */}
            <div className="space-y-1">
              <div className="flex items-center justify-between text-[11px]">
                <span className="text-[#9A9E9C]">參考鎖定強度（建議 0.65 ~ 0.85）</span>
                <span className="dj-tnum text-[#F4F4F0]">{weight.toFixed(2)}</span>
              </div>
              <input
                type="range"
                min={0.35}
                max={1.0}
                step={0.05}
                value={weight}
                onChange={(e) => onChangeWeight(Number(e.target.value))}
                className="w-full accent-[#F4F4F0] h-2 bg-white/10 cursor-pointer"
              />
            </div>

            {/* 參考圖上傳與縮圖列 */}
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              multiple
              onChange={handleFilesSelected}
              className="hidden"
            />

            <div className="flex items-center gap-2">
              <button
                type="button"
                disabled={loading || images.length >= MAX_REF_IMAGES}
                onClick={() => fileInputRef.current?.click()}
                className="flex-1 min-h-[48px] px-3 border border-white/25 bg-[#0E0F12] text-xs tracking-wider text-[#F4F4F0] hover:border-white/50 active:scale-[0.97] transition-all disabled:opacity-40"
              >
                {loading
                  ? '壓縮載入中...'
                  : images.length >= MAX_REF_IMAGES
                    ? `已達上限 (${MAX_REF_IMAGES}/${MAX_REF_IMAGES})`
                    : `選擇參考照片（${images.length}/${MAX_REF_IMAGES}）`}
              </button>
              {images.length > 0 && (
                <button
                  type="button"
                  onClick={() => onChangeImages([])}
                  className="min-h-[48px] px-3 border border-[#B86B4B]/50 text-xs text-[#B86B4B] hover:border-[#B86B4B] active:scale-[0.96] transition-all"
                >
                  清空
                </button>
              )}
            </div>

            {images.length > 0 && (
              <div className="grid grid-cols-4 gap-2">
                {images.map((src, idx) => (
                  <div
                    key={idx}
                    className="relative aspect-square border border-white/14 bg-[#0E0F12] overflow-hidden"
                  >
                    <img
                      src={src}
                      alt={`Reference ${idx + 1}`}
                      className="w-full h-full object-cover"
                    />
                    <button
                      type="button"
                      aria-label={`移除參考圖 ${idx + 1}`}
                      onClick={() => removeAt(idx)}
                      className="absolute top-0 right-0 w-6 h-6 bg-[#0E0F12]/85 text-[#F4F4F0] text-[11px] flex items-center justify-center border-l border-b border-white/20"
                    >
                      ×
                    </button>
                  </div>
                ))}
              </div>
            )}

            <p className="text-[10px] text-[#6E7371] leading-relaxed">
              建議上傳 2～4 張同人物／物品的不同角度清晰照，系統會自動融合立體特徵；SDXL 底模走 IP-Adapter/FaceID，FLUX 底模走 PuLID/Redux。
            </p>
          </div>
        </div>
      </div>
    </div>
  );
};
