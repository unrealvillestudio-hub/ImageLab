import React from "react";

export function RightDrawer(props: {
  isOpen: boolean;
  onClose: () => void;
  onOpen: () => void; 
  widthClass?: string;
  handleLabel?: string;
  children?: React.ReactNode;
}) {
  const { isOpen, onClose, onOpen, widthClass = "w-[420px] md:w-[460px]", handleLabel = "LIBRARY", children } = props;

  return (
    <>
      <button
        type="button"
        onClick={() => (isOpen ? onClose() : onOpen())} 
        className={`fixed right-0 top-1/2 z-[150] -translate-y-1/2 rounded-l-xl border border-zinc-700 bg-zinc-900 px-3 py-4 text-xs font-black uppercase tracking-widest uv-drawer-tab shadow-2xl transition-transform duration-300 hover:bg-zinc-800 ${isOpen ? 'translate-x-full' : 'translate-x-0'}`}
        aria-label="Toggle drawer"
        title="Toggle Asset Library"
        style={{ writingMode: 'vertical-rl' }}
      >
        {handleLabel}
      </button>

      {/* Backdrop */}
      {isOpen ? (
        <div
          className="fixed inset-0 z-[140] bg-black/60 backdrop-blur-sm transition-opacity"
          onClick={onClose}
          aria-hidden="true"
        />
      ) : null}

      {/* Drawer */}
      <aside
        className={[
          "fixed right-0 top-0 z-[160] h-full",
          widthClass,
          "transform border-l border-zinc-800 bg-[#0a0a0a] shadow-2xl transition-transform duration-300 ease-out flex flex-col",
          isOpen ? "translate-x-0" : "translate-x-full",
        ].join(" ")}
      >
        <div className="flex items-center justify-between border-b border-white/10 px-6 py-4 bg-[#121212]">
          <div className="text-sm font-black uppercase tracking-widest text-zinc-100">{handleLabel}</div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg bg-white/5 hover:bg-white/10 px-3 py-1.5 text-[10px] uppercase uv-btn-text-amber transition-colors"
          >
            Close
          </button>
        </div>

        <div className="flex-1 min-h-0 overflow-y-auto custom-scrollbar relative pb-6">
          {children}
        </div>
      </aside>
    </>
  );
}
