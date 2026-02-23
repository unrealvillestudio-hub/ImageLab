import React from 'react';
import { useLibraryStore } from '../../ui/stores/libraryStore.tsx';
import { AssetThumb } from './AssetThumb.tsx';
import { UploadDropzone } from './UploadDropzone.tsx';
import { UploadInbox } from './UploadInbox.tsx';
import { LibraryAsset } from '../../core/types.ts';
import { ModuleTips } from '../../ui/ModuleTips.tsx';

interface LibraryDockProps {
    activeSlots: {
        sourceA: string | null;
        sourceB: string | null;
        sourceC: string | null;
        ref1: string | null;
        ref2: string | null;
        ref3: string | null;
    };
    onAssignSlot: (slotKey: 'sourceA' | 'sourceB' | 'sourceC' | 'ref1' | 'ref2' | 'ref3', assetId: string) => void;
    onPreview: (asset: LibraryAsset) => void;
    onCommit?: () => void;
}

export function LibraryDock({ activeSlots, onAssignSlot, onPreview, onCommit }: LibraryDockProps) {
    const { assets, updateAssetKind, removeAsset } = useLibraryStore();

    const generalAssets = assets.filter(a => a.kind !== 'person');
    const peopleAssets = assets.filter(a => a.kind === 'person');

    return (
        <div className="h-full flex flex-col">
            <div className="p-4 pb-2 shrink-0 z-20 bg-[#0a0a0a]">
                <ModuleTips moduleId="library" />
                <UploadDropzone />
            </div>

            <UploadInbox onCommit={onCommit} />

            <div className="flex-1 min-h-0 p-4 space-y-6">
                <div className="space-y-3">
                    <div className="flex items-center justify-between px-1 sticky top-0 bg-[#0a0a0a] z-10 py-2 border-b border-white/5">
                        <h3 className="text-xs font-black uppercase tracking-widest text-[#FFAB00]">
                            Assets <span className="text-white/30 ml-1">({generalAssets.length})</span>
                        </h3>
                    </div>
                    
                    <div className="grid grid-cols-2 gap-3 pb-2">
                        {generalAssets.map(item => (
                            <AssetThumb
                                key={item.id}
                                asset={item}
                                activeSlots={activeSlots}
                                onAssignSlot={onAssignSlot}
                                onUpdateKind={updateAssetKind}
                                onRemove={removeAsset}
                                onPreview={onPreview}
                            />
                        ))}
                        {generalAssets.length === 0 && (
                            <div className="col-span-2 text-center py-8 text-white/10 text-[9px] uppercase tracking-widest italic border border-dashed border-white/5 rounded-xl">
                                Library Empty
                            </div>
                        )}
                    </div>
                </div>

                <div className="space-y-3">
                    <div className="flex items-center justify-between px-1 sticky top-0 bg-[#0a0a0a] z-10 py-2 border-b border-white/5">
                        <h3 className="text-xs font-black uppercase tracking-widest text-purple-400">
                            People <span className="text-white/30 ml-1">({peopleAssets.length})</span>
                        </h3>
                    </div>

                    <div className="grid grid-cols-2 gap-3 pb-2">
                        {peopleAssets.map(item => (
                            <AssetThumb
                                key={item.id}
                                asset={item}
                                activeSlots={activeSlots}
                                onAssignSlot={onAssignSlot}
                                onUpdateKind={updateAssetKind}
                                onRemove={removeAsset}
                                onPreview={onPreview}
                            />
                        ))}
                        {peopleAssets.length === 0 && (
                            <div className="col-span-2 text-center py-8 text-white/10 text-[9px] uppercase tracking-widest italic border border-dashed border-white/5 rounded-xl">
                                No People
                            </div>
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
}