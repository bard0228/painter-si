import React, { useEffect, useMemo, useState } from 'react';
import type { User } from 'firebase/auth';
import { isFirebaseConfigured } from '../config/firebase';
import {
  deleteStylePreset,
  saveStylePreset,
  seedDefaultStylePresets,
  subscribeStylePresets,
  type StylePresetInput,
} from '../services/stylePresetService';
import type { StylePreset, StylePresetType } from '../types/domain';
import { ArchSelect } from './ArchSelect';
import { ConfirmDialog } from './ConfirmDialog';

import { ANIME_CHECKPOINT, REALISTIC_CHECKPOINT } from '../data/defaultStylePresets';

interface StylePresetManagerProps {
  user: User | null;
}

const CHECKPOINT_OPTIONS = [
  { value: ANIME_CHECKPOINT, label: 'Animagine XL 3.1（動漫 / 光影 / 插畫）' },
  { value: REALISTIC_CHECKPOINT, label: 'Juggernaut XL v9（電影 / 真實寫實）' },
];

const SAMPLER_OPTIONS = [
  { value: 'euler', label: 'euler — 乾淨快速' },
  { value: 'euler_ancestral', label: 'euler_ancestral — 柔和插畫 / 動漫推薦' },
  { value: 'dpmpp_2m', label: 'dpmpp_2m — 電影寫實主力' },
  { value: 'dpmpp_2m_sde', label: 'dpmpp_2m_sde — 立體材質細緻' },
  { value: 'uni_pc', label: 'uni_pc — 低步數高效率' },
];

const EMPTY_FORM = (type: StylePresetType): StylePresetInput => ({
  name: '',
  type,
  positivePromptTemplate: '{prompt}, ',
  negativePromptTemplate: '',
  sampler: type === 'image' ? 'euler_ancestral' : 'euler',
  steps: type === 'image' ? 26 : 20,
  cfgScale: type === 'image' ? 6.5 : 6.0,
  checkpointName: type === 'image' ? ANIME_CHECKPOINT : '',
  loraName: '',
});

export const StylePresetManager: React.FC<StylePresetManagerProps> = ({ user }) => {
  const useCloud = Boolean(user && isFirebaseConfigured);
  const [presets, setPresets] = useState<StylePreset[]>([]);
  const [activeType, setActiveType] = useState<StylePresetType>('image');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [showAdvancedParams, setShowAdvancedParams] = useState(false);
  const [form, setForm] = useState<StylePresetInput>(() => EMPTY_FORM('image'));
  const [saving, setSaving] = useState(false);
  const [statusMsg, setStatusMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pendingDelete, setPendingDelete] = useState<StylePreset | null>(null);

  useEffect(() => {
    const unsub = subscribeStylePresets(
      useCloud,
      (items) => {
        setPresets(items);
        setError(null);
      },
      (err) => setError(`讀取 StylePreset 失敗：${err.message}`)
    );
    return () => unsub();
  }, [useCloud]);

  const filteredPresets = useMemo(
    () => presets.filter((p) => p.type === activeType),
    [presets, activeType]
  );

  const openCreate = () => {
    setEditingId(null);
    setForm(EMPTY_FORM(activeType));
    setShowAdvancedParams(false);
    setIsFormOpen(true);
    setError(null);
    setStatusMsg(null);
  };

  const openEdit = (preset: StylePreset) => {
    setEditingId(preset.id);
    setForm({
      id: preset.id,
      name: preset.name,
      type: preset.type,
      positivePromptTemplate: preset.positivePromptTemplate,
      negativePromptTemplate: preset.negativePromptTemplate,
      sampler: preset.sampler,
      steps: preset.steps,
      cfgScale: preset.cfgScale,
      checkpointName: preset.checkpointName || ANIME_CHECKPOINT,
      loraName: preset.loraName || '',
      createdAt: preset.createdAt,
    });
    setShowAdvancedParams(false);
    setIsFormOpen(true);
    setError(null);
    setStatusMsg(null);
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.name.trim()) {
      setError('請輸入風格名稱');
      return;
    }
    setSaving(true);
    setError(null);
    setStatusMsg(null);
    try {
      const saved = await saveStylePreset(useCloud, form);
      if (!useCloud) {
        setPresets((prev) => {
          const idx = prev.findIndex((p) => p.id === saved.id);
          if (idx >= 0) {
            const copy = [...prev];
            copy[idx] = saved;
            return copy;
          }
          return [saved, ...prev];
        });
      }
      setIsFormOpen(false);
      setEditingId(null);
      setStatusMsg(editingId ? `已更新風格「${saved.name}」` : `已建立風格「${saved.name}」`);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  };

  const confirmDelete = async () => {
    if (!pendingDelete) return;
    const target = pendingDelete;
    setPendingDelete(null);
    setError(null);
    setStatusMsg(null);
    try {
      await deleteStylePreset(useCloud, target.id);
      if (!useCloud) {
        setPresets((prev) => prev.filter((p) => p.id !== target.id));
      }
      if (editingId === target.id) {
        setIsFormOpen(false);
        setEditingId(null);
      }
      setStatusMsg(`已刪除風格「${target.name}」`);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const handleSeedDefaults = async () => {
    setSaving(true);
    setError(null);
    setStatusMsg(null);
    try {
      const existingIds = new Set(presets.map((p) => p.id));
      const inserted = await seedDefaultStylePresets(useCloud, existingIds);
      if (inserted.length > 0) {
        if (!useCloud) {
          setPresets((prev) => [...inserted, ...prev]);
        }
        setStatusMsg(`已匯入 ${inserted.length} 組內建風格範本`);
      } else {
        setStatusMsg('內建預設範本皆已存在於列表中');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className="dj-tab-enter space-y-5">
      <ConfirmDialog
        open={Boolean(pendingDelete)}
        title="刪除風格預設"
        message={`確定要刪除「${pendingDelete?.name || ''}」嗎？此操作無法復原。`}
        onConfirm={confirmDelete}
        onCancel={() => setPendingDelete(null)}
      />

      <div className="flex items-center justify-between border-b border-white/14 pb-3">
        <div className="flex items-center gap-2.5">
          <span className="dj-tnum text-xs tracking-widest text-[#6E7371]">[ 02 ]</span>
          <h2 className="dj-serif text-base font-semibold tracking-wider text-[#F4F4F0]">
            StylePreset 風格預設
          </h2>
        </div>
        <span className="dj-tnum text-[11px] tracking-widest px-2.5 py-1 border border-white/14 text-[#9A9E9C]">
          {useCloud ? 'FIRESTORE' : 'LOCAL'}
        </span>
      </div>

      {/* 圖片風格 / 影片風格 切換 */}
      <div className="grid grid-cols-2 gap-2.5">
        {(['image', 'video'] as const).map((t) => {
          const active = activeType === t;
          return (
            <button
              key={t}
              type="button"
              onClick={() => {
                setActiveType(t);
                setIsFormOpen(false);
                setStatusMsg(null);
              }}
              className={`min-h-[48px] border text-xs font-medium tracking-[0.12em] transition-all active:scale-[0.96] ${
                active
                  ? 'bg-[#F4F4F0] text-[#0E0F12] border-[#F4F4F0]'
                  : 'bg-[#181A1E] text-[#9A9E9C] border-white/14 hover:border-white/30'
              }`}
            >
              {t === 'image' ? 'IMAGE / 圖片風格' : 'VIDEO / 影片風格'}
            </button>
          );
        })}
      </div>

      {/* 操作列：新增 + 匯入範本 */}
      <div className="flex items-center gap-2.5">
        <button
          type="button"
          onClick={openCreate}
          className="dj-btn dj-btn-primary flex-1"
          data-testid="add-preset-btn"
        >
          ＋ 新增{activeType === 'image' ? '圖片' : '影片'}風格
        </button>

        <button
          type="button"
          disabled={saving}
          onClick={handleSeedDefaults}
          className="dj-btn px-4 text-xs text-[#9A9E9C]"
          data-testid="seed-presets-btn"
        >
          匯入範本
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

      {/* 新增 / 編輯表單卡片（手風琴動畫展開收起） */}
      <div className={`dj-accordion ${isFormOpen ? 'is-open' : ''}`}>
        <div className="dj-accordion-inner">
          <form onSubmit={handleSave} className="dj-surface-card p-4 space-y-3.5 mb-1">
            <div className="flex items-center justify-between border-b border-white/10 pb-2.5">
              <span className="text-xs tracking-widest text-[#9A9E9C]">
                {editingId ? 'EDIT / 編輯風格' : 'NEW / 建立風格'}
              </span>
              <button
                type="button"
                onClick={() => setIsFormOpen(false)}
                className="min-h-[48px] min-w-[48px] text-xs tracking-widest text-[#9A9E9C] hover:text-[#F4F4F0]"
              >
                取消
              </button>
            </div>

            <label className="block space-y-1.5">
              <span className="text-xs text-[#9A9E9C]">風格名稱</span>
              <input
                type="text"
                required={isFormOpen}
                value={form.name}
                onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                placeholder="例如：暗黑建築電影感"
                className="w-full min-h-[48px] px-3 bg-[#0E0F12] border border-white/14 text-sm text-[#F4F4F0] placeholder:text-[#6E7371] focus:outline-none focus:border-white/40"
              />
            </label>

            <label className="block space-y-1.5">
              <span className="text-xs text-[#9A9E9C]">正向提示詞模板 (Positive)</span>
              <textarea
                rows={3}
                value={form.positivePromptTemplate}
                onChange={(e) =>
                  setForm((f) => ({ ...f, positivePromptTemplate: e.target.value }))
                }
                placeholder="{prompt}, cinematic lighting..."
                className="w-full p-3 bg-[#0E0F12] border border-white/14 text-xs text-[#F4F4F0] leading-relaxed focus:outline-none focus:border-white/40"
              />
            </label>

            <label className="block space-y-1.5">
              <span className="text-xs text-[#9A9E9C]">負向提示詞模板 (Negative)</span>
              <textarea
                rows={2}
                value={form.negativePromptTemplate}
                onChange={(e) =>
                  setForm((f) => ({ ...f, negativePromptTemplate: e.target.value }))
                }
                className="w-full p-3 bg-[#0E0F12] border border-white/14 text-xs text-[#F4F4F0] leading-relaxed focus:outline-none focus:border-white/40"
              />
            </label>

            {/* 預設折疊的進階參數手風琴（依 GPU 模型自動安全配對） */}
            <div className="border-t border-white/10 pt-2">
              <button
                type="button"
                onClick={() => setShowAdvancedParams((v) => !v)}
                className="w-full min-h-[48px] px-3 bg-[#0E0F12] border border-white/14 hover:border-white/30 text-xs text-[#9A9E9C] flex items-center justify-between active:scale-[0.98] transition-all"
                data-testid="toggle-advanced-params-btn"
              >
                <span>進階參數（自動安全配對）</span>
                <span
                  className={`dj-tnum text-[10px] transition-transform duration-300 ${
                    showAdvancedParams ? 'rotate-180' : ''
                  }`}
                >
                  ▼
                </span>
              </button>

              <div className={`dj-accordion ${showAdvancedParams ? 'is-open' : ''}`}>
                <div className="dj-accordion-inner">
                  <div className="pt-3 space-y-3">
                    {form.type === 'image' && (
                      <div className="space-y-1.5">
                        <span className="text-[11px] text-[#9A9E9C] block">主力底模 (Checkpoint)</span>
                        <ArchSelect
                          value={form.checkpointName || ANIME_CHECKPOINT}
                          onChange={(val) => setForm((f) => ({ ...f, checkpointName: val }))}
                          options={CHECKPOINT_OPTIONS}
                        />
                      </div>
                    )}

                    <div className="space-y-1.5">
                      <span className="text-[11px] text-[#9A9E9C] block">採樣器 (Sampler)</span>
                      <ArchSelect
                        value={form.sampler}
                        onChange={(val) => setForm((f) => ({ ...f, sampler: val }))}
                        options={SAMPLER_OPTIONS}
                      />
                    </div>

                    <div className="grid grid-cols-2 gap-2.5">
                      <label className="block space-y-1.5">
                        <span className="text-[11px] text-[#9A9E9C]">Steps（Turbo 自動限縮）</span>
                        <input
                          type="number"
                          min={1}
                          max={100}
                          value={form.steps}
                          onChange={(e) => setForm((f) => ({ ...f, steps: Number(e.target.value) }))}
                          className="dj-tnum w-full min-h-[48px] px-2.5 bg-[#0E0F12] border border-white/14 text-xs text-[#F4F4F0] focus:outline-none focus:border-white/40"
                        />
                      </label>

                      <label className="block space-y-1.5">
                        <span className="text-[11px] text-[#9A9E9C]">CFG（Turbo 自動限縮）</span>
                        <input
                          type="number"
                          step="0.5"
                          min={1}
                          max={20}
                          value={form.cfgScale}
                          onChange={(e) => setForm((f) => ({ ...f, cfgScale: Number(e.target.value) }))}
                          className="dj-tnum w-full min-h-[48px] px-2.5 bg-[#0E0F12] border border-white/14 text-xs text-[#F4F4F0] focus:outline-none focus:border-white/40"
                        />
                      </label>
                    </div>

                    <label className="block space-y-1.5">
                      <span className="text-xs text-[#9A9E9C]">
                        單一 LoRA 權重檔名（選填，置於 Drive models/loras/）
                      </span>
                      <input
                        type="text"
                        value={form.loraName || ''}
                        onChange={(e) => setForm((f) => ({ ...f, loraName: e.target.value }))}
                        placeholder="留空不使用；範例：watercolor_v1.safetensors"
                        className="w-full min-h-[48px] px-3 bg-[#0E0F12] border border-white/14 text-xs text-[#F4F4F0] placeholder:text-[#6E7371] focus:outline-none focus:border-white/40"
                      />
                    </label>
                  </div>
                </div>
              </div>
            </div>

            <button
              type="submit"
              disabled={saving}
              className="dj-btn dj-btn-primary w-full"
              data-testid="save-preset-btn"
            >
              {saving ? '儲存中...' : editingId ? '儲存變更' : '建立風格'}
            </button>
          </form>
        </div>
      </div>

      {/* StylePreset 列表（切換圖片/影片時套用方向性滑入動畫） */}
      <div
        key={activeType}
        className={`space-y-3 ${activeType === 'image' ? 'dj-slide-left' : 'dj-tab-enter'}`}
      >
        {filteredPresets.length === 0 ? (
          <div className="dj-surface-card p-6 text-center space-y-1.5">
            <p className="text-sm text-[#9A9E9C]">
              尚無{activeType === 'image' ? '圖片' : '影片'}風格預設
            </p>
            <p className="text-xs text-[#6E7371]">可點擊上方「匯入範本」或自行建立</p>
          </div>
        ) : (
          filteredPresets.map((preset, idx) => (
            <div key={preset.id} className="dj-surface-card p-4 space-y-3">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="dj-tnum text-[11px] text-[#6E7371]">
                      {String(idx + 1).padStart(2, '0')}
                    </span>
                    <h3 className="dj-serif text-sm font-semibold text-[#F4F4F0] truncate">
                      {preset.name}
                    </h3>
                  </div>
                  <p className="dj-tnum text-[11px] text-[#9A9E9C] mt-1">
                    {preset.sampler} / {preset.steps} steps / CFG {preset.cfgScale}
                  </p>
                </div>
                <span className="dj-tnum text-[10px] tracking-widest px-2 py-0.5 border border-white/14 text-[#9A9E9C] shrink-0">
                  {preset.type === 'image' ? 'IMG' : 'VID'}
                </span>
              </div>

              <p className="text-xs text-[#9A9E9C] line-clamp-2 leading-relaxed bg-[#0E0F12] p-2.5 border border-white/10">
                {preset.positivePromptTemplate}
              </p>

              {preset.loraName && (
                <p className="text-[11px] text-[#4C7C62] truncate">
                  LoRA / {preset.loraName}
                </p>
              )}

              <div className="flex items-center justify-end gap-2 pt-1">
                <button
                  type="button"
                  onClick={() => openEdit(preset)}
                  className="min-h-[48px] min-w-[68px] px-3 border border-white/14 text-xs tracking-widest text-[#F4F4F0] hover:border-white/35 active:scale-[0.96] transition-all"
                >
                  編輯
                </button>
                <button
                  type="button"
                  onClick={() => setPendingDelete(preset)}
                  className="min-h-[48px] min-w-[68px] px-3 border border-[#B86B4B]/50 text-xs tracking-widest text-[#B86B4B] hover:border-[#B86B4B] active:scale-[0.96] transition-all"
                  data-testid={`delete-preset-${preset.id}`}
                >
                  刪除
                </button>
              </div>
            </div>
          ))
        )}
      </div>
    </section>
  );
};
