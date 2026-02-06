import { SubjectAsset, SubjectType } from '../types';

// LocalStorage store for Subject Assets (people/product/vehicle/object)
// Versioned to allow future migrations.

const STORAGE_KEY = 'blackout_imagelab_subject_library_v1';

type StoreShape = {
  version: 1;
  assets: SubjectAsset[];
};

function emptyStore(): StoreShape {
  return { version: 1, assets: [] };
}

function loadStore(): StoreShape {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) return emptyStore();
  try {
    const parsed = JSON.parse(raw) as StoreShape;
    if (!parsed || parsed.version !== 1 || !Array.isArray(parsed.assets)) {
      return emptyStore();
    }
    // Basic normalization
    const assets = parsed.assets
      .filter((a: any) => a && typeof a.id === 'string' && typeof a.brandId === 'string' && typeof a.subjectType === 'string' && typeof a.dataUrl === 'string')
      .map((a: any) => ({
        id: String(a.id),
        brandId: String(a.brandId),
        subjectType: a.subjectType as SubjectType,
        displayName: typeof a.displayName === 'string' ? a.displayName : 'Untitled',
        dataUrl: String(a.dataUrl),
        mimeType: typeof a.mimeType === 'string' ? a.mimeType : 'image/png',
        angle: typeof a.angle === 'string' ? a.angle : undefined,
        tags: Array.isArray(a.tags) ? a.tags.map(String) : [],
        createdAt: typeof a.createdAt === 'number' ? a.createdAt : Date.now(),
        updatedAt: typeof a.updatedAt === 'number' ? a.updatedAt : Date.now(),
      })) as SubjectAsset[];

    return { version: 1, assets };
  } catch {
    return emptyStore();
  }
}

function saveStore(store: StoreShape): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(store));
}

export function listSubjectAssets(params?: { brandId?: string; subjectType?: SubjectType }): SubjectAsset[] {
  const store = loadStore();
  let assets = store.assets;
  if (params?.brandId) assets = assets.filter(a => a.brandId === params.brandId);
  if (params?.subjectType) assets = assets.filter(a => a.subjectType === params.subjectType);
  // newest first
  return assets.slice().sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0));
}

export function getSubjectAssetById(id: string): SubjectAsset | null {
  const store = loadStore();
  return store.assets.find(a => a.id === id) ?? null;
}

export function upsertSubjectAsset(asset: SubjectAsset): { ok: true } | { ok: false; error: string } {
  const store = loadStore();
  const idx = store.assets.findIndex(a => a.id === asset.id);
  const now = Date.now();
  const normalized: SubjectAsset = {
    ...asset,
    tags: Array.isArray(asset.tags) ? asset.tags : [],
    createdAt: asset.createdAt ?? now,
    updatedAt: now,
  };

  if (idx >= 0) {
    store.assets[idx] = normalized;
  } else {
    store.assets.unshift(normalized);
  }

  try {
    saveStore(store);
    return { ok: true };
  } catch (e: any) {
    return { ok: false, error: 'Subject Library storage limit reached. Convert/Resize to a smaller WebP and try again.' };
  }
}

export function deleteSubjectAsset(id: string): void {
  const store = loadStore();
  store.assets = store.assets.filter(a => a.id !== id);
  saveStore(store);
}

export function enforceMaxPerBrand(params: { brandId: string; subjectType: SubjectType; max: number }): { removed: number } {
  const store = loadStore();
  const { brandId, subjectType, max } = params;
  const matching = store.assets.filter(a => a.brandId === brandId && a.subjectType === subjectType);
  if (matching.length <= max) return { removed: 0 };

  // remove oldest
  const sortedOldestFirst = matching.slice().sort((a, b) => (a.updatedAt ?? 0) - (b.updatedAt ?? 0));
  const toRemove = sortedOldestFirst.slice(0, matching.length - max).map(a => a.id);
  store.assets = store.assets.filter(a => !toRemove.includes(a.id));
  saveStore(store);
  return { removed: toRemove.length };
}
