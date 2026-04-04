/**
 * psychoPresetLoader.ts — ImageLab
 * Carga los 10 presets de psycho_presets desde Supabase.
 * Coloca este archivo en: src/services/psychoPresetLoader.ts
 */

const SUPABASE_URL  = (import.meta as any).env?.VITE_SUPABASE_URL  ?? '';
const SUPABASE_KEY  = (import.meta as any).env?.VITE_SUPABASE_ANON_KEY ?? '';

const SB_HEADERS = {
  'apikey':        SUPABASE_KEY,
  'Authorization': `Bearer ${SUPABASE_KEY}`,
};

export interface PsychoPreset {
  id:               string;
  name:             string;
  objective_tag:    string;
  description:      string | null;
  injection_visual: string | null;
  injection_copy:   string | null;
  active:           boolean;
}

export async function loadPsychoPresets(): Promise<PsychoPreset[]> {
  if (!SUPABASE_URL) return [];
  try {
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/psycho_presets?active=eq.true&order=name.asc` +
      `&select=id,name,objective_tag,description,injection_visual,injection_copy`,
      { headers: SB_HEADERS }
    );
    if (!res.ok) return [];
    return await res.json();
  } catch {
    return [];
  }
}

/**
 * Builds the psycho injection string to append to the image generation prompt.
 * Returns empty string if no preset selected.
 */
export function buildPsychoVisualInjection(preset: PsychoPreset | null): string {
  if (!preset?.injection_visual) return '';
  return `\n\nPSYCHO LAYER [${preset.id}]: ${preset.injection_visual}`;
}
