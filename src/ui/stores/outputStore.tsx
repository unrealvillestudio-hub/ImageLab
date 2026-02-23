
import React, { createContext, useContext, useState, useCallback, ReactNode } from 'react';
// Fix: Corrected relative import for DebugMetadata from core types
import { DebugMetadata } from '../../core/types.ts';

export interface OutputItem {
    id: string;
    title: string;
    dataUrl: string;
    metadata?: DebugMetadata;
    timestamp: number;
    module: 'tools' | 'promptpack' | 'customize';
}

interface OutputContextType {
    outputs: OutputItem[];
    addOutputs: (items: Omit<OutputItem, 'timestamp'>[]) => void;
    removeOutput: (id: string) => void;
    clearOutputs: () => void;
}

const OutputContext = createContext<OutputContextType | undefined>(undefined);

export const OutputProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
    const [outputs, setOutputs] = useState<OutputItem[]>([]);

    const addOutputs = useCallback((newItems: Omit<OutputItem, 'timestamp'>[]) => {
        const timestamp = Date.now();
        const itemsWithTime = newItems.map(i => ({ ...i, timestamp }));
        setOutputs(prev => {
            const next = [...itemsWithTime, ...prev];
            return next.slice(0, 30); 
        });
    }, []);

    const removeOutput = useCallback((id: string) => {
        setOutputs(prev => prev.filter(i => i.id !== id));
    }, []);

    const clearOutputs = useCallback(() => {
        setOutputs([]);
    }, []);

    return (
        <OutputContext.Provider value={{ outputs, addOutputs, removeOutput, clearOutputs }}>
            {children}
        </OutputContext.Provider>
    );
};

export function useOutputStore() {
    const context = useContext(OutputContext);
    if (!context) throw new Error("useOutputStore must be used within OutputProvider");
    return context;
}
