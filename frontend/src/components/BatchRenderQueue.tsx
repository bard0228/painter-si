import React, { useEffect, useMemo, useState } from 'react';
import type { User } from 'firebase/auth';
import { isFirebaseConfigured } from '../config/firebase';
import { subscribeStoryboards } from '../services/storyboardService';
import { subscribeStylePresets } from '../services/stylePresetService';
import {
  buildMediaUrl,
  subscribeRenderJobs,
  submitStoryboardBatchJob,
} from '../services/renderJobService';
import type { GatewayConfig, RenderJob, Shot, Storyboard, StylePreset } from '../types/domain';
import { ArchSelect } from './ArchSelect';
import { ConfirmDialog } from './ConfirmDialog';
import { ReferenceImagesPicker, type ReferenceMode } from './ReferenceImagesPicker';

interface BatchRenderQueueProps {
  user: User | null;
  gatewayConfig: GatewayConfig | null;
}

export const BatchRenderQueue: React.FC<BatchRenderQueueProps> = ({
  user,
  gatewayConfig,
}) => {
  const useCloud = Boolean(user && isFirebaseConfigured);
  const [storyboards, setStoryboards] = useState<Storyboard[]>([]);
  const [presets, setPresets] = useState<StylePreset[]>([]);
  const [jobs, setJobs] = useState<RenderJob[]>([]);
  const [selectedBoardId, setSelectedBoardId] = useState<string>('');
  const [idToken, setIdToken] = useState<string>('');
  const [refImages, setRefImages] = useState<string[]>([]);
  const [refMode, setRefMode] = useState<ReferenceMode>('face');
  const [refWeight, setRefWeight] = useState<number>(0.75);
  const [submitting, setSubmitting] = useState(false);
  const [rerollTarget, setRerollTarget] = useState<Shot | null>(null);
  const [statusMsg, setStatusMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!user) {
      setIdToken('');
      return;
    }
    user.getIdToken().then(setIdToken).catch(() => {});
  }, [user]);

  useEffect(() => {
    const unsub = subscribeStoryboards(
      useCloud,
      (items) => {
        setStoryboards(items);
        if (items.length > 0 && !items.some((b) => b.id === selectedBoardId)) {
          setSelectedBoardId(items[0].id);
        }
      },
      (err) => setError(`讀取劇本失敗：${err.message}`)
    );
    return () => unsub();
  }, [useCloud, selectedBoardId]);

  useEffect(() => {
    const unsub = subscribeStylePresets(
      useCloud,
      setPresets,
      (err) => setError(`讀取風格失敗：${err.message}`)
    );
    return () => unsub();
  }, [useCloud]);

  useEffect(() => {
    const unsub = subscribeRenderJobs(
      useCloud,
      (items) => setJobs(items.filter((j) => j.kind === 'storyboard_batch')),
      (err) => setError(`讀取批次任務失敗：${err.message}`)
    );
    return () => unsub();
  }, [useCloud]);

  const activeBoard = useMemo(
    () => storyboards.find((b) => b.id === selectedBoardId) || storyboards[0] || null,
    [storyboards, selectedBoardId]
  );

  const latestJob = useMemo(() => {
    if (!activeBoard) return null;
    return jobs.find((j) => j.storyboardId === activeBoard.id) || null;
  }, [jobs, activeBoard]);

  const startBatch = async (rerollShotId?: string) => {
    if (!activeBoard) {
      setError('請先於 [ 04 ] 建立或儲存 Storyboard');
      return;
    }
    if (useCloud && !gatewayConfig?.url) {
      setError('Colab BackendGateway 尚未連線，無法送出批次任務');
      return;
    }

    setSubmitting(true);
    setError(null);
    setStatusMsg(null);
    try {
      const created = await submitStoryboardBatchJob({
        useCloud,
        gatewayUrl: gatewayConfig?.url,
        user,
        storyboard: activeBoard,
        presets,
        rerollShotId,
        referenceImages: refImages,
        referenceMode: refMode,
        referenceWeight: refWeight,
      });
      if (!useCloud) {
        setJobs((prev) => [created, ...prev]);
      }
      setStatusMsg(
        rerollShotId
          ? `已送出單鏡重算任務 (${created.id})`
          : `已啟動逐鏡批次任務 (${created.id})`
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <section className="dj-tab-enter space-y-5">
      <ConfirmDialog
        open={Boolean(rerollTarget)}
        title="單鏡獨立重算 (Re-roll)"
        message={`確定要重新生成 SHOT ${String(rerollTarget?.order || 0).padStart(2, '0')} 的關鍵幀圖片與動態影片嗎？`}
        confirmLabel="確認重算"
        onConfirm={() => {
          const target = rerollTarget;
          setRerollTarget(null);
          if (target) startBatch(target.id);
        }}
        onCancel={() => setRerollTarget(null)}
      />

      <div className="flex items-center justify-between border-b border-white/14 pb-3">
        <div className="flex items-center gap-2.5">
          <span className="dj-tnum text-xs tracking-widest text-[#6E7371]">[ 05 ]</span>
          <h2 className="dj-serif text-base font-semibold tracking-wider text-[#F4F4F0]">
            批次逐鏡生圖與 I2V
          </h2>
        </div>
        <span className="dj-tnum text-[11px] tracking-widest px-2.5 py-1 border border-white/14 text-[#9A9E9C]">
          SHOT-BY-SHOT
        </span>
      </div>

      <div className="dj-surface-card p-4 space-y-3.5">
        <div className="space-y-1.5">
          <span className="text-xs text-[#9A9E9C] block">選擇分鏡劇本 (Storyboard)</span>
          <ArchSelect
            value={activeBoard?.id || ''}
            onChange={setSelectedBoardId}
            placeholder="尚無分鏡劇本"
            options={storyboards.map((b) => ({
              value: b.id,
              label: `${b.title} (${b.shots.length} 鏡)`,
            }))}
          />
        </div>

        <ReferenceImagesPicker
          images={refImages}
          mode={refMode}
          weight={refWeight}
          onChangeImages={setRefImages}
          onChangeMode={setRefMode}
          onChangeWeight={setRefWeight}
          label="全片角色／主體鎖定（選填，最多 4 張）"
        />

        <button
          type="button"
          disabled={submitting || !activeBoard}
          onClick={() => startBatch()}
          className="dj-btn dj-btn-primary w-full"
          data-testid="start-batch-btn"
        >
          {submitting ? '派發佇列中...' : '一鍵啟動批次生圖與 I2V（支援斷點續傳）'}
        </button>

        {latestJob && (
          <div className="pt-2 space-y-2 border-t border-white/10">
            <div className="flex items-center justify-between text-[11px]">
              <span className="dj-tnum text-[#9A9E9C]">{latestJob.id}</span>
              <span className="dj-tnum text-[#F4F4F0]">
                {latestJob.status.toUpperCase()} {latestJob.progress}%
              </span>
            </div>
            <div className="w-full h-[2px] bg-white/10 overflow-hidden">
              <div
                className="h-full bg-[#F4F4F0] transition-all duration-300"
                style={{ width: `${Math.min(100, Math.max(0, latestJob.progress))}%` }}
              />
            </div>
          </div>
        )}
      </div>

      {error && (
        <div className="dj-panel-reveal p-3 border border-[#B86B4B] bg-[#B86B4B]/10 text-xs text-[#F4F4F0] break-all">
          {error}
        </div>
      )}

      {statusMsg && (
        <div className="dj-panel-reveal p-3 border border-[#4C7C62] bg-[#4C7C62]/10 text-xs text-[#4C7C62]">
          {statusMsg}
        </div>
      )}

      {/* 逐鏡進度與 Range Request 串流播放清單 */}
      {activeBoard ? (
        <div className="space-y-3">
          {activeBoard.shots.map((shot, idx) => {
            const videoStreamUrl =
              shot.videoPath && gatewayConfig?.url && idToken
                ? buildMediaUrl(gatewayConfig.url, shot.videoPath, idToken)
                : '';

            return (
              <div key={shot.id} className="dj-surface-card p-4 space-y-3">
                <div className="flex items-center justify-between border-b border-white/10 pb-2">
                  <span className="dj-tnum text-xs tracking-widest text-[#F4F4F0]">
                    SHOT {String(idx + 1).padStart(2, '0')} |{' '}
                    {String(activeBoard.shots.length).padStart(2, '0')}
                  </span>
                  <span
                    className={`dj-tnum text-[10px] tracking-widest px-2 py-0.5 border ${
                      shot.status === 'completed'
                        ? 'border-[#4C7C62] text-[#4C7C62]'
                        : shot.status === 'failed'
                          ? 'border-[#B86B4B] text-[#B86B4B]'
                          : 'border-white/25 text-[#9A9E9C]'
                    }`}
                  >
                    {shot.status.toUpperCase()}
                  </span>
                </div>

                <p className="text-xs text-[#9A9E9C] leading-relaxed">
                  {shot.visualDescription || '（尚未填寫畫面描述）'}
                </p>

                {shot.subtitleText && (
                  <p className="text-xs text-[#F4F4F0] border-l-2 border-white/25 pl-2.5">
                    {shot.subtitleText}
                  </p>
                )}

                {shot.keyframeThumbnailBase64 && (
                  <div className="dj-curtain-wrap border border-white/14">
                    <img
                      src={shot.keyframeThumbnailBase64}
                      alt={`Shot ${idx + 1} keyframe`}
                      className="w-full h-auto dj-curtain-media is-revealed"
                    />
                  </div>
                )}

                {videoStreamUrl && (
                  <video
                    controls
                    playsInline
                    preload="metadata"
                    src={videoStreamUrl}
                    className="w-full border border-white/14 bg-black"
                  />
                )}

                <div className="flex items-center justify-between pt-1">
                  <span className="dj-tnum text-[11px] text-[#6E7371] truncate max-w-[180px]">
                    {shot.videoPath || shot.keyframeImagePath || '待算圖'}
                  </span>
                  <button
                    type="button"
                    disabled={submitting}
                    onClick={() => setRerollTarget(shot)}
                    className="min-h-[48px] px-3 border border-white/20 text-xs tracking-widest text-[#F4F4F0] hover:border-white/45 active:scale-[0.96] transition-all"
                    data-testid={`reroll-shot-${shot.id}`}
                  >
                    重算此鏡 (Re-roll)
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <div className="dj-surface-card p-6 text-center space-y-1.5">
          <p className="text-sm text-[#9A9E9C]">尚無可執行的分鏡劇本</p>
          <p className="text-xs text-[#6E7371]">請先至 [ 04 分鏡 ] 建立劇本</p>
        </div>
      )}
    </section>
  );
};
