import React, { useEffect, useRef } from 'react';
import { X } from 'lucide-react';

interface ModalDialogProps {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  closedBy?: 'any' | 'closerequest';
  children: React.ReactNode;
}

export const ModalDialog: React.FC<ModalDialogProps> = ({
  isOpen,
  onClose,
  title,
  closedBy = 'any',
  children
}) => {
  const dialogRef = useRef<HTMLDialogElement | null>(null);
  const titleId = `dialog-title-${title.replace(/\s+/g, '-').toLowerCase()}`;

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;

    if (isOpen && !dialog.open) {
      dialog.showModal();
    } else if (!isOpen && dialog.open) {
      dialog.close();
    }
  }, [isOpen]);

  // Fallback for browsers without declarative closedBy support
  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;

    const handleClose = () => {
      onClose();
    };

    const handleBackdropClick = (event: MouseEvent) => {
      if (closedBy !== 'any') return;
      if ('closedBy' in HTMLDialogElement.prototype) return;
      if (event.target !== dialog) return;

      const rect = dialog.getBoundingClientRect();
      const isDialogContent =
        rect.top <= event.clientY &&
        event.clientY <= rect.top + rect.height &&
        rect.left <= event.clientX &&
        event.clientX <= rect.left + rect.width;

      if (!isDialogContent) {
        dialog.close();
      }
    };

    dialog.addEventListener('close', handleClose);
    dialog.addEventListener('click', handleBackdropClick);
    return () => {
      dialog.removeEventListener('close', handleClose);
      dialog.removeEventListener('click', handleBackdropClick);
    };
  }, [onClose, closedBy]);

  return (
    <dialog
      ref={dialogRef}
      closedby={closedBy}
      aria-labelledby={titleId}
      className="m-auto w-[calc(100%-2rem)] max-w-lg max-h-[90dvh] overflow-hidden rounded-2xl bg-white p-0 text-slate-900 shadow-2xl border border-slate-100 open:animate-in open:fade-in open:zoom-in-95 duration-150"
    >
      <div className="flex items-center justify-between border-b border-slate-100 px-6 py-4 shrink-0">
        <h2 id={titleId} className="text-lg font-bold text-slate-900">
          {title}
        </h2>
        <button
          type="button"
          onClick={() => dialogRef.current?.close()}
          className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-600 transition-colors cursor-pointer"
          aria-label="Tutup dialog"
        >
          <X className="h-5 w-5" />
        </button>
      </div>
      <div className="p-6 overflow-y-auto flex-1 overscroll-contain">{children}</div>
    </dialog>
  );
};
