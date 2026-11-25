import React, { useEffect, useMemo, useState } from 'react';
import type { User } from 'firebase/auth';
import { isFirebaseConfigured } from '../config/firebase';
import { subscribeStylePresets } from '../services/stylePresetService';
import { subscribeRenderJobs, submitSingleImageRenderJob } from '../services/renderJobService';
import type { GatewayConfig, RenderJob, StylePreset } from '../types/domain';
import { ArchSelect } from './ArchSelect';

interface SingleImageStudioProps {
  user: User | null;
  gatewayConfig: GatewayConfig | null;
}

export const SingleImageStudio: React.FC<SingleImageStudioProps> = ({
  user,
  gatewayConfig,
}) => {
  const useCloud = Boolean(user && isFirebaseConfigured);
  const [presets, setPresets] = useState<StylePreset[]>([]);
  const [selectedPresetId, setSelectedPresetId] = useState<string>('');
  const [prompt, setPrompt] = useState('');
  const [jobs, setJobs] = useState<RenderJob[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const unsub = subscribeStylePresets(
      useCloud,
      (items) => {
        const imgs = items.filter((p) => p.type === 'image');
        setPresets(imgs);
        if (imgs.length > 0 && !imgs.some((p) => p.id === selectedPresetId)) {
          setSelectedPresetId(imgs[0].id);
        }
      },
      (err) => setError(`讀取風格失敗：${err.message}`)
    );
    return () => unsub();
  }, [useCloud, selectedPresetId]);

  useEffect(() => {
    const unsub = subscribeRenderJobs(
      useCloud,
      (items) => setJobs(items.filter((j) => j.kind === 'single_image')),
      (err) => setError(`讀取算圖紀錄失敗：${err.message}`)
    );
    return () => unsub();
  }, [useCloud]);

  const selectedPreset = useMemo(
    () => presets.find((p) => p.id === selectedPresetId) || presets[0] || null,
    [presets, selectedPresetId]
  );

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!prompt.trim()) {
      setError('請輸入畫面提示詞');
      return;
    }
    if (!selectedPreset) {
      setError('請先於 [ 02 ] 建立或匯入圖片 StylePreset');
      return;
    }
    if (useCloud && !gatewayConfig?.url) {
      setError('Colab BackendGateway 尚未連線，無法送出雲端算圖任務');
      return;
    }

    setSubmitting(true);
    setError(null);
    try {
      const created = await submitSingleImageRenderJob({
        useCloud,
        gatewayUrl: gatewayConfig?.url,
        user,
        prompt,
        stylePreset: selectedPreset,
      });
      if (!useCloud) {
        setJobs((prev) => [created, ...prev]);
      }
      setPrompt('');
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <section className="dj-tab-enter space-y-5">
      <div className="flex items-center justify-between border-b border-white/14 pb-3">
        <div className="flex items-center gap-2.5">
          <span className="dj-tnum text-xs tracking-widest text-[#6E7371]">[ 03 ]</span>
          <h2 className="dj-serif text-base font-semibold tracking-wider text-[#F4F4F0]">
            單張生圖管線
          </h2>
        </div>
        <span className="dj-tnum text-[11px] tracking-widest px-2.5 py-1 border border-white/14 text-[#9A9E9C]">
          {gatewayConfig?.vramMode === 'high_vram' ? 'L4/A100' : 'T4/LOCAL'}
        </span>
      </div>

      <form onSubmit={handleSubmit} className="dj-surface-card p-4 space-y-3.5">
        <div className="space-y-1.5">
          <span className="text-xs text-[#9A9E9C] block">圖片風格 (StylePreset)</span>
          <ArchSelect
            value={selectedPreset?.id || ''}
            onChange={setSelectedPresetId}
            placeholder="尚無圖片風格預設"
            options={presets.map((p) => ({
              value: p.id,
              label: `${p.name} (${p.sampler} / ${p.steps} steps)`,
            }))}
          />
        </div>

        <label className="block space-y-1.5">
          <span className="text-xs text-[#9A9E9C]">畫面描述 (Prompt)</span>
          <textarea
            rows={3}
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            placeholder="例如：雨夜中的東京建築巷弄，微弱松綠霓虹倒映於濕潤石板路"
            className="w-full p-3 bg-[#0E0F12] border border-white/14 text-sm text-[#F4F4F0] placeholder:text-[#6E7371] leading-relaxed focus:outline-none focus:border-white/40"
          />
        </label>

        {error && (
          <div className="p-3 border border-[#B86B4B] bg-[#B86B4B]/10 text-xs text-[#F4F4F0] break-all">
            {error}
          </div>
        )}

        <button
          type="submit"
          disabled={submitting || !selectedPreset}
          className="dj-btn dj-btn-primary w-full"
          data-testid="submit-render-btn"
        >
          {submitting ? '送出 RenderJob 中...' : '送出單張生圖 (RenderJob)'}
        </button>
      </form>

      {/* RenderJob 即時進度與縮圖預覽 */}
      <div className="space-y-3">
        <div className="flex items-center justify-between text-[11px] text-[#6E7371]">
          <span className="tracking-widest">RENDER JOBS</span>
          <span className="dj-tnum">{String(jobs.length).padStart(2, '0')}</span>
        </div>

        {jobs.length === 0 ? (
          <div className="dj-surface-card p-6 text-center space-y-1.5">
            <p className="text-sm text-[#9A9E9C]">尚無生圖任務紀錄</p>
            <p className="text-xs text-[#6E7371]">送出後將即時顯示進度與 WebP 縮圖預覽</p>
          </div>
        ) : (
          jobs.map((job) => (
            <div key={job.id} className="dj-surface-card p-4 space-y-3">
              <div className="flex items-center justify-between gap-2">
                <span className="dj-tnum text-[11px] text-[#6E7371] truncate">{job.id}</span>
                <span
                  className={`dj-tnum text-[10px] tracking-widest px-2 py-0.5 border ${
                    job.status === 'completed'
                      ? 'border-[#4C7C62] text-[#4C7C62]'
                      : job.status === 'failed'
                        ? 'border-[#B86B4B] text-[#B86B4B]'
                        : 'border-white/30 text-[#F4F4F0]'
                  }`}
                >
                  {job.status.toUpperCase()} {job.progress}%
                </span>
              </div>

              {job.prompt && (
                <p className="text-xs text-[#F4F4F0]/90 leading-relaxed">{job.prompt}</p>
              )}

              <div className="w-full h-[2px] bg-white/10 overflow-hidden">
                <div
                  className="h-full bg-[#F4F4F0] transition-all duration-300"
                  style={{ width: `${Math.min(100, Math.max(0, job.progress))}%` }}
                />
              </div>

              {job.thumbnailWebp && (
                <div className="dj-curtain-wrap border border-white/14">
                  <img
                    src={job.thumbnailWebp}
                    alt={job.prompt || 'Render result'}
                    className="w-full h-auto dj-curtain-media is-revealed"
                  />
                </div>
              )}

              {job.outputDrivePath && (
                <p className="dj-tnum text-[11px] text-[#9A9E9C] truncate">
                  DRIVE / {job.outputDrivePath}
                </p>
              )}

              {job.errorMessage && (
                <p className="text-xs text-[#B86B4B] break-all">{job.errorMessage}</p>
              )}
            </div>
          ))
        )}
      </div>
    </section>
  );
};
