export interface AIStudio {
  hasSelectedApiKey: () => Promise<boolean>;
  openSelectKey: () => Promise<void>;
}

declare global {
  interface Window {
    aistudio: AIStudio;
  }
}

export type TabId = "promptpack" | "tools" | "customize";
export type ToolId = "scene" | "avatar" | "product" | "videopodcast";
export type LibraryAssetKind = "product" | "reference" | "other" | "person" | "background" | "unknown";
export type PersonType = "real" | "synthetic";
export type AspectRatio = "1:1" | "16:9" | "9:16" | "4:3" | "3:4" | "2:3" | "3:2" | "4:5" | "5:4" | "21:9";
export type ImageSize = "1k" | "2k" | "4k";
export type SceneNegativeSpace = "left_third" | "right_third" | "top_third" | "bottom_third" | "center";
export type CreativityLevel = 1 | 2 | 3;
export type VarietyStrength = "low" | "medium" | "high";
export type FitMode = "contain" | "cover" | "stretch";
export type RemoveBgMethod = "auto" | "white" | "black" | "custom";
export type SceneArchetypeId = string;

export type RoutingMode = "PIXEL_LOCK_OVERLAY" | "AI_FUSION" | "SCENE_GEN" | "AVATAR_RENDER";
export type OverlayPolicy = "PIXEL_LOCK" | "ALLOW" | "WARN_ONLY";
export type PreflightStatus = "OK" | "BLOCKED" | "NOT_READY";

export interface BrandProfile {
  id: string;
  displayName: string;
  industry: string;
  requiresProductLock: boolean;
  visualIdentity: string;
  complianceRules: string;
  defaultNegativePrompt?: string;
}

export interface PackControls {
  realismLevel: "editorial_clean" | "cinematic" | "documentary";
  skinDetail: "subtle" | "realistic" | "high_microdetail";
  imperfections: "none" | "subtle" | "realistic";
  humidityLevel: number;
  sweatLevel: number;
  filmLook: "digital_clean" | "35mm_film" | "cinematic_soft";
  grainLevel: number;
  lensPreset: string;
  depthOfField: "deep" | "medium" | "shallow";
  framing: "centered" | "rule_of_thirds" | "negative_space_left" | "negative_space_right";
}

export interface AssetSpec {
  assetId: string;
  assetType: string;
  width: number;
  height: number;
  genAspectRatio: AspectRatio;
  shotDescription: string;
  compositeProduct: boolean;
  productPlacement: ProductPlacement;
  negativePrompt?: string;
}

export interface PackSpec {
  id: string;
  label: string;
  packType: string;
  assets: AssetSpec[];
}

export interface PackRequestV1 {
  schema_version: number;
  brand_id: string;
  pack_type: string;
  brand_profile: {
    industry: string;
    requires_product_lock: boolean;
    visual_identity: string;
    compliance_rules: string;
  };
  controls: {
    realism_level: any;
    skin_detail: any;
    imperfections: any;
    humidity_level: number;
    sweat_level: number;
    film_look: any;
    grain_level: number;
    lens_preset: string;
    depth_of_field: any;
    framing: any;
  };
  shot_overrides?: Record<string, string>;
  global_notes?: string;
}

export type PackType = string;

export type SubjectType = "person" | "product" | "vehicle" | "object";

export interface SubjectAsset {
  id: string;
  brandId: string;
  subjectType: SubjectType;
  displayName: string;
  dataUrl: string;
  mimeType: string;
  angle?: string;
  tags: string[];
  createdAt?: number;
  updatedAt?: number;
}

export interface ProductBlueprint {
  productId: string;
  brandId: string;
  label: string;
  transparencySensitive?: boolean;
  defaultCompositeParams: any;
  sourceAssets: Record<string, string>;
  scenarios: Array<{
    id: string;
    label: string;
    scenePrompt: string;
    recommendedNegativeSpace: SceneNegativeSpace;
    compositeOverrides?: any;
  }>;
}

export interface GeneratedAsset {
  id: string;
  label: string;
  dataUrl: string;
  metadata?: any;
}

export interface ValidationError {
    code: string;
    message: string;
    severity: "BLOCK" | "WARN";
    path?: string;
    canFix?: boolean;
}

export interface PromptPackValidationResult {
    isValid: boolean;
    isBlocked: boolean;
    errors: ValidationError[];
    canSwapSlots: boolean;
    status: PreflightStatus;
}

export interface ReferenceImage {
  dataUrl: string;
  label?: string;
}

export interface LibraryAsset {
  id: string;
  kind: LibraryAssetKind;
  label: string;
  dataUrl: string;
  type?: PersonType;
  alphaDetected?: boolean; 
  createdAt: number;
  dimensions?: { w: number; h: number };
  placementHint?: PlacementHint;
}

export interface ProductPlacement {
  anchor: string;
  marginPct?: number;
  maxHeightPct?: number;
  maxWidthPct?: number;
  scale?: number;
  rotationDeg?: number;
  offsetX?: number;
  offsetY?: number;
  shadow?: {
    color?: string;
    opacity?: number;
    blur?: number;
    offsetX?: number;
    offsetY?: number;
  };
  ambientOcclusion?: {
    enabled: boolean;
    opacity?: number;
    blur?: number;
    offsetY?: number;
  };
  colorMatch?: { enabled: boolean; strength?: number; samplePadPx?: number };
  lightWrap?: { enabled: boolean; strength?: number; blurPx?: number };
  transparencySensitive?: boolean; 
}

export interface ModelStage {
  enabled: boolean | null;
  prompt_built: boolean | null;
  images_sent: string[];
}

export interface PlacementHint {
  preset: string;
  anchor: string;
  scale: number;
  offsetX: number;
  offsetY: number;
  safeBox: { x: number; y: number; w: number; h: number };
}

export interface UsageDetail {
  detected: boolean;
  used_in_prompt: boolean | null;
  overlayed: boolean;
  reason: string;
}

export interface RefUsageDetail {
  detected: boolean;
  count: number;
  used_in_prompt: boolean | null;
  reason: string;
}

export interface UsageStats {
  subject_a: UsageDetail;
  subject_b: UsageDetail;
  subject_c: UsageDetail;
  refs: RefUsageDetail;
}

export interface DebugMetadata {
  timestamp: string;
  module: string;
  model: string;
  routing: string;
  slots: {
    subject_a: any;
    subject_b: any;
    subject_c?: any;
    ref1?: any;
    ref2?: any;
    ref3?: any;
  };
  policy_applied: Record<string, string>;
  policy_applied_original?: Record<string, string>;
  params: any;
  model_stage: ModelStage;
  placement_hint?: PlacementHint;
  usage: UsageStats;
  hud_lines: string[];
  variant_index?: number;
  variants_total?: number;
  warnings: string[];
  variants_source?: string;
  placement_source?: string;
  customize_audit?: any;
}

export interface PromptPackV1 {
  schema_version: string;
  pack_id: string;
  variants?: number; 
  scene_spec?: {
      negative_space?: {
          placement_request?: {
              anchor: string; 
              priority?: "high" | "medium" | "low";
          }
      }
  };
  defaults?: {
    aspect_ratio?: AspectRatio;
    size?: string;
    negative_space?: SceneNegativeSpace;
    creativity_level?: number;
    variety_strength?: string;
    notes?: string;
    style_notes?: string;
    compliance_rules?: string;
  };
  inputs?: {
    source_asset?: { dataUrl: string; label: string };
    reference_images?: { dataUrl: string; label: string }[];
  };
  jobs: {
      id?: string;
      label?: string;
      prompt?: string;
      aspect_ratio?: string;
      size?: string;
      outputs?: number; 
      slot_policies?: {
          subject_a?: "PIXEL_LOCK" | "IDENTITY_LOCK" | "STYLE_ONLY";
          background?: "BG_LAYOUT";
      };
      routing?: RoutingMode; 
  }[]; 
}

export interface PromptPackRunResult {
  run_id: string;
  pack_id: string;
  items: Array<{
    id: string;
    label: string;
    imageDataUrl: string;
    job_id: string;
    variant_index: number;
  }>;
}

export interface CustomizeAudit {
  timestamp: string;
  module: string;
  brand_id: string;
  pack_id: string;
  pack_name: string;
  pack_outputs_total: number;
  asset_id_result?: string;
  source_slots: {
    subject_a: {
      asset_id: string;
      label: string;
      kind: LibraryAssetKind;
      alpha_detected: boolean;
    } | null;
    subject_b: {
      asset_id: string;
      label: string;
      kind: LibraryAssetKind;
      alpha_detected: boolean;
    };
  };
  render_policy: {
    deterministic: boolean;
    model_stage_enabled: boolean;
    overlay_used: boolean;
    overlay_reason: string;
  };
  output_spec: {
    output_id: string;
    label: string;
    aspect_ratio: string;
    px: { w: number; h: number };
    safe_zone: any;
  };
  params_applied: any;
  warnings: string[];
}

export const ASPECT_RATIOS = {
  SQUARE: "1:1" as AspectRatio,
  WIDE: "16:9" as AspectRatio,
  STORY: "9:16" as AspectRatio,
  PORTRAIT: "3:4" as AspectRatio,
  WEB_CLASSIC: "4:3" as AspectRatio,
};

export const VARIANT_OPTIONS = [1, 3, 6] as const;