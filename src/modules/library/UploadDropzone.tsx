import React, { useRef, useState } from 'react';
import { useLibraryStore } from '../../ui/stores/libraryStore.tsx';

export function UploadDropzone() {
    const { stageFiles } = useLibraryStore();
    const inputRef = useRef<HTMLInputElement>(null);
    const [isDragOver, setIsDragOver] = useState(false);

    const handleProcessFiles = async (fileList: FileList | null) => {
        if (!fileList || fileList.length === 0) return;
        const files = Array.from(fileList);
        await stageFiles(files);
    };

    const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        handleProcessFiles(e.target.files);
        if (inputRef.current) inputRef.current.value = '';
    };

    const handleDrop = (e: React.DragEvent) => {
        e.preventDefault();
        setIsDragOver(false);
        handleProcessFiles(e.dataTransfer.files);
    };

    return (
        <div 
            className={`relative group transition-all ${isDragOver ? 'scale-[1.02]' : ''}`}
            onDragOver={(e) => { e.preventDefault(); setIsDragOver(true); }}
            onDragLeave={() => setIsDragOver(false)}
            onDrop={handleDrop}
        >
            <input 
                ref={inputRef}
                type="file" 
                multiple 
                className="absolute inset-0 w-full h-full opacity-0 cursor-pointer z-10" 
                onChange={handleFileChange} 
            />
            <div className={`border border-dashed rounded-xl p-3 text-center transition-all flex flex-col items-center justify-center min-h-[80px] space-y-1
                ${isDragOver ? 'border-[#FFAB00] bg-[#FFAB00]/5' : 'border-white/10 bg-[#121212] group-hover:border-[#FFAB00]/40'}
            `}>
                <div className="flex flex-col items-center">
                    <div className="text-xl text-[#FFAB00] group-hover:scale-110 transition-transform">+</div>
                    <p className="text-[10px] font-black uppercase tracking-widest text-[#EBEBEB]">
                        UPLOAD FILES
                    </p>
                </div>
                
                <p className="text-[8px] text-white/40 font-medium leading-tight max-w-[200px]">
                    Drop <span className="text-white/60">BG / PROD / PERS</span> here.
                    <br/>
                    <span className="italic text-white/30">Auto-classify in Inbox.</span>
                </p>
            </div>
        </div>
    );
}