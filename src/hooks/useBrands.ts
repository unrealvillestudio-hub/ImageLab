/**
 * useBrands.ts — ImageLab
 * Hook para cargar BrandProfile[] desde Supabase de forma async.
 * Maneja loading, error y fallback automáticamente.
 * 
 * Uso:
 *   const { brands, loading, error } = useBrands();
 */

import { useState, useEffect } from 'react';
import type { BrandProfile } from '../core/types';
import { fetchBrandProfiles } from '../lib/brandLoader';
import { BRANDS_FALLBACK } from '../config/brands';

interface UseBrandsResult {
  brands:  BrandProfile[];
  loading: boolean;
  error:   string | null;
}

export function useBrands(): UseBrandsResult {
  const [brands,  setBrands]  = useState<BrandProfile[]>(BRANDS_FALLBACK);
  const [loading, setLoading] = useState(true);
  const [error,   setError]   = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    fetchBrandProfiles()
      .then((result) => {
        if (!cancelled) {
          setBrands(result);
          setLoading(false);
        }
      })
      .catch((err) => {
        if (!cancelled) {
          console.error('[useBrands] Failed to load brands:', err);
          setError('No se pudieron cargar las marcas desde Supabase. Usando datos locales.');
          setLoading(false);
          // brands ya tiene BRANDS_FALLBACK como valor inicial — no hay que hacer nada más
        }
      });

    return () => { cancelled = true; };
  }, []);

  return { brands, loading, error };
}
