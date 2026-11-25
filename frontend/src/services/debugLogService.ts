import { nowTaipeiIso } from '../data/defaultStylePresets';

export interface DebugEntry {
  time: string;
  level: 'error' | 'warn' | 'info';
  source: string;
  message: string;
}

const MAX_LOGS = 80;
const entries: DebugEntry[] = [];
const listeners = new Set<() => void>();

export function recordDebugLog(
  level: DebugEntry['level'],
  source: string,
  message: string
): void {
  entries.unshift({
    time: nowTaipeiIso(),
    level,
    source,
    message: String(message).slice(0, 1200),
  });
  if (entries.length > MAX_LOGS) {
    entries.length = MAX_LOGS;
  }
  listeners.forEach((fn) => fn());
}

export function getDebugLogs(): DebugEntry[] {
  return [...entries];
}

export function clearDebugLogs(): void {
  entries.length = 0;
  listeners.forEach((fn) => fn());
}

export function subscribeDebugLogs(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

let installed = false;
export function installGlobalDebugHooks(): void {
  if (installed || typeof window === 'undefined') return;
  installed = true;

  window.addEventListener('error', (ev) => {
    recordDebugLog('error', 'window.error', ev.message || String(ev.error || 'Unknown error'));
  });

  window.addEventListener('unhandledrejection', (ev) => {
    const reason = ev.reason instanceof Error ? ev.reason.message : String(ev.reason);
    recordDebugLog('error', 'unhandledrejection', reason);
  });

  const origError = console.error.bind(console);
  console.error = (...args: unknown[]) => {
    recordDebugLog(
      'error',
      'console.error',
      args.map((a) => (a instanceof Error ? a.message : String(a))).join(' ')
    );
    origError(...args);
  };
}
