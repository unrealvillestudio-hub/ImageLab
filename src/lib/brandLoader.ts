/**
 * brandLoader.ts — ImageLab
 * Carga BrandProfile[] desde Supabase con fallback al array estático.
 * Las marcas se leen de la tabla `brands` usando los campos imagelab_*.
 */

import { sbSelect } from './supabaseClient';
import type { BrandProfile } from '../core/types';
import { BRANDS_FALLBACK } from '../config/brands';

/** Fila de Supabase que nos interesa */
interface BrandRow {
  id: string;
  display_name: string;
  imagelab_industry: string | null;
  imagelab_requires_product_lock: boolean | null;
  imagelab_visual_identity: string | null;
  imagelab_compliance_rules: string | null;
  default_negative_prompt: string | null;
  status: string | null;
}

/** Transforma una fila de Supabase al tipo BrandProfile de ImageLab */
function rowToBrandProfile(row: BrandRow): BrandProfile {
  return {
    id:                   row.id,
    displayName:          row.display_name,
    industry:             row.imagelab_industry  ?? 'general',
    requiresProductLock:  row.imagelab_requires_product_lock ?? false,
    visualIdentity:       row.imagelab_visual_identity  ?? 'Clean, neutral, commercial quality.',
    complianceRules:      row.imagelab_compliance_rules ?? 'No text, no logos.',
    defaultNegativePrompt: row.default_negative_prompt  ?? 'text, logos, watermarks, blurry, low resolution',
  };
}

/** Cache en memoria para la sesión */
let _cache: BrandProfile[] | null = null;

/**
 * Carga todas las marcas activas desde Supabase.
 * Si Supabase no está disponible, devuelve el fallback estático.
 * El resultado se cachea en memoria durante la sesión.
 */
export async function fetchBrandProfiles(): Promise<BrandProfile[]> {
  if (_cache) return _cache;

  try {
    const rows = await sbSelect<BrandRow>(
      'brands',
      'id,display_name,imagelab_industry,imagelab_requires_product_lock,imagelab_visual_identity,imagelab_compliance_rules,default_negative_prompt,status',
      {
        status:  'eq.active',
        order:   'display_name.asc',
      }
    );

    if (!rows || rows.length === 0) {
      console.warn('[brandLoader] Supabase returned 0 brands — using fallback');
      return BRANDS_FALLBACK;
    }

    // Añadir la entrada especial "NEW (Clear Context)" al inicio
    const brands: BrandProfile[] = [
      {
        id: 'new',
        displayName: '--- NEW (Clear Context) ---',
        industry: 'general',
        requiresProductLock: false,
        visualIdentity: 'Clear, neutral, clinical photography, high-end commercial quality.',
        complianceRules: 'No text, no logos.',
        defaultNegativePrompt: 'text, logos, watermarks, blurry, low resolution, artifacts',
      },
      ...rows.map(rowToBrandProfile),
    ];

    _cache = brands;
    return brands;

  } catch (err) {
    console.error('[brandLoader] Supabase fetch failed — using fallback:', err);
    return BRANDS_FALLBACK;
  }
}

/** Fuerza recarga en la próxima llamada (útil si el usuario añade una marca) */
export function invalidateBrandCache() {
  _cache = null;
}
