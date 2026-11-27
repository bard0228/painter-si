import React, { useEffect, useMemo, useState } from 'react';
import { onAuthStateChanged, signInWithPopup, signOut, type User } from 'firebase/auth';
import { auth, googleProvider, isFirebaseConfigured } from './config/firebase';
import { checkBackendGatewayHealth, subscribeGatewayConfig } from './services/gatewayService';
import type { BackendGatewayHealth, GatewayConfig } from './types/domain';
import { WovenDrawer } from './components/WovenDrawer';
import { StylePresetManager } from './components/StylePresetManager';
import { SingleImageStudio } from './components/SingleImageStudio';
import { StoryboardManager } from './components/StoryboardManager';
import { BatchRenderQueue } from './components/BatchRenderQueue';
import { StoryboardEditor } from './components/StoryboardEditor';
import { DebugConsoleModal } from './components/DebugConsoleModal';

function MaskedTitle({ text, revealed }: { text: string; revealed: boolean }) {
  return (
    <span className={`dj-text-mask ${revealed ? 'is-revealed' : ''}`}>
      {Array.from(text).map((ch, idx) => (
        <span
          key={`${ch}-${idx}`}
          className="dj-char"
          style={{ '--char-idx': idx } as React.CSSProperties}
        >
          {ch}
        </span>
      ))}
    </span>
  );
}

export function App() {
  const [user, setUser] = useState<User | null>(null);
  const [authLoading, setAuthLoading] = useState<boolean>(isFirebaseConfigured);
  const [gatewayConfig, setGatewayConfig] = useState<GatewayConfig | null>(null);
  const [health, setHealth] = useState<BackendGatewayHealth | null>(null);
  const [checkingHealth, setCheckingHealth] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [debugOpen, setDebugOpen] = useState(false);
  const [activeSection, setActiveSection] = useState<'01' | '02' | '03' | '04' | '05' | '06'>('01');
  const [revealed, setRevealed] = useState(false);
  const [titleAnimKey, setTitleAnimKey] = useState(0);
  const tapCountRef = React.useRef(0);
  const tapTimerRef = React.useRef<number | null>(null);

  const handleVersionSecretTap = () => {
    tapCountRef.current += 1;
    if (tapTimerRef.current) window.clearTimeout(tapTimerRef.current);
    if (tapCountRef.current >= 5) {
      tapCountRef.current = 0;
      setDebugOpen(true);
      return;
    }
    tapTimerRef.current = window.setTimeout(() => {
      tapCountRef.current = 0;
    }, 2200);
  };

  const switchSection = (code: '01' | '02' | '03' | '04' | '05' | '06') => {
    setActiveSection(code);
    if (code === '02') {
      setTitleAnimKey((k) => k + 1);
    }
  };

  useEffect(() => {
    const id = requestAnimationFrame(() => setRevealed(true));
    return () => cancelAnimationFrame(id);
  }, []);

  useEffect(() => {
    if (!auth) {
      setAuthLoading(false);
      return;
    }
    const unsub = onAuthStateChanged(auth, (u) => {
      setUser(u);
      setAuthLoading(false);
      if (!u) {
        setHealth(null);
      }
    });
    return () => unsub();
  }, []);

  useEffect(() => {
    if (!user) {
      setGatewayConfig(null);
      return;
    }
    const unsub = subscribeGatewayConfig(
      (cfg) => {
        setGatewayConfig(cfg);
        setErrorMessage(null);
      },
      (err) => {
        setErrorMessage(`讀取 Firestore 閘道失敗：${err.message}`);
      }
    );
    return () => unsub();
  }, [user]);

  useEffect(() => {
    if (!user || !gatewayConfig?.url) return;
    let cancelled = false;
    setCheckingHealth(true);
    setErrorMessage(null);

    checkBackendGatewayHealth(gatewayConfig.url, user)
      .then((res) => {
        if (!cancelled) setHealth(res);
      })
      .catch((err: Error) => {
        if (!cancelled) {
          setHealth(null);
          setErrorMessage(`BackendGateway 連線驗證失敗：${err.message}`);
        }
      })
      .finally(() => {
        if (!cancelled) setCheckingHealth(false);
      });

    return () => {
      cancelled = true;
    };
  }, [user, gatewayConfig?.url]);

  const handleLogin = async () => {
    if (!auth) return;
    setErrorMessage(null);
    try {
      await signInWithPopup(auth, googleProvider);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setErrorMessage(`登入失敗：${msg}`);
    }
  };

  const handleLogout = async () => {
    if (!auth) return;
    await signOut(auth);
    setHealth(null);
  };

  const handleManualCheck = async () => {
    if (!user || !gatewayConfig?.url) return;
    setCheckingHealth(true);
    setErrorMessage(null);
    try {
      const res = await checkBackendGatewayHealth(gatewayConfig.url, user);
      setHealth(res);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setHealth(null);
      setErrorMessage(`健康檢查失敗：${msg}`);
    } finally {
      setCheckingHealth(false);
    }
  };

  const statusBadge = useMemo(() => {
    if (!isFirebaseConfigured) return { text: 'UNCONFIGURED', border: 'border-[#9A9E9C]/40 text-[#9A9E9C]' };
    if (!user) return { text: 'OFFLINE', border: 'border-[#9A9E9C]/40 text-[#9A9E9C]' };
    if (checkingHealth) return { text: 'CHECKING', border: 'border-[#F4F4F0]/40 text-[#F4F4F0]' };
    if (health?.status === 'online') return { text: 'COLAB ONLINE', border: 'border-[#4C7C62] text-[#4C7C62]' };
    if (gatewayConfig?.url) return { text: 'NO RESPONSE', border: 'border-[#B86B4B] text-[#B86B4B]' };
    return { text: 'WAITING COLAB', border: 'border-[#9A9E9C]/40 text-[#9A9E9C]' };
  }, [user, checkingHealth, health, gatewayConfig]);

  return (
    <div
      id="app-shell"
      className="min-h-screen w-full relative"
      style={{
        backgroundColor: 'var(--dj-bg)',
        backgroundImage: 'var(--dj-bg-sheen)',
        paddingTop: 'max(18px, env(safe-area-inset-top))',
        paddingBottom: 'max(32px, env(safe-area-inset-bottom))',
      }}
    >
      <WovenDrawer
        isOpen={drawerOpen}
        onToggle={() => setDrawerOpen((v) => !v)}
        onClose={() => setDrawerOpen(false)}
        activeCode={activeSection}
        onSelect={(code) => {
          if (
            code === '01' ||
            code === '02' ||
            code === '03' ||
            code === '04' ||
            code === '05' ||
            code === '06'
          ) {
            switchSection(code);
          }
        }}
      />

      <DebugConsoleModal
        open={debugOpen}
        onClose={() => setDebugOpen(false)}
        userEmail={user?.email}
        gatewayConfig={gatewayConfig}
        health={health}
        lastError={errorMessage}
      />

      <main className="mx-auto w-full max-w-[412px] px-5">
        {/* 頂部建築極簡標題區（無圖示，右側三條不等長細線） */}
        <header className="flex items-center justify-between pt-2 pb-5">
          <div>
            <div className="flex items-center gap-2.5">
              <h1 className="dj-serif text-2xl font-semibold tracking-[0.14em] text-[#F4F4F0]">
                <MaskedTitle key={`zh-${titleAnimKey}`} text="繪師" revealed={revealed} />
              </h1>
              <button
                type="button"
                onClick={handleVersionSecretTap}
                className="dj-tnum text-[10px] tracking-widest px-2 py-0.5 border border-white/14 text-[#9A9E9C] bg-transparent cursor-pointer select-none"
                data-testid="version-secret-trigger"
              >
                v1.2
              </button>
            </div>
            <p className="dj-display text-xs text-[#9A9E9C] tracking-[0.12em]">
              <MaskedTitle key={`en-${titleAnimKey}`} text="PAINTER SI STUDIO" revealed={revealed} />
            </p>
          </div>

          <button
            type="button"
            aria-label="開啟工作室導覽"
            onClick={() => setDrawerOpen(true)}
            className="wv-woven-tag-trigger min-w-[48px] min-h-[48px] flex items-center justify-end bg-transparent border-0 p-0 cursor-pointer active:scale-[0.94] transition-transform"
          >
            <svg
              width="28"
              height="24"
              viewBox="0 0 28 24"
              fill="none"
              xmlns="http://www.w3.org/2000/svg"
              aria-hidden="true"
            >
              <line x1="2" y1="5" x2="26" y2="5" stroke="#F4F4F0" strokeWidth="1.5" />
              <line x1="10" y1="12" x2="26" y2="12" stroke="#F4F4F0" strokeWidth="1.5" />
              <line x1="16" y1="19" x2="26" y2="19" stroke="#F4F4F0" strokeWidth="1.5" />
            </svg>
          </button>
        </header>

        {/* 建築導覽分頁列 (3x2) */}
        <nav className="grid grid-cols-3 gap-1.5 pb-6">
          {[
            { code: '01' as const, label: '01 / 閘道' },
            { code: '02' as const, label: '02 / 風格' },
            { code: '03' as const, label: '03 / 生圖' },
            { code: '04' as const, label: '04 / 分鏡' },
            { code: '05' as const, label: '05 / 算圖' },
            { code: '06' as const, label: '06 / 剪輯' },
          ].map((tab) => {
            const active = activeSection === tab.code;
            return (
              <button
                key={tab.code}
                type="button"
                onClick={() => switchSection(tab.code)}
                className={`min-h-[48px] border text-[11px] font-medium tracking-[0.08em] transition-all active:scale-[0.96] ${
                  active
                    ? 'bg-[#F4F4F0] text-[#0E0F12] border-[#F4F4F0]'
                    : 'bg-[#181A1E] text-[#9A9E9C] border-white/14 hover:border-white/30'
                }`}
              >
                {tab.label}
              </button>
            );
          })}
        </nav>

        {activeSection === '01' && (
          <section className="dj-tab-enter space-y-5">
            <div className="flex items-center justify-between border-b border-white/14 pb-3">
              <div className="flex items-center gap-2.5">
                <span className="dj-tnum text-xs tracking-widest text-[#6E7371]">[ 01 ]</span>
                <h2 className="dj-serif text-base font-semibold tracking-wider text-[#F4F4F0]">
                  身份驗證與動態閘道
                </h2>
              </div>
              <span className={`dj-tnum text-[10px] tracking-widest px-2.5 py-1 border ${statusBadge.border}`}>
                {statusBadge.text}
              </span>
            </div>

            <div className="dj-surface-card p-4 space-y-3.5">
              <div className="flex items-center justify-between border-b border-white/10 pb-2.5">
                <span className="text-xs tracking-widest text-[#9A9E9C]">單人白名單驗證</span>
                <span className="dj-tnum text-[11px] text-[#6E7371]">ADR-02</span>
              </div>

              {!isFirebaseConfigured ? (
                <div className="space-y-2 text-sm leading-relaxed">
                  <p className="font-medium text-[#B86B4B]">尚未填入 Firebase 環境變數</p>
                  <p className="text-xs text-[#9A9E9C] leading-relaxed">
                    請複製 <code className="px-1 py-0.5 bg-white/10">.env.example</code> 為{' '}
                    <code className="px-1 py-0.5 bg-white/10">.env</code>{' '}
                    並填入 Firebase Web SDK 設定，即可啟用 Google 登入與 Firestore 即時連線。
                  </p>
                </div>
              ) : authLoading ? (
                <p className="text-sm text-[#9A9E9C]">檢查登入狀態中...</p>
              ) : user ? (
                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-[#F4F4F0] truncate">
                      {user.displayName || '創作者'}
                    </p>
                    <p className="text-xs text-[#9A9E9C] truncate">{user.email}</p>
                  </div>
                  <button type="button" onClick={handleLogout} className="dj-btn shrink-0 text-xs">
                    登出
                  </button>
                </div>
              ) : (
                <button type="button" onClick={handleLogin} className="dj-btn dj-btn-primary w-full">
                  以 Google 帳號登入繪師
                </button>
              )}
            </div>

            <div className="dj-surface-card p-4 space-y-3.5">
              <div className="flex items-center justify-between border-b border-white/10 pb-2.5">
                <span className="text-xs tracking-widest text-[#9A9E9C]">Colab BackendGateway</span>
                <span className="dj-tnum text-[11px] text-[#6E7371]">ADR-03</span>
              </div>

              {health ? (
                <div className="space-y-2 text-sm">
                  <div className="flex items-center justify-between py-2 border-b border-white/10">
                    <span className="text-xs text-[#9A9E9C]">運算狀態</span>
                    <span className="font-medium text-[#4C7C62]">Colab 在線</span>
                  </div>
                  <div className="flex items-center justify-between py-2 border-b border-white/10">
                    <span className="text-xs text-[#9A9E9C]">偵測 GPU 型號</span>
                    <span className="dj-tnum font-medium text-[#F4F4F0] text-right">
                      {health.gpu_name}
                    </span>
                  </div>
                  <div className="flex items-center justify-between py-2 border-b border-white/10">
                    <span className="text-xs text-[#9A9E9C]">VRAM 容量</span>
                    <span className="dj-tnum font-medium text-[#F4F4F0]">{health.vram_gb} GB</span>
                  </div>
                  <div className="flex items-center justify-between py-2">
                    <span className="text-xs text-[#9A9E9C]">VRAM 推論模式</span>
                    <span className="font-medium text-[#F4F4F0]">{health.workflow_tier}</span>
                  </div>
                </div>
              ) : (
                <div className="space-y-1.5 text-xs text-[#9A9E9C] leading-relaxed">
                  <p>
                    {gatewayConfig?.url
                      ? `已偵測閘道位址：${gatewayConfig.url}`
                      : '尚未收到 Colab 回報的 Tunnel URL（Firestore: system/gateway）。'}
                  </p>
                  <p className="text-[#6E7371]">
                    請於 Google Colab 執行 colab_launcher.ipynb 後自動同步連線。
                  </p>
                </div>
              )}

              {errorMessage && (
                <div className="p-3 border border-[#B86B4B] bg-[#B86B4B]/10 text-xs text-[#F4F4F0] break-all">
                  {errorMessage}
                </div>
              )}

              <button
                type="button"
                disabled={!user || !gatewayConfig?.url || checkingHealth}
                onClick={handleManualCheck}
                className="dj-btn dj-btn-primary w-full"
              >
                {checkingHealth ? '驗證 /health 中...' : '重新驗證 /health 與 GPU'}
              </button>
            </div>
          </section>
        )}

        {activeSection === '02' && <StylePresetManager user={user} />}

        {activeSection === '03' && (
          <SingleImageStudio user={user} gatewayConfig={gatewayConfig} />
        )}

        {activeSection === '04' && <StoryboardManager user={user} />}

        {activeSection === '05' && (
          <BatchRenderQueue user={user} gatewayConfig={gatewayConfig} />
        )}

        {activeSection === '06' && (
          <StoryboardEditor user={user} gatewayConfig={gatewayConfig} />
        )}
      </main>
    </div>
  );
}

export default App;
