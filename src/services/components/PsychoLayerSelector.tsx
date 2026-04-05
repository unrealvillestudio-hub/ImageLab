/**
 * PsychoLayerSelector.tsx — ImageLab
 *
 * Selector de Psycho Layer para la UI de generación de ImageLab.
 *
 * DÓNDE USARLO:
 * En el panel de generación (probablemente GenerationPanel.tsx o similar),
 * añade este componente junto al selector de pack/canal.
 *
 * CÓMO INTEGRAR:
 *
 *   import PsychoLayerSelector from './PsychoLayerSelector';
 *   import { buildPsychoVisualInjection } from '../services/psychoPresetLoader';
 *
 *   // En el state del componente padre:
 *   const [psychoPreset, setPsychoPreset] = useState<PsychoPreset | null>(null);
 *
 *   // Al construir el prompt de generación, append:
 *   const finalPrompt = basePrompt + buildPsychoVisualInjection(psychoPreset);
 *
 *   // En el JSX:
 *   <PsychoLayerSelector
 *     selected={psychoPreset}
 *     onSelect={setPsychoPreset}
 *   />
 *
 * Coloca este archivo en: src/components/PsychoLayerSelector.tsx
 */

import React, { useState, useEffect } from 'react';
import { loadPsychoPresets, PsychoPreset } from '../psychoPresetLoader';

interface Props {
  selected: PsychoPreset | null;
  onSelect: (preset: PsychoPreset | null) => void;
}

const OBJECTIVE_LABELS: Record<string, string> = {
  urgency:      'Urgencia',
  scarcity:     'Escasez',
  authority:    'Autoridad',
  belonging:    'Pertenencia',
  fomo:         'FOMO',
  trust:        'Confianza',
  identity:     'Identidad',
  aspiration:   'Aspiración',
  curiosity:    'Curiosidad',
  social_proof: 'Prueba Social',
};

const OBJECTIVE_COLORS: Record<string, string> = {
  urgency:      '#E84040',
  scarcity:     '#D97020',
  authority:    '#2878D8',
  belonging:    '#10B060',
  fomo:         '#C8980C',
  trust:        '#00B4AD',
  identity:     '#7855CC',
  aspiration:   '#EC4899',
  curiosity:    '#F59E0B',
  social_proof: '#6366F1',
};

export default function PsychoLayerSelector({ selected, onSelect }: Props) {
  const [presets, setPresets] = useState<PsychoPreset[]>([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    loadPsychoPresets().then(data => {
      setPresets(data);
      setLoading(false);
    });
  }, []);

  const handleSelect = (preset: PsychoPreset) => {
    if (selected?.id === preset.id) {
      onSelect(null); // deselect
    } else {
      onSelect(preset);
    }
    setOpen(false);
  };

  const color = selected ? (OBJECTIVE_COLORS[selected.objective_tag] ?? '#7855CC') : '#4A5E70';

  return (
    <div style={{ position: 'relative' }}>
      {/* Trigger button */}
      <button
        onClick={() => setOpen(v => !v)}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          padding: '6px 12px',
          borderRadius: 6,
          border: `1px solid ${selected ? color : '#1E2A3A'}`,
          background: selected ? `${color}12` : '#0B0E13',
          color: selected ? color : '#4A5E70',
          fontSize: 11,
          fontFamily: 'Syne Mono, monospace',
          letterSpacing: '0.08em',
          textTransform: 'uppercase',
          cursor: 'pointer',
          transition: 'all 0.15s',
          whiteSpace: 'nowrap',
        }}
      >
        <span style={{
          width: 8, height: 8, borderRadius: '50%',
          background: selected ? color : '#1E2A3A',
          display: 'inline-block',
          flexShrink: 0,
        }} />
        {selected
          ? `PSY · ${OBJECTIVE_LABELS[selected.objective_tag] ?? selected.name}`
          : 'Psycho Layer — ninguno'}
        <span style={{ marginLeft: 4, opacity: 0.5 }}>▾</span>
      </button>

      {/* Dropdown */}
      {open && !loading && (
        <div style={{
          position: 'absolute',
          top: '100%',
          left: 0,
          zIndex: 100,
          marginTop: 4,
          background: '#0B0E13',
          border: '1px solid #1E2A3A',
          borderRadius: 8,
          overflow: 'hidden',
          minWidth: 280,
          boxShadow: '0 8px 24px rgba(0,0,0,0.4)',
        }}>
          {/* None option */}
          <button
            onClick={() => { onSelect(null); setOpen(false); }}
            style={{
              display: 'flex', alignItems: 'center', gap: 8,
              width: '100%', padding: '10px 14px',
              background: !selected ? 'rgba(255,255,255,0.04)' : 'transparent',
              color: '#4A5E70', fontSize: 11,
              fontFamily: 'Syne Mono, monospace',
              letterSpacing: '0.06em', textTransform: 'uppercase',
              border: 'none', borderBottom: '1px solid #1E2A3A',
              cursor: 'pointer', textAlign: 'left',
            }}
          >
            <span style={{ width: 8, height: 8, borderRadius: '50%', background: '#1E2A3A', display: 'inline-block' }} />
            Sin Psycho Layer
          </button>

          {/* Preset options */}
          {presets.map(preset => {
            const pColor = OBJECTIVE_COLORS[preset.objective_tag] ?? '#7855CC';
            const isSelected = selected?.id === preset.id;
            return (
              <button
                key={preset.id}
                onClick={() => handleSelect(preset)}
                style={{
                  display: 'flex', alignItems: 'flex-start', gap: 10,
                  width: '100%', padding: '10px 14px',
                  background: isSelected ? `${pColor}12` : 'transparent',
                  border: 'none', borderBottom: '1px solid #182030',
                  cursor: 'pointer', textAlign: 'left',
                  transition: 'background 0.1s',
                }}
                onMouseEnter={e => { if (!isSelected) (e.currentTarget as HTMLElement).style.background = 'rgba(255,255,255,0.03)'; }}
                onMouseLeave={e => { if (!isSelected) (e.currentTarget as HTMLElement).style.background = 'transparent'; }}
              >
                <span style={{
                  width: 8, height: 8, borderRadius: '50%',
                  background: pColor, display: 'inline-block',
                  marginTop: 3, flexShrink: 0,
                }} />
                <div>
                  <div style={{
                    fontSize: 11, fontFamily: 'Syne Mono, monospace',
                    letterSpacing: '0.06em', textTransform: 'uppercase',
                    color: isSelected ? pColor : '#CDD5E0',
                    marginBottom: 2,
                  }}>
                    {preset.id} · {OBJECTIVE_LABELS[preset.objective_tag] ?? preset.name}
                  </div>
                  {preset.description && (
                    <div style={{ fontSize: 10.5, color: '#4A5E70', lineHeight: 1.5 }}>
                      {preset.description}
                    </div>
                  )}
                </div>
              </button>
            );
          })}
        </div>
      )}

      {/* Click outside to close */}
      {open && (
        <div
          onClick={() => setOpen(false)}
          style={{ position: 'fixed', inset: 0, zIndex: 99 }}
        />
      )}
    </div>
  );
}
