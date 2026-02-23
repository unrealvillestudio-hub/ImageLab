
import React, { useState, useRef, useEffect } from 'react';

interface RunControlButtonProps {
    label?: string;
    runningLabel?: string;
    onRun: (signal: AbortSignal) => Promise<void>;
    onRunningChange?: (isRunning: boolean) => void;
    disabled?: boolean;
    className?: string; // Optional override for base styles
}

export function RunControlButton({ 
    label = "Generate", 
    runningLabel = "Stop", 
    onRun, 
    onRunningChange, 
    disabled,
    className
}: RunControlButtonProps) {
    const [running, setRunning] = useState(false);
    const abortControllerRef = useRef<AbortController | null>(null);

    // Sync internal state with parent if needed
    useEffect(() => {
        onRunningChange?.(running);
    }, [running, onRunningChange]);

    // Cleanup on unmount
    useEffect(() => {
        return () => {
            if (running && abortControllerRef.current) {
                abortControllerRef.current.abort();
            }
        };
    }, []);

    const handleClick = async () => {
        // --- STOP LOGIC ---
        if (running) {
            abortControllerRef.current?.abort();
            setRunning(false);
            // We do NOT set running to false here explicitly if we want to rely on the finally block, 
            // but for "Instant UI feedback", we force it.
            // The promise catch block will handle the AbortError silently.
            return;
        }

        // --- START LOGIC ---
        const controller = new AbortController();
        abortControllerRef.current = controller;
        setRunning(true);

        try {
            await onRun(controller.signal);
        } catch (error: any) {
            // IGNORE AbortError (User stopped it)
            if (error.name === 'AbortError' || error.message?.includes('aborted')) {
                console.log('Operation stopped by user.');
            } else {
                // Show real errors
                alert("Error during generation: " + (error.message || "Unknown error"));
            }
        } finally {
            // Only turn off running if we haven't started a NEW run immediately (edge case)
            // or if the current controller matches.
            if (abortControllerRef.current === controller) {
                setRunning(false);
            }
        }
    };

    const baseClasses = "group relative px-20 py-4 rounded-full font-black uppercase tracking-[0.2em] text-xs shadow-2xl transition-all disabled:opacity-50 disabled:grayscale";
    const generateClasses = "topaz-gradient text-black hover:scale-[1.02] active:scale-[0.98]";
    const stopClasses = "bg-red-500 text-white hover:bg-red-600 animate-pulse";

    return (
        <button 
            onClick={handleClick} 
            disabled={disabled && !running} // Can always click STOP even if "disabled" was true before start
            className={`${baseClasses} ${running ? stopClasses : generateClasses} ${className || ""}`}
        >
            {running ? runningLabel : label}
        </button>
    );
}
