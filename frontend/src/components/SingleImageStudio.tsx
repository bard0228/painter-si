import React, { useEffect, useMemo, useState } from 'react';
import type { User } from 'firebase/auth';
import { isFirebaseConfigured } from '../config/firebase';
import { subscribeStylePresets } from '../services/stylePresetService';
import {
  deleteRenderJob,
  fetchRenderJobsOnce,
  submitImageEditJob,
  subscribeRenderJobs,
  submitSingleImageRenderJob,
} from '../services/renderJobService';
import type { GatewayConfig, RenderJob, StylePreset } from '../types/domain';
import {
  ANIME_CHECKPOINT,
  FLUX_CHECKPOINT,
  REALISTIC_CHECKPOINT,
} from '../data/defaultStylePresets';
import { translatePromptToEnglish } from '../services/promptTranslator';
import { ArchSelect } from './ArchSelect';
import { ConfirmDialog } from './ConfirmDialog';
import { ImageEditModal } from './ImageEditModal';

interface SingleImageStudioProps {
  user: User | null;
  gatewayConfig: GatewayConfig | null;
}

const ASPECT_RATIOS = [
  { id: '1:1', portrait: '1024×1024', landscape: '1024×1024' },
  { id: '3:4', portrait: '896×1152', landscape: '1152×896' },
  { id: '2:3', portrait: '832×1216', landscape: '1216×832' },
  { id: '9:16', portrait: '768×1344', landscape: '1344×768' },
] as const;

export const SingleImageStudio: React.FC<SingleImageStudioProps> = ({
  user,
  gatewayConfig,
}) => {
  const useCloud = Boolean(user && isFirebaseConfigured);
  const [presets, setPresets] = useState<StylePreset[]>([]);
  const [selectedPresetId, setSelectedPresetId] = useState<string>('');
  const [checkpointOverride, setCheckpointOverride] = useState<string>('');
  const [prompt, setPrompt] = useState('');
  const [aspectRatio, setAspectRatio] = useState<string>('1:1');
  const [orientation, setOrientation] = useState<'portrait' | 'landscape'>('portrait');
  const [jobs, setJobs] = useState<RenderJob[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<RenderJob | null>(null);
  const [editingJob, setEditingJob] = useState<RenderJob | null>(null);
  const [statusMsg, setStatusMsg] = useState<string | null>(null);
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

    const syncOnResume = () => {
      if (document.visibilityState === 'visible') {
        void fetchRenderJobsOnce(useCloud)
          .then((items) => setJobs(items.filter((j) => j.kind === 'single_image')))
          .catch(() => {});
      }
    };

    document.addEventListener('visibilitychange', syncOnResume);
    window.addEventListener('focus', syncOnResume);
    window.addEventListener('online', syncOnResume);

    return () => {
      unsub();
      document.removeEventListener('visibilitychange', syncOnResume);
      window.removeEventListener('focus', syncOnResume);
      window.removeEventListener('online', syncOnResume);
    };
  }, [useCloud]);

  const selectedPreset = useMemo(
    () => presets.find((p) => p.id === selectedPresetId) || presets[0] || null,
    [presets, selectedPresetId]
  );

  const activeResolution = useMemo(() => {
    const found = ASPECT_RATIOS.find((r) => r.id === aspectRatio) || ASPECT_RATIOS[0];
    return orientation === 'landscape' ? found.landscape : found.portrait;
  }, [aspectRatio, orientation]);

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
    setStatusMsg(null);
    try {
      const { englishPrompt, translated } = await translatePromptToEnglish(prompt);
      if (translated) {
        setStatusMsg(`已自動翻譯為英文提示詞：${englishPrompt}`);
      }
      const effectivePreset: StylePreset = checkpointOverride
        ? { ...selectedPreset, checkpointName: checkpointOverride }
        : selectedPreset;
      const created = await submitSingleImageRenderJob({
        useCloud,
        gatewayUrl: gatewayConfig?.url,
        user,
        prompt: englishPrompt,
        stylePreset: effectivePreset,
        aspectRatio,
        orientation,
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

  const handleEditSubmit = async (payload: {
    sourceJob: RenderJob;
    prompt: string;
    stylePreset: StylePreset;
    denoise: number;
    maskBase64: string | null;
  }) => {
    if (useCloud && !gatewayConfig?.url) {
      throw new Error('Colab BackendGateway 尚未連線，無法送出改圖任務');
    }
    const created = await submitImageEditJob({
      useCloud,
      gatewayUrl: gatewayConfig?.url,
      user,
      sourceJob: payload.sourceJob,
      prompt: payload.prompt,
      stylePreset: payload.stylePreset,
      denoise: payload.denoise,
      maskBase64: payload.maskBase64,
    });
    if (!useCloud) {
      setJobs((prev) => [created, ...prev]);
    }
    setStatusMsg(
      payload.maskBase64
        ? `已送出局部塗抹重繪任務 (${created.id})`
        : `已送出全圖微調任務 (${created.id})`
    );
  };

  const confirmDeleteJob = async () => {
    if (!pendingDelete) return;
    const target = pendingDelete;
    setPendingDelete(null);
    setError(null);
    try {
      await deleteRenderJob(useCloud, target.id);
      if (!useCloud) {
        setJobs((prev) => prev.filter((j) => j.id !== target.id));
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  return (
    <section className="dj-tab-enter space-y-5">
      <ConfirmDialog
        open={Boolean(pendingDelete)}
        title="刪除算圖紀錄"
        message={`確定要刪除這筆紀錄「${pendingDelete?.prompt || pendingDelete?.id || ''}」嗎？`}
        onConfirm={confirmDeleteJob}
        onCancel={() => setPendingDelete(null)}
      />

      <ImageEditModal
        open={Boolean(editingJob)}
        sourceJob={editingJob}
        presets={presets}
        defaultPresetId={selectedPreset?.id || ''}
        onClose={() => setEditingJob(null)}
        onSubmitEdit={handleEditSubmit}
      />

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

        <div className="space-y-1.5">
          <span className="text-xs text-[#9A9E9C] block">主力底模 (Checkpoint)</span>
          <ArchSelect
            value={checkpointOverride}
            onChange={setCheckpointOverride}
            options={[
              {
                value: '',
                label: `跟隨風格預設（${
                  selectedPreset?.checkpointName === FLUX_CHECKPOINT
                    ? 'FLUX.1-dev FP8'
                    : selectedPreset?.checkpointName === REALISTIC_CHECKPOINT
                      ? 'RealVisXL V5.0'
                      : 'Animagine XL 3.1'
                }）`,
              },
              { value: FLUX_CHECKPOINT, label: 'FLUX.1-dev FP8（寫實人像 / 風景天花板）' },
              { value: REALISTIC_CHECKPOINT, label: 'RealVisXL V5.0（SDXL 最強寫實 / 相容 LoRA）' },
              { value: ANIME_CHECKPOINT, label: 'Animagine XL 3.1（動漫 / 光影 / 插畫天花板）' },
            ]}
          />
        </div>

        <label className="block space-y-1.5">
          <div className="flex items-center justify-between">
            <span className="text-xs text-[#9A9E9C]">畫面描述 (Prompt)</span>
            <span className="text-[10px] text-[#4C7C62]">支援中文自動轉英文</span>
          </div>
          <textarea
            rows={3}
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            placeholder="直接輸入中文即可，例如：一隻可愛的橘貓在蓬鬆白雲上睡覺"
            className="w-full p-3 bg-[#0E0F12] border border-white/14 text-sm text-[#F4F4F0] placeholder:text-[#6E7371] leading-relaxed focus:outline-none focus:border-white/40"
          />
        </label>

        {/* 照片比例與直橫方向選擇 */}
        <div className="space-y-2 pt-0.5">
          <div className="flex items-center justify-between">
            <span className="text-xs text-[#9A9E9C]">照片尺寸比例與方向</span>
            <span className="dj-tnum text-[11px] text-[#6E7371]">{activeResolution}</span>
          </div>

          <div className="grid grid-cols-4 gap-1.5">
            {ASPECT_RATIOS.map((r) => {
              const active = aspectRatio === r.id;
              return (
                <button
                  key={r.id}
                  type="button"
                  onClick={() => setAspectRatio(r.id)}
                  className={`dj-tnum min-h-[48px] border text-xs font-medium transition-all active:scale-[0.96] ${
                    active
                      ? 'bg-[#F4F4F0] text-[#0E0F12] border-[#F4F4F0]'
                      : 'bg-[#0E0F12] text-[#9A9E9C] border-white/14 hover:border-white/30'
                  }`}
                >
                  {r.id}
                </button>
              );
            })}
          </div>

          <div className="grid grid-cols-2 gap-2">
            {[
              { id: 'portrait' as const, label: '直式 (Portrait)' },
              { id: 'landscape' as const, label: '橫式 (Landscape)' },
            ].map((o) => {
              const active = orientation === o.id;
              const disabled = aspectRatio === '1:1';
              return (
                <button
                  key={o.id}
                  type="button"
                  disabled={disabled}
                  onClick={() => setOrientation(o.id)}
                  className={`min-h-[48px] border text-xs font-medium tracking-wider transition-all active:scale-[0.96] disabled:opacity-40 ${
                    active && !disabled
                      ? 'bg-white/15 text-[#F4F4F0] border-white/45'
                      : 'bg-[#0E0F12] text-[#9A9E9C] border-white/14'
                  }`}
                >
                  {o.label}
                </button>
              );
            })}
          </div>
        </div>

        {statusMsg && (
          <div className="dj-panel-reveal p-3 border border-[#4C7C62] bg-[#4C7C62]/10 text-xs text-[#4C7C62] break-words">
            {statusMsg}
          </div>
        )}

        {error && (
          <div className="dj-panel-reveal p-3 border border-[#B86B4B] bg-[#B86B4B]/10 text-xs text-[#F4F4F0] break-all">
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
                <div className="min-w-0">
                  <span className="dj-tnum text-[11px] text-[#6E7371] block truncate">
                    {job.id}
                  </span>
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-1 mt-1">
                    {job.aspectRatio && (
                      <span className="dj-tnum text-[10px] text-[#9A9E9C]">
                        {job.aspectRatio} / {job.orientation === 'landscape' ? '橫式' : '直式'}
                      </span>
                    )}
                    {(job.stylePresetName ||
                      presets.find((p) => p.id === job.stylePresetId)?.name) && (
                      <span className="text-[10px] px-1.5 py-0.5 border border-white/14 text-[#F4F4F0]/80">
                        風格：{job.stylePresetName || presets.find((p) => p.id === job.stylePresetId)?.name}
                      </span>
                    )}
                    {(() => {
                      const rawCkpt =
                        job.checkpointName ||
                        presets.find((p) => p.id === job.stylePresetId)?.checkpointName ||
                        '';
                      if (!rawCkpt) return null;
                      const label =
                        rawCkpt === FLUX_CHECKPOINT
                          ? 'FLUX.1-dev FP8'
                          : rawCkpt === REALISTIC_CHECKPOINT
                            ? 'RealVisXL V5.0'
                            : rawCkpt === ANIME_CHECKPOINT
                              ? 'Animagine XL 3.1'
                              : rawCkpt.replace(/\.safetensors$/i, '');
                      return (
                        <span className="dj-tnum text-[10px] px-1.5 py-0.5 border border-[#4C7C62]/50 text-[#4C7C62]">
                          底模：{label}
                        </span>
                      );
                    })()}
                  </div>
                </div>
                <div className="flex items-center gap-2 shrink-0">
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
                  <button
                    type="button"
                    onClick={() => setPendingDelete(job)}
                    className="min-h-[48px] px-2.5 border border-[#B86B4B]/40 text-[11px] tracking-widest text-[#B86B4B] hover:border-[#B86B4B] active:scale-[0.96] transition-all"
                  >
                    刪除
                  </button>
                </div>
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

              {job.status === 'completed' && job.outputDrivePath && (
                <div className="flex items-center justify-between gap-2 pt-1">
                  <span className="dj-tnum text-[11px] text-[#9A9E9C] truncate">
                    DRIVE / {job.outputDrivePath}
                  </span>
                  <button
                    type="button"
                    onClick={() => setEditingJob(job)}
                    className="min-h-[48px] px-3 border border-white/25 text-xs tracking-widest text-[#F4F4F0] hover:border-white/50 active:scale-[0.96] transition-all shrink-0"
                    data-testid={`edit-job-${job.id}`}
                  >
                    微調 / 重繪
                  </button>
                </div>
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
