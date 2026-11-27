import React from 'react';
import { createPortal } from 'react-dom';

interface ConfirmDialogProps {
  open: boolean;
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  onConfirm: () => void;
  onCancel: () => void;
}

export const ConfirmDialog: React.FC<ConfirmDialogProps> = ({
  open,
  title,
  message,
  confirmLabel = '確認刪除',
  cancelLabel = '取消',
  onConfirm,
  onCancel,
}) => {
  if (!open || typeof document === 'undefined') return null;

  return createPortal(
    <div
      className="fixed inset-0 z-[120] flex items-center justify-center p-5 bg-black/70 backdrop-blur-[4px]"
      onClick={onCancel}
    >
      <div
        className="dj-modal-enter w-full max-w-[360px] bg-[#181A1E] border border-white/25 p-5 space-y-4 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label={title}
      >
        <div className="flex items-center justify-between border-b border-white/14 pb-2.5">
          <h3 className="dj-serif text-base font-semibold tracking-wider text-[#F4F4F0]">
            {title}
          </h3>
          <span className="dj-tnum text-[10px] tracking-widest text-[#B86B4B]">CONFIRM</span>
        </div>

        <p className="text-xs text-[#9A9E9C] leading-relaxed">{message}</p>

        <div className="grid grid-cols-2 gap-2.5 pt-1">
          <button
            type="button"
            onClick={onCancel}
            className="dj-btn text-xs text-[#9A9E9C]"
            data-testid="confirm-cancel-btn"
          >
            {cancelLabel}
          </button>
          <button
            type="button"
            onClick={onConfirm}
            className="min-h-[48px] border border-[#B86B4B] bg-[#B86B4B]/20 text-xs font-medium tracking-widest text-[#F4F4F0] hover:bg-[#B86B4B]/35 active:scale-[0.96] transition-all"
            data-testid="confirm-ok-btn"
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
};
