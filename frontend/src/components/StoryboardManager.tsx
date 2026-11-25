import React, { useEffect, useMemo, useState } from 'react';
import type { User } from 'firebase/auth';
import { isFirebaseConfigured } from '../config/firebase';
import { nowTaipeiIso } from '../data/defaultStylePresets';
import {
  generateStoryboardWithGemini,
  getSavedGeminiApiKey,
  saveGeminiApiKey,
} from '../services/geminiStoryboardService';
import {
  deleteStoryboard,
  saveStoryboard,
  subscribeStoryboards,
} from '../services/storyboardService';
import { subscribeStylePresets } from '../services/stylePresetService';
import type { Shot, Storyboard, StylePreset } from '../types/domain';
import { ArchSelect } from './ArchSelect';
import { ConfirmDialog } from './ConfirmDialog';

interface StoryboardManagerProps {
  user: User | null;
}

export const StoryboardManager: React.FC<StoryboardManagerProps> = ({ user }) => {
  const useCloud = Boolean(user && isFirebaseConfigured);
  const [presets, setPresets] = useState<StylePreset[]>([]);
  const [storyboards, setStoryboards] = useState<Storyboard[]>([]);
  const [activeBoard, setActiveBoard] = useState<Storyboard | null>(null);

  const [geminiKey, setGeminiKey] = useState(() => getSavedGeminiApiKey());
  const [showKeyInput, setShowKeyInput] = useState(false);
  const [synopsis, setSynopsis] = useState('');
  const [shotCount, setShotCount] = useState(4);
  const [globalStyleId, setGlobalStyleId] = useState('');

  const [generating, setGenerating] = useState(false);
  const [saving, setSaving] = useState(false);
  const [statusMsg, setStatusMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [confirmAction, setConfirmAction] = useState<
    | { type: 'board'; id: string; title: string }
    | { type: 'shot'; id: string; order: number }
    | null
  >(null);

  useEffect(() => {
    const unsub = subscribeStylePresets(
      useCloud,
      (items) => {
        setPresets(items);
        if (!globalStyleId) {
          const firstImg = items.find((p) => p.type === 'image');
          if (firstImg) setGlobalStyleId(firstImg.id);
        }
      },
      (err) => setError(`讀取風格失敗：${err.message}`)
    );
    return () => unsub();
  }, [useCloud, globalStyleId]);

  useEffect(() => {
    const unsub = subscribeStoryboards(
      useCloud,
      (items) => {
        setStoryboards(items);
        if (!activeBoard && items.length > 0) {
          setActiveBoard(items[0]);
        }
      },
      (err) => setError(`讀取分鏡劇本失敗：${err.message}`)
    );
    return () => unsub();
  }, [useCloud]);

  const imagePresets = useMemo(() => presets.filter((p) => p.type === 'image'), [presets]);
  const videoPresets = useMemo(() => presets.filter((p) => p.type === 'video'), [presets]);

  const handleSaveKey = () => {
    saveGeminiApiKey(geminiKey);
    setShowKeyInput(false);
    setStatusMsg('已儲存 Gemini API Key 至本機');
  };

  const handleGenerateAi = async () => {
    setGenerating(true);
    setError(null);
    setStatusMsg(null);
    try {
      const board = await generateStoryboardWithGemini({
        apiKey: geminiKey,
        synopsis,
        shotCount,
        globalStylePresetId: globalStyleId || undefined,
      });
      const saved = await saveStoryboard(useCloud, board);
      if (!useCloud) {
        setStoryboards((prev) => [saved, ...prev]);
      }
      setActiveBoard(saved);
      setSynopsis('');
      setStatusMsg(`已生成並儲存 ${saved.shots.length} 鏡劇本`);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setGenerating(false);
    }
  };

  const handleCreateBlank = () => {
    const ts = nowTaipeiIso();
    const blank: Storyboard = {
      id: `sb-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
      title: '新分鏡劇本',
      synopsis: synopsis.trim() || '空白分鏡專案',
      globalStylePresetId: globalStyleId || undefined,
      shots: [
        {
          id: `shot-1-${Math.random().toString(36).slice(2, 6)}`,
          order: 1,
          visualDescription: '',
          subtitleText: '',
          imageStylePresetId: globalStyleId || undefined,
          trimStartSec: 0,
          trimEndSec: 4,
          status: 'pending',
        },
      ],
      createdAt: ts,
      updatedAt: ts,
    };
    setActiveBoard(blank);
    setError(null);
    setStatusMsg('已建立空白劇本，請於下方編輯分鏡');
  };

  const updateShot = (shotId: string, patch: Partial<Shot>) => {
    if (!activeBoard) return;
    setActiveBoard({
      ...activeBoard,
      shots: activeBoard.shots.map((s) => (s.id === shotId ? { ...s, ...patch } : s)),
    });
  };

  const addShot = () => {
    if (!activeBoard) return;
    const nextOrder = activeBoard.shots.length + 1;
    const newShot: Shot = {
      id: `shot-${nextOrder}-${Math.random().toString(36).slice(2, 6)}`,
      order: nextOrder,
      visualDescription: '',
      subtitleText: '',
      imageStylePresetId: activeBoard.globalStylePresetId,
      trimStartSec: 0,
      trimEndSec: 4,
      status: 'pending',
    };
    setActiveBoard({
      ...activeBoard,
      shots: [...activeBoard.shots, newShot],
    });
  };

  const handleSaveBoard = async () => {
    if (!activeBoard) return;
    setSaving(true);
    setError(null);
    setStatusMsg(null);
    try {
      const saved = await saveStoryboard(useCloud, activeBoard);
      if (!useCloud) {
        setStoryboards((prev) => {
          const idx = prev.findIndex((b) => b.id === saved.id);
          if (idx >= 0) {
            const copy = [...prev];
            copy[idx] = saved;
            return copy;
          }
          return [saved, ...prev];
        });
      }
      setActiveBoard(saved);
      setStatusMsg('已儲存 Storyboard 至資料庫');
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  };

  const executeConfirmDelete = async () => {
    if (!confirmAction) return;
    const action = confirmAction;
    setConfirmAction(null);
    setError(null);

    if (action.type === 'shot') {
      if (!activeBoard) return;
      const filtered = activeBoard.shots
        .filter((s) => s.id !== action.id)
        .map((s, idx) => ({ ...s, order: idx + 1 }));
      setActiveBoard({
        ...activeBoard,
        shots: filtered,
      });
      setStatusMsg(`已移除 SHOT ${String(action.order).padStart(2, '0')}`);
      return;
    }

    try {
      await deleteStoryboard(useCloud, action.id);
      const remaining = storyboards.filter((b) => b.id !== action.id);
      if (!useCloud) {
        setStoryboards(remaining);
      }
      if (activeBoard?.id === action.id) {
        setActiveBoard(remaining[0] || null);
      }
      setStatusMsg(`已刪除劇本「${action.title}」`);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  return (
    <section className="dj-tab-enter space-y-5">
      <ConfirmDialog
        open={Boolean(confirmAction)}
        title={confirmAction?.type === 'board' ? '刪除分鏡劇本' : '移除分鏡'}
        message={
          confirmAction?.type === 'board'
            ? `確定要刪除整份劇本「${confirmAction.title}」嗎？此操作無法復原。`
            : `確定要移除 SHOT ${String(confirmAction?.order || 0).padStart(2, '0')} 嗎？`
        }
        confirmLabel={confirmAction?.type === 'board' ? '確認刪除' : '確認移除'}
        onConfirm={executeConfirmDelete}
        onCancel={() => setConfirmAction(null)}
      />

      <div className="flex items-center justify-between border-b border-white/14 pb-3">
        <div className="flex items-center gap-2.5">
          <span className="dj-tnum text-xs tracking-widest text-[#6E7371]">[ 04 ]</span>
          <h2 className="dj-serif text-base font-semibold tracking-wider text-[#F4F4F0]">
            Storyboard 分鏡劇本
          </h2>
        </div>
        <button
          type="button"
          onClick={() => setShowKeyInput((v) => !v)}
          className="min-h-[48px] px-3 border border-white/14 text-[11px] tracking-widest text-[#9A9E9C] hover:text-[#F4F4F0] active:scale-[0.96] transition-all"
          data-testid="toggle-gemini-key-btn"
        >
          {geminiKey ? 'GEMINI KEY 已設定' : '設定 GEMINI KEY'}
        </button>
      </div>

      {/* Gemini Key 手風琴展開收起 */}
      <div className={`dj-accordion ${showKeyInput ? 'is-open' : ''}`}>
        <div className="dj-accordion-inner">
          <div className="dj-surface-card p-4 space-y-3 mb-1">
            <label className="block space-y-1.5">
              <span className="text-xs text-[#9A9E9C]">Google Gemini API Key（僅存於本機）</span>
              <input
                type="password"
                value={geminiKey}
                onChange={(e) => setGeminiKey(e.target.value)}
                placeholder="AIza..."
                className="w-full min-h-[48px] px-3 bg-[#0E0F12] border border-white/14 text-sm text-[#F4F4F0] focus:outline-none focus:border-white/40"
              />
            </label>
            <button type="button" onClick={handleSaveKey} className="dj-btn dj-btn-primary w-full">
              儲存 API Key
            </button>
          </div>
        </div>
      </div>

      {/* AI 故事大綱拆解器 */}
      <div className="dj-surface-card p-4 space-y-3.5">
        <div className="flex items-center justify-between border-b border-white/10 pb-2">
          <span className="text-xs tracking-widest text-[#9A9E9C]">STORY GENERATOR</span>
          <span className="dj-tnum text-[11px] text-[#6E7371]">GEMINI 2.5 FLASH</span>
        </div>

        <label className="block space-y-1.5">
          <span className="text-xs text-[#9A9E9C]">故事大綱 (Synopsis)</span>
          <textarea
            rows={3}
            value={synopsis}
            onChange={(e) => setSynopsis(e.target.value)}
            placeholder="例如：深夜的東京巷弄，一位旅人撐傘走過微光閃爍的自動販賣機，最後在天橋上仰望黎明..."
            className="w-full p-3 bg-[#0E0F12] border border-white/14 text-sm text-[#F4F4F0] placeholder:text-[#6E7371] leading-relaxed focus:outline-none focus:border-white/40"
          />
        </label>

        <div className="grid grid-cols-2 gap-2.5">
          <div className="space-y-1.5">
            <span className="text-[11px] text-[#9A9E9C] block">全局風格 (Global)</span>
            <ArchSelect
              value={globalStyleId}
              onChange={setGlobalStyleId}
              options={[
                { value: '', label: '不指定全局風格' },
                ...imagePresets.map((p) => ({ value: p.id, label: p.name })),
              ]}
            />
          </div>

          <div className="space-y-1.5">
            <span className="text-[11px] text-[#9A9E9C] block">分鏡數量 (Shots)</span>
            <ArchSelect
              value={String(shotCount)}
              onChange={(val) => setShotCount(Number(val))}
              options={[3, 4, 5, 6, 8].map((n) => ({
                value: String(n),
                label: `${n} 個分鏡`,
              }))}
            />
          </div>
        </div>

        <div className="grid grid-cols-2 gap-2.5">
          <button
            type="button"
            disabled={generating}
            onClick={handleGenerateAi}
            className="dj-btn dj-btn-primary text-xs"
            data-testid="ai-generate-sb-btn"
          >
            {generating ? '拆解劇本中...' : 'AI 拆解分鏡'}
          </button>
          <button
            type="button"
            onClick={handleCreateBlank}
            className="dj-btn text-xs text-[#9A9E9C]"
            data-testid="blank-sb-btn"
          >
            ＋ 手動空白劇本
          </button>
        </div>
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

      {/* 已存劇本切換 */}
      {storyboards.length > 0 && (
        <div className="space-y-2">
          <span className="text-[11px] tracking-widest text-[#6E7371]">SAVED STORYBOARDS</span>
          <div className="flex gap-2 overflow-x-auto pb-1">
            {storyboards.map((sb) => {
              const selected = activeBoard?.id === sb.id;
              return (
                <button
                  key={sb.id}
                  type="button"
                  onClick={() => setActiveBoard(sb)}
                  className={`min-h-[48px] px-3.5 border text-xs whitespace-nowrap shrink-0 active:scale-[0.96] transition-all ${
                    selected
                      ? 'bg-[#F4F4F0] text-[#0E0F12] border-[#F4F4F0] font-medium'
                      : 'bg-[#181A1E] text-[#9A9E9C] border-white/14'
                  }`}
                >
                  {sb.title} ({sb.shots.length})
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* 當前編輯中的 Storyboard & Shot 清單（帶入 dj-panel-reveal 進場動畫） */}
      {activeBoard && (
        <div key={activeBoard.id} className="dj-panel-reveal space-y-4">
          <div className="dj-surface-card p-4 space-y-3">
            <div className="flex items-center justify-between border-b border-white/10 pb-2">
              <span className="text-xs tracking-widest text-[#9A9E9C]">ACTIVE STORYBOARD</span>
              <button
                type="button"
                onClick={() =>
                  setConfirmAction({
                    type: 'board',
                    id: activeBoard.id,
                    title: activeBoard.title,
                  })
                }
                className="min-h-[48px] px-2 text-xs text-[#B86B4B] active:scale-[0.96] transition-transform"
              >
                刪除劇本
              </button>
            </div>

            <label className="block space-y-1">
              <span className="text-[11px] text-[#9A9E9C]">劇本標題</span>
              <input
                type="text"
                value={activeBoard.title}
                onChange={(e) => setActiveBoard({ ...activeBoard, title: e.target.value })}
                className="w-full min-h-[48px] px-3 bg-[#0E0F12] border border-white/14 text-sm text-[#F4F4F0] focus:outline-none focus:border-white/40"
              />
            </label>

            <div className="flex items-center justify-between pt-1">
              <span className="dj-tnum text-xs text-[#9A9E9C]">
                共 {activeBoard.shots.length} 鏡
              </span>
              <button
                type="button"
                onClick={addShot}
                className="min-h-[48px] px-3 border border-white/14 text-xs text-[#F4F4F0] active:scale-[0.96] transition-transform"
                data-testid="add-shot-btn"
              >
                ＋ 新增分鏡
              </button>
            </div>
          </div>

          {activeBoard.shots.map((shot, idx) => (
            <div key={shot.id} className="dj-panel-reveal dj-surface-card p-4 space-y-3">
              <div className="flex items-center justify-between border-b border-white/10 pb-2">
                <span className="dj-tnum text-xs tracking-widest text-[#F4F4F0]">
                  SHOT {String(idx + 1).padStart(2, '0')} |{' '}
                  {String(activeBoard.shots.length).padStart(2, '0')}
                </span>
                <button
                  type="button"
                  onClick={() =>
                    setConfirmAction({
                      type: 'shot',
                      id: shot.id,
                      order: idx + 1,
                    })
                  }
                  className="min-h-[48px] px-2 text-xs text-[#B86B4B] active:scale-[0.96] transition-transform"
                >
                  移除
                </button>
              </div>

              <label className="block space-y-1">
                <span className="text-[11px] text-[#9A9E9C]">畫面描述 (Visual Prompt)</span>
                <textarea
                  rows={2}
                  value={shot.visualDescription}
                  onChange={(e) => updateShot(shot.id, { visualDescription: e.target.value })}
                  placeholder="英文或中文畫面描述..."
                  className="w-full p-2.5 bg-[#0E0F12] border border-white/14 text-xs text-[#F4F4F0] leading-relaxed focus:outline-none focus:border-white/40"
                />
              </label>

              <label className="block space-y-1">
                <span className="text-[11px] text-[#9A9E9C]">字幕文字 (Subtitle)</span>
                <input
                  type="text"
                  value={shot.subtitleText}
                  onChange={(e) => updateShot(shot.id, { subtitleText: e.target.value })}
                  placeholder="輸入該鏡旁白或字幕..."
                  className="w-full min-h-[48px] px-3 bg-[#0E0F12] border border-white/14 text-xs text-[#F4F4F0] focus:outline-none focus:border-white/40"
                />
              </label>

              <div className="grid grid-cols-2 gap-2">
                <div className="space-y-1">
                  <span className="text-[11px] text-[#9A9E9C] block">生圖風格</span>
                  <ArchSelect
                    value={shot.imageStylePresetId || ''}
                    onChange={(val) =>
                      updateShot(shot.id, { imageStylePresetId: val || undefined })
                    }
                    options={[
                      { value: '', label: '跟隨全局' },
                      ...imagePresets.map((p) => ({ value: p.id, label: p.name })),
                    ]}
                  />
                </div>

                <div className="space-y-1">
                  <span className="text-[11px] text-[#9A9E9C] block">動態風格 (I2V)</span>
                  <ArchSelect
                    value={shot.videoStylePresetId || ''}
                    onChange={(val) =>
                      updateShot(shot.id, { videoStylePresetId: val || undefined })
                    }
                    options={[
                      { value: '', label: '預設動態' },
                      ...videoPresets.map((p) => ({ value: p.id, label: p.name })),
                    ]}
                  />
                </div>
              </div>
            </div>
          ))}

          <button
            type="button"
            disabled={saving}
            onClick={handleSaveBoard}
            className="dj-btn dj-btn-primary w-full"
            data-testid="save-storyboard-btn"
          >
            {saving ? '儲存中...' : '儲存 Storyboard 分鏡劇本'}
          </button>
        </div>
      )}
    </section>
  );
};
