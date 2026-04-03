/**
 * brandsContext.tsx — ImageLab
 * Carga BrandProfile[] desde Supabase UNA sola vez al iniciar la app.
 * Todos los módulos que necesiten las marcas consumen este contexto
 * en lugar de importar el array estático BRANDS.
 * 
 * Uso en cualquier módulo:
 *   const { brands, loading } = useBrandsContext();
 */

import React, { createContext, useContext, useState, useEffect } from 'react';
import type { BrandProfile } from '../core/types';
import { fetchBrandProfiles } from './brandLoader';
import { BRANDS_FALLBACK } from '../config/brands';

interface BrandsContextValue {
  brands:  BrandProfile[];
  loading: boolean;
  error:   string | null;
}

const BrandsContext = createContext<BrandsContextValue>({
  brands:  BRANDS_FALLBACK,
  loading: false,
  error:   null,
});

export function BrandsProvider({ children }: { children: React.ReactNode }) {
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
          console.error('[BrandsProvider] Failed to load brands from Supabase:', err);
          setError('Using local brand data.');
          setLoading(false);
          // BRANDS_FALLBACK ya está como valor inicial — no hacer nada más
        }
      });
    return () => { cancelled = true; };
  }, []);

  return (
    <BrandsContext.Provider value={{ brands, loading, error }}>
      {children}
    </BrandsContext.Provider>
  );
}

/** Hook para consumir las marcas desde cualquier módulo */
export function useBrandsContext(): BrandsContextValue {
  return useContext(BrandsContext);
}
