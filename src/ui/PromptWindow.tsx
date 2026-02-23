import React, { useState } from 'react';

interface PromptWindowProps {
    title?: string;
    value: string;
    onChange: (val: string) => void;
    placeholder?: string;
    rows?: number;
}

export function PromptWindow({ title = "PROMPT / NOTES", value, onChange, placeholder, rows = 6 }: PromptWindowProps) {
    const [copied, setCopied] = useState(false);

    const handleCopy = () => {
        navigator.clipboard.writeText(value);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
    };

    return (
        <div className="bg-[#181818] border border-white/10 rounded-xl overflow-hidden flex flex-col">
            <div className="flex items-center justify-between px-4 py-2 bg-white/5 border-b border-white/5">
                <span className="uv-title">{title}</span>
                <button 
                    onClick={handleCopy} 
                    disabled={!value}
                    className={`text-[9px] font-bold uppercase px-2 py-1 rounded transition-colors ${copied ? "text-emerald-400 bg-emerald-500/10" : "text-white/40 hover:text-white hover:bg-white/10"}`}
                >
                    {copied ? "COPIED!" : "COPY"}
                </button>
            </div>
            <textarea 
                value={value} 
                onChange={(e) => onChange(e.target.value)} 
                className="w-full bg-transparent p-4 text-xs font-mono text-[#EBEBEB] outline-none resize-y min-h-[120px] focus:bg-black/20 transition-colors placeholder:text-white/10"
                placeholder={placeholder || "Enter prompt details, negative prompts, or specific instructions here..."}
                rows={rows}
            />
        </div>
    );
}
