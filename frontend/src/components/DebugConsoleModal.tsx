import React, { useEffect, useState } from 'react';
import {
  clearDebugLogs,
  getDebugLogs,
  subscribeDebugLogs,
  type DebugEntry,
} from '../services/debugLogService';
import type { BackendGatewayHealth, GatewayConfig } from '../types/domain';

interface DebugConsoleModalProps {
  open: boolean;
  onClose: () => void;
  userEmail?: string | null;
  gatewayConfig: GatewayConfig | null;
  health: BackendGatewayHealth | null;
  lastError: string | null;
}

export const DebugConsoleModal: React.FC<DebugConsoleModalProps> = ({
  open,
  onClose,
  userEmail,
  gatewayConfig,
  health,
  lastError,
}) => {
  const [logs, setLogs] = useState<DebugEntry[]>(() => getDebugLogs());
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    return subscribeDebugLogs(() => setLogs(getDebugLogs()));
  }, []);

  if (!open) return null;

  const buildReportText = () => {
    const lines = [
      '=== 繪師 (Huishi) 診斷報告 ===',
      `URL: ${window.location.href}`,
      `User: ${userEmail || '未登入'}`,
      `Gateway URL: ${gatewayConfig?.url || '無'}`,
      `Gateway Status: ${health?.status || gatewayConfig?.status || 'offline'}`,
      `GPU: ${health?.gpu_name || gatewayConfig?.gpuName || '未知'} (${health?.vram_gb ?? gatewayConfig?.vramGb ?? 0} GB / ${health?.vram_mode || gatewayConfig?.vramMode || 'unknown'})`,
      `Last UI Error: ${lastError || '無'}`,
      `UA: ${navigator.userAgent}`,
      '--- Recent Logs ---',
      ...(logs.length > 0
        ? logs.map((l) => `[${l.time}] [${l.level.toUpperCase()}] (${l.source}) ${l.message}`)
        : ['(無紀錄)']),
    ];
    return lines.join('\n');
  };

  const handleCopy = async () => {
    const report = buildReportText();
    try {
      await navigator.clipboard.writeText(report);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      const ta = document.createElement('textarea');
      ta.value = report;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      document.body.removeChild(ta);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  return (
    <div
      className="fixed inset-0 z-[130] flex items-center justify-center p-4 bg-black/75 backdrop-blur-[6px]"
      onClick={onClose}
    >
      <div
        className="dj-modal-enter w-full max-w-[390px] max-h-[82vh] flex flex-col bg-[#121418] border border-white/25 p-4 space-y-3 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label="隱密偵錯紀錄"
      >
        <div className="flex items-center justify-between border-b border-white/14 pb-2.5">
          <div>
            <h3 className="dj-serif text-sm font-semibold tracking-widest text-[#F4F4F0]">
              系統偵錯紀錄
            </h3>
            <p className="dj-tnum text-[10px] text-[#6E7371]">DIAGNOSTIC VAULT</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="min-w-[48px] min-h-[48px] border border-white/14 text-xs text-[#9A9E9C] hover:text-[#F4F4F0]"
          >
            ✕
          </button>
        </div>

        <div className="grid grid-cols-2 gap-2">
          <button
            type="button"
            onClick={handleCopy}
            className="dj-btn dj-btn-primary text-xs"
            data-testid="copy-debug-report-btn"
          >
            {copied ? '已複製報告' : '複製錯誤報告'}
          </button>
          <button
            type="button"
            onClick={clearDebugLogs}
            className="dj-btn text-xs text-[#9A9E9C]"
          >
            清空紀錄
          </button>
        </div>

        <pre className="flex-1 overflow-y-auto p-3 bg-[#0E0F12] border border-white/10 text-[11px] text-[#9A9E9C] whitespace-pre-wrap break-all leading-relaxed font-mono">
          {buildReportText()}
        </pre>
      </div>
    </div>
  );
};
