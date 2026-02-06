
import React, { useState, useRef, useEffect } from 'react';
import JSZip from 'jszip';
import {
  ProductImage,
  GenerationHistory,
  AspectRatio,
  PROMPT_CATEGORIES,
  PackControls,
  PackType,
  GeneratedAsset,
  BrandProfile,
} from './types';
import { generateProductBackground, generateLandingPack } from './services/gemini';
import { BRANDS } from './config/brands';
import { getPack } from './config/packs';
import { buildAssetPrompt, buildSystemInstruction } from './utils/prompt';
import { cropAndConvertToWebP } from './utils/image';
import { parsePackRequest, ParsedPackRequest } from './utils/packRequest';

// Icons
const UploadIcon = () => (
  <svg className="w-8 h-8 text-zinc-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
  </svg>
);

const MagicIcon = () => (
  <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
  </svg>
);

const DownloadIcon = () => (
  <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
  </svg>
);

const FormatIcon = () => (
  <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 5a1 1 0 011-1h14a1 1 0 011 1v14a1 1 0 01-1 1H5a1 1 0 01-1-1V5z" />
  </svg>
);

const ShotBuilderIcon = () => (
  <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
  </svg>
);

const TrashIcon = () => (
  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
  </svg>
);

const LayersIcon = () => (
  <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
  </svg>
);

const SaveIcon = () => (
  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 5a2 2 0 012-2h10a2 2 0 012 2v16l-7-3.5L5 21V5z" />
  </svg>
);

const BookIcon = () => (
  <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" />
  </svg>
);

const KeyIcon = () => (
  <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 7a2 2 0 012 2m4 0a6 6 0 01-7.743 5.743L11 17H9v2H7v2H4a1 1 0 01-1-1v-2.586a1 1 0 01.293-.707l5.964-5.964A6 6 0 1121 9z" />
  </svg>
);

// Removed redundant and conflicting global declaration of aistudio.
// The execution context already defines window.aistudio with the required hasSelectedApiKey and openSelectKey methods.

export default function App() {
  const [mode, setMode] = useState<'shot' | 'pack'>('shot');
  const [selectedBrandId, setSelectedBrandId] = useState<string>('D7Herbal');
  const [selectedPackType, setSelectedPackType] = useState<PackType>('landing_v1');
  const [importedBrands, setImportedBrands] = useState<BrandProfile[]>([]);
  const [packRequestJson, setPackRequestJson] = useState<string>('');
  const [packRequestMeta, setPackRequestMeta] = useState<ParsedPackRequest | null>(null);
  const [shotOverrides, setShotOverrides] = useState<Record<string, string>>({});
  const [requestGlobalNotes, setRequestGlobalNotes] = useState<string>('');
  const [packControls, setPackControls] = useState<PackControls>({
    realismLevel: 'editorial_clean',
    skinDetail: 'realistic',
    imperfections: 'subtle',
    humidityLevel: 1,
    sweatLevel: 0,
    filmLook: 'digital_clean',
    grainLevel: 1,
    lensPreset: '50mm_lifestyle',
    depthOfField: 'medium',
    framing: 'negative_space_right',
  });
  const [packResults, setPackResults] = useState<GeneratedAsset[]>([]);
  const [packProgress, setPackProgress] = useState<{ completed: number; total: number; currentAssetId: string } | null>(null);
  const [sourceImage, setSourceImage] = useState<ProductImage | null>(null);
  
  // Fixed line 110: correctly initialized referenceImages state with a type parameter and initial value.
  const [referenceImages, setReferenceImages] = useState<ProductImage[]>([]);

  return (
    <div className="min-h-screen bg-zinc-950 p-8 text-center flex flex-col items-center justify-center">
      <h1 className="text-3xl font-bold mb-6">ImageLab Backup Component</h1>
      <p className="max-w-md text-zinc-400">
        This component is intended as a reference or fallback. Please use the main App.tsx for full features.
      </p>
    </div>
  );
}
