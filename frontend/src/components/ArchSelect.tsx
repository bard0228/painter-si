import React, { useEffect, useRef, useState } from 'react';

export interface ArchSelectOption {
  value: string;
  label: string;
}

interface ArchSelectProps {
  value: string;
  onChange: (value: string) => void;
  options: ArchSelectOption[];
  placeholder?: string;
  className?: string;
  testId?: string;
}

export const ArchSelect: React.FC<ArchSelectProps> = ({
  value,
  onChange,
  options,
  placeholder = '請選擇',
  className = '',
  testId,
}) => {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handleOutside = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handleOutside);
    return () => document.removeEventListener('mousedown', handleOutside);
  }, [open]);

  const selected = options.find((o) => o.value === value);

  return (
    <div ref={rootRef} className={`relative ${className}`}>
      <button
        type="button"
        data-testid={testId}
        onClick={() => setOpen((v) => !v)}
        className="w-full min-h-[48px] px-3 bg-[#0E0F12] border border-white/14 hover:border-white/35 text-left text-xs text-[#F4F4F0] flex items-center justify-between gap-2 active:scale-[0.98] transition-all"
      >
        <span className="truncate">{selected ? selected.label : placeholder}</span>
        <span
          className={`dj-tnum text-[10px] text-[#9A9E9C] transition-transform duration-300 ${
            open ? 'rotate-180' : ''
          }`}
        >
          ▼
        </span>
      </button>

      <div className={`dj-accordion ${open ? 'is-open' : ''}`}>
        <div className="dj-accordion-inner">
          <div className="mt-1 bg-[#121418] border border-white/20 max-h-56 overflow-y-auto">
            {options.length === 0 ? (
              <div className="px-3 py-3 text-xs text-[#6E7371]">{placeholder}</div>
            ) : (
              options.map((opt) => {
                const isSelected = opt.value === value;
                return (
                  <button
                    key={opt.value}
                    type="button"
                    onClick={() => {
                      onChange(opt.value);
                      setOpen(false);
                    }}
                    className={`w-full min-h-[48px] px-3 text-left text-xs border-b border-white/5 last:border-b-0 flex items-center justify-between transition-colors ${
                      isSelected
                        ? 'bg-white/12 text-[#F4F4F0] font-medium'
                        : 'text-[#9A9E9C] hover:bg-white/5 hover:text-[#F4F4F0]'
                    }`}
                  >
                    <span className="truncate">{opt.label}</span>
                    {isSelected && <span className="dj-tnum text-[10px] text-[#4C7C62]">●</span>}
                  </button>
                );
              })
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
