import React, { useEffect, useMemo, useState } from 'react';
import type { User } from 'firebase/auth';
import { isFirebaseConfigured } from '../config/firebase';
import { saveStoryboard, subscribeStoryboards } from '../services/storyboardService';
import {
  buildMediaUrl,
  fetchBgmFiles,
  subscribeRenderJobs,
  submitFfmpegExportJob,
} from '../services/renderJobService';
import type { GatewayConfig, RenderJob, Shot, Storyboard } from '../types/domain';
import { ArchSelect } from './ArchSelect';

interface StoryboardEditorProps {
  user: User | null;
  gatewayConfig: GatewayConfig | null;
}

export const StoryboardEditor: React.FC<StoryboardEditorProps> = ({
  user,
  gatewayConfig,
}) => {
  const useCloud = Boolean(user && isFirebaseConfigured);
  const [storyboards, setStoryboards] = useState<Storyboard[]>([]);
  const [selectedBoardId, setSelectedBoardId] = useState<string>('');
  const [editableBoard, setEditableBoard] = useState<Storyboard | null>(null);
  const [bgmFiles, setBgmFiles] = useState<string[]>([]);
  const [selectedBgm, setSelectedBgm] = useState<string>('');
  const [burnSubtitles, setBurnSubtitles] = useState<boolean>(true);
  const [jobs, setJobs] = useState<RenderJob[]>([]);
  const [idToken, setIdToken] = useState<string>('');
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [exporting, setExporting] = useState(false);
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
    const found = storyboards.find((b) => b.id === selectedBoardId) || storyboards[0] || null;
    setEditableBoard(found ? { ...found, shots: [...found.shots] } : null);
    setSelectedBgm(found?.bgmPath || '');
  }, [storyboards, selectedBoardId]);

  useEffect(() => {
    const unsub = subscribeRenderJobs(
      useCloud,
      (items) => setJobs(items.filter((j) => j.kind === 'ffmpeg_export')),
      (err) => setError(`讀取合成任務失敗：${err.message}`)
    );
    return () => unsub();
  }, [useCloud]);

  const loadBgmList = async () => {
    if (!user || !gatewayConfig?.url) return;
    setError(null);
    try {
      const files = await fetchBgmFiles(gatewayConfig.url, user);
      setBgmFiles(files);
      setStatusMsg(`已從 Drive /bgm 同步 ${files.length} 首音樂`);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  useEffect(() => {
    if (user && gatewayConfig?.url) {
      loadBgmList();
    }
  }, [user, gatewayConfig?.url]);

  const latestExportJob = useMemo(() => {
    if (!editableBoard) return null;
    return jobs.find((j) => j.storyboardId === editableBoard.id) || null;
  }, [jobs, editableBoard]);

  const moveShot = (fromIdx: number, toIdx: number) => {
    if (!editableBoard) return;
    if (toIdx < 0 || toIdx >= editableBoard.shots.length || fromIdx === toIdx) return;
    const next = [...editableBoard.shots];
    const [moved] = next.splice(fromIdx, 1);
    next.splice(toIdx, 0, moved);
    setEditableBoard({
      ...editableBoard,
      shots: next.map((s, idx) => ({ ...s, order: idx + 1 })),
    });
  };

  const updateShot = (shotId: string, patch: Partial<Shot>) => {
    if (!editableBoard) return;
    setEditableBoard({
      ...editableBoard,
      shots: editableBoard.shots.map((s) => (s.id === shotId ? { ...s, ...patch } : s)),
    });
  };

  const handleSaveOrderAndEdits = async () => {
    if (!editableBoard) return;
    setError(null);
    setStatusMsg(null);
    try {
      await saveStoryboard(useCloud, {
        ...editableBoard,
        bgmPath: selectedBgm || undefined,
      });
      setStatusMsg('已儲存分鏡順序、秒數與字幕設定');
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const handleExportMp4 = async () => {
    if (!editableBoard) return;
    if (useCloud && !gatewayConfig?.url) {
      setError('Colab BackendGateway 尚未連線，無法呼叫 FFmpeg 合成');
      return;
    }
    setExporting(true);
    setError(null);
    setStatusMsg(null);
    try {
      const updated = await saveStoryboard(useCloud, {
        ...editableBoard,
        bgmPath: selectedBgm || undefined,
      });
      const job = await submitFfmpegExportJob({
        useCloud,
        gatewayUrl: gatewayConfig?.url,
        user,
        storyboard: updated,
        bgmFilename: selectedBgm || undefined,
        burnSubtitles,
      });
      if (!useCloud) {
        setJobs((prev) => [job, ...prev]);
      }
      setStatusMsg(`已送出 FFmpeg 合成任務 (${job.id})`);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setExporting(false);
    }
  };

  const exportStreamUrl =
    latestExportJob?.outputDrivePath && gatewayConfig?.url && idToken
      ? buildMediaUrl(gatewayConfig.url, latestExportJob.outputDrivePath, idToken)
      : '';

  return (
    <section className="dj-tab-enter space-y-5">
      <div className="flex items-center justify-between border-b border-white/14 pb-3">
        <div className="flex items-center gap-2.5">
          <span className="dj-tnum text-xs tracking-widest text-[#6E7371]">[ 06 ]</span>
          <h2 className="dj-serif text-base font-semibold tracking-wider text-[#F4F4F0]">
            分鏡卡片剪輯與合成
          </h2>
        </div>
        <span className="dj-tnum text-[11px] tracking-widest px-2.5 py-1 border border-white/14 text-[#9A9E9C]">
          FFMPEG
        </span>
      </div>

      <div className="dj-surface-card p-4 space-y-3.5">
        <div className="space-y-1.5">
          <span className="text-xs text-[#9A9E9C] block">選擇剪輯劇本</span>
          <ArchSelect
            value={editableBoard?.id || ''}
            onChange={setSelectedBoardId}
            placeholder="尚無分鏡劇本"
            options={storyboards.map((b) => ({
              value: b.id,
              label: `${b.title} (${b.shots.length} 鏡)`,
            }))}
          />
        </div>

        <div className="space-y-1.5">
          <div className="flex items-center justify-between">
            <span className="text-xs text-[#9A9E9C]">背景音樂 (Drive /bgm)</span>
            <button
              type="button"
              onClick={loadBgmList}
              className="min-h-[48px] px-2 text-[11px] tracking-widest text-[#9A9E9C] hover:text-[#F4F4F0]"
            >
              重新整理 BGM
            </button>
          </div>
          <ArchSelect
            value={selectedBgm}
            onChange={setSelectedBgm}
            options={[
              { value: '', label: '不使用背景音樂' },
              ...bgmFiles.map((f) => ({ value: f, label: f })),
            ]}
          />
        </div>

        <button
          type="button"
          onClick={() => setBurnSubtitles((v) => !v)}
          className={`w-full min-h-[48px] px-3 border text-xs font-medium tracking-widest flex items-center justify-between transition-all active:scale-[0.98] ${
            burnSubtitles
              ? 'border-[#4C7C62] bg-[#4C7C62]/15 text-[#F4F4F0]'
              : 'border-white/14 bg-[#0E0F12] text-[#9A9E9C]'
          }`}
        >
          <span>硬字幕燒錄 (Hard Subtitles)</span>
          <span className="dj-tnum">{burnSubtitles ? 'ON' : 'OFF'}</span>
        </button>
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

      {/* 分鏡卡片式拖曳排序 + 秒數裁切 + 字幕微調 */}
      {editableBoard ? (
        <div className="space-y-3">
          {editableBoard.shots.map((shot, idx) => (
            <div
              key={shot.id}
              draggable
              onDragStart={() => setDragIndex(idx)}
              onDragOver={(e) => e.preventDefault()}
              onDrop={() => {
                if (dragIndex !== null) {
                  moveShot(dragIndex, idx);
                  setDragIndex(null);
                }
              }}
              className="dj-surface-card p-4 space-y-3 cursor-grab active:cursor-grabbing"
            >
              <div className="flex items-center justify-between border-b border-white/10 pb-2">
                <span className="dj-tnum text-xs tracking-widest text-[#F4F4F0]">
                  CLIP {String(idx + 1).padStart(2, '0')} |{' '}
                  {String(editableBoard.shots.length).padStart(2, '0')}
                </span>
                <div className="flex items-center gap-1.5">
                  <button
                    type="button"
                    disabled={idx === 0}
                    onClick={() => moveShot(idx, idx - 1)}
                    className="min-h-[48px] min-w-[48px] border border-white/14 text-xs text-[#F4F4F0] disabled:opacity-30 active:scale-[0.96]"
                  >
                    ↑
                  </button>
                  <button
                    type="button"
                    disabled={idx === editableBoard.shots.length - 1}
                    onClick={() => moveShot(idx, idx + 1)}
                    className="min-h-[48px] min-w-[48px] border border-white/14 text-xs text-[#F4F4F0] disabled:opacity-30 active:scale-[0.96]"
                  >
                    ↓
                  </button>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-2.5">
                <label className="block space-y-1">
                  <span className="text-[11px] text-[#9A9E9C]">起始秒數 (Start s)</span>
                  <input
                    type="number"
                    step="0.1"
                    min={0}
                    value={shot.trimStartSec}
                    onChange={(e) =>
                      updateShot(shot.id, { trimStartSec: Number(e.target.value) })
                    }
                    className="dj-tnum w-full min-h-[48px] px-3 bg-[#0E0F12] border border-white/14 text-xs text-[#F4F4F0]"
                  />
                </label>

                <label className="block space-y-1">
                  <span className="text-[11px] text-[#9A9E9C]">結束秒數 (End s)</span>
                  <input
                    type="number"
                    step="0.1"
                    min={0.5}
                    value={shot.trimEndSec}
                    onChange={(e) =>
                      updateShot(shot.id, { trimEndSec: Number(e.target.value) })
                    }
                    className="dj-tnum w-full min-h-[48px] px-3 bg-[#0E0F12] border border-white/14 text-xs text-[#F4F4F0]"
                  />
                </label>
              </div>

              <label className="block space-y-1">
                <span className="text-[11px] text-[#9A9E9C]">字幕微調</span>
                <input
                  type="text"
                  value={shot.subtitleText}
                  onChange={(e) => updateShot(shot.id, { subtitleText: e.target.value })}
                  className="w-full min-h-[48px] px-3 bg-[#0E0F12] border border-white/14 text-xs text-[#F4F4F0]"
                />
              </label>
            </div>
          ))}

          <div className="grid grid-cols-2 gap-2.5 pt-1">
            <button
              type="button"
              onClick={handleSaveOrderAndEdits}
              className="dj-btn text-xs text-[#9A9E9C]"
            >
              儲存剪輯設定
            </button>
            <button
              type="button"
              disabled={exporting}
              onClick={handleExportMp4}
              className="dj-btn dj-btn-primary text-xs"
              data-testid="export-mp4-btn"
            >
              {exporting ? '合成中...' : '一鍵合成最終 MP4'}
            </button>
          </div>
        </div>
      ) : (
        <div className="dj-surface-card p-6 text-center space-y-1.5">
          <p className="text-sm text-[#9A9E9C]">尚無可剪輯的分鏡劇本</p>
          <p className="text-xs text-[#6E7371]">請先至 [ 04 分鏡 ] 建立劇本</p>
        </div>
      )}

      {/* 最終合成 MP4 預覽與下載 */}
      {latestExportJob && (
        <div className="dj-surface-card p-4 space-y-3">
          <div className="flex items-center justify-between text-[11px]">
            <span className="dj-tnum text-[#9A9E9C]">{latestExportJob.id}</span>
            <span className="dj-tnum text-[#F4F4F0]">
              {latestExportJob.status.toUpperCase()} {latestExportJob.progress}%
            </span>
          </div>
          <div className="w-full h-[2px] bg-white/10 overflow-hidden">
            <div
              className="h-full bg-[#F4F4F0] transition-all duration-300"
              style={{ width: `${Math.min(100, Math.max(0, latestExportJob.progress))}%` }}
            />
          </div>

          {exportStreamUrl && (
            <div className="space-y-3 pt-1">
              <video
                controls
                playsInline
                preload="metadata"
                src={exportStreamUrl}
                className="w-full border border-white/14 bg-black"
              />
              <a
                href={exportStreamUrl}
                download={`${editableBoard?.title || 'huishi_export'}.mp4`}
                className="dj-btn dj-btn-primary w-full text-xs"
              >
                下載最終成片 MP4
              </a>
            </div>
          )}
        </div>
      )}
    </section>
  );
};
