import React from 'react';

export interface NavItem {
  code: string;
  label: string;
  ticket: string;
  enabled: boolean;
}

const NAV_ITEMS: NavItem[] = [
  { code: '01', label: '閘道連線', ticket: 'Ticket #1', enabled: true },
  { code: '02', label: '風格預設', ticket: 'Ticket #2', enabled: true },
  { code: '03', label: '單張生圖', ticket: 'Ticket #3', enabled: true },
  { code: '04', label: '分鏡劇本', ticket: 'Ticket #4', enabled: true },
  { code: '05', label: '批次算圖', ticket: 'Ticket #5', enabled: true },
  { code: '06', label: '分鏡剪輯', ticket: 'Ticket #6', enabled: true },
];

interface WovenDrawerProps {
  isOpen: boolean;
  onToggle: () => void;
  onClose: () => void;
  activeCode: string;
  onSelect: (code: string) => void;
}

export const WovenDrawer: React.FC<WovenDrawerProps> = ({
  isOpen,
  onClose,
  activeCode,
  onSelect,
}) => {
  return (
    <>
      {isOpen && (
        <div
          className="fixed inset-0 z-[95] bg-black/60 backdrop-blur-[2px]"
          onClick={onClose}
          aria-hidden="true"
        />
      )}

      <aside className={`dj-drawer ${isOpen ? 'is-open' : ''}`} aria-label="繪師功能導覽">
        <div className="flex items-center justify-between pb-4 mb-5 border-b border-white/14">
          <div>
            <p className="dj-serif text-sm font-semibold tracking-[0.14em] text-[#F4F4F0]">
              繪師
            </p>
            <p className="dj-display text-[11px] text-[#9A9E9C] tracking-[0.12em]">
              PAINTER SI STUDIO
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="min-w-[48px] min-h-[48px] flex items-center justify-center border border-white/14 text-xs tracking-widest text-[#9A9E9C] hover:text-[#F4F4F0] hover:border-white/35 active:scale-[0.96] transition-all"
          >
            ✕
          </button>
        </div>

        <nav className="flex flex-col gap-2">
          {NAV_ITEMS.map((item) => {
            const isActive = activeCode === item.code;
            return (
              <button
                key={item.code}
                type="button"
                disabled={!item.enabled}
                onClick={() => {
                  if (item.enabled) {
                    onSelect(item.code);
                    onClose();
                  }
                }}
                className={`min-h-[48px] w-full px-3.5 border text-left flex items-center justify-between transition-all active:scale-[0.96] ${
                  isActive
                    ? 'border-white/40 bg-white/10 text-[#F4F4F0]'
                    : item.enabled
                      ? 'border-white/14 text-[#F4F4F0]/85 hover:border-white/30'
                      : 'border-white/5 text-[#6E7371] cursor-not-allowed'
                }`}
              >
                <span className="flex items-center gap-3">
                  <span className="dj-tnum text-[11px] text-[#9A9E9C]">{item.code}</span>
                  <span className="text-sm font-medium tracking-wider">{item.label}</span>
                </span>
                <span className="dj-tnum text-[10px] tracking-widest text-[#6E7371]">
                  {item.enabled ? 'ACTIVE' : item.ticket}
                </span>
              </button>
            );
          })}
        </nav>

        <div className="mt-auto pt-4 border-t border-white/10 flex items-center justify-between text-[11px] text-[#6E7371]">
          <span className="dj-tnum">01 | 06</span>
          <span className="tracking-widest">DARK JP UI</span>
        </div>
      </aside>
    </>
  );
};
