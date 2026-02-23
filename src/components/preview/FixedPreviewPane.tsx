
import React from "react";
import { HistoryDrawer, HistoryItem } from "./HistoryDrawer";
import { StandardPreviewPane } from "./StandardPreviewPane";

export function FixedPreviewPane(props: {
  title: string;
  selected?: {
    id: string;
    imageUrl: string;
    label?: string;
    metadata?: any;
  };
  historyItems: HistoryItem[];
  onSelectFromHistory: (id: string) => void;
  onDownload: () => void;
  onAddToLibrary: () => void;
  onClearHistory?: () => void;
  className?: string;
}) {
  const { title, selected, historyItems, onSelectFromHistory, onDownload, onAddToLibrary, onClearHistory, className } = props;
  const [openHistory, setOpenHistory] = React.useState(false);

  return (
    <div className={`relative h-full flex flex-col ${className}`}>
        {/* We use the StandardPreviewPane for the visuals */}
        <StandardPreviewPane 
            title={title}
            selected={selected}
            onDownload={onDownload}
            onAddToLibrary={onAddToLibrary}
            hint="Generate something or select from History."
        />

        {/* Floating History Button on top of StandardPreviewPane header area */}
        <div className="absolute top-3 right-3">
            <button
            className="rounded-lg border border-white/10 bg-zinc-900/80 px-3 py-1.5 text-[10px] font-black uppercase tracking-widest text-zinc-300 hover:bg-white/10 transition-colors backdrop-blur-sm flex items-center gap-2"
            onClick={() => setOpenHistory(true)}
            >
            <span>History</span>
            <span className="bg-black/50 px-1.5 py-0.5 rounded text-white/50">{historyItems.length}</span>
            </button>
        </div>

      <HistoryDrawer
        isOpen={openHistory}
        onClose={() => setOpenHistory(false)}
        items={historyItems}
        onSelect={onSelectFromHistory}
        onClear={onClearHistory}
      />
    </div>
  );
}
