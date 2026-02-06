import {
  BrandProfile,
  PackControls,
  PackRequestV1,
  PackType,
} from "../types";

export type ParsedPackRequest = {
  brandId: string;
  packType: PackType;
  brandProfile: BrandProfile;
  controls: PackControls;
  globalNotes?: string;
  shotOverrides: Record<string, string>;
  useCompositing?: boolean;
};

function assert(condition: any, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function isObject(v: any): v is Record<string, any> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

// Convert JSON snake_case controls to internal camelCase PackControls
function mapControls(controls: PackRequestV1["controls"]): PackControls {
  return {
    realismLevel: controls.realism_level,
    skinDetail: controls.skin_detail,
    imperfections: controls.imperfections,
    humidityLevel: controls.humidity_level,
    sweatLevel: controls.sweat_level,
    filmLook: controls.film_look,
    grainLevel: controls.grain_level,
    lensPreset: controls.lens_preset,
    depthOfField: controls.depth_of_field,
    framing: controls.framing,
  };
}

function mapBrandProfile(brandId: string, req: PackRequestV1): BrandProfile {
  return {
    id: brandId,
    displayName: brandId,
    industry: req.brand_profile.industry,
    requiresProductLock: req.brand_profile.requires_product_lock,
    visualIdentity: req.brand_profile.visual_identity,
    complianceRules: req.brand_profile.compliance_rules,
  };
}

export function parsePackRequest(json: string): ParsedPackRequest {
  let parsed: any;
  try {
    parsed = JSON.parse(json);
  } catch (e) {
    throw new Error("Invalid JSON. Please copy/paste the full JSON from UI_ONLY_v2.");
  }

  assert(isObject(parsed), "Invalid JSON: root must be an object.");
  assert(parsed.schema_version === 1, "Unsupported schema_version. Expected 1.");
  assert(typeof parsed.brand_id === "string" && parsed.brand_id.trim().length > 0, "brand_id is required.");
  assert(typeof parsed.pack_type === "string", "pack_type is required.");
  assert(isObject(parsed.brand_profile), "brand_profile is required and must be an object.");
  assert(isObject(parsed.controls), "controls is required and must be an object.");

  // Lightweight validation of required brand_profile fields
  const bp = parsed.brand_profile;
  const c = parsed.controls;
  assert(typeof bp.industry === "string", "brand_profile.industry is required.");
  assert(typeof bp.visual_identity === "string", "brand_profile.visual_identity is required.");
  assert(typeof bp.compliance_rules === "string", "brand_profile.compliance_rules is required.");
  assert(typeof bp.requires_product_lock === "boolean", "brand_profile.requires_product_lock must be boolean.");

  // Required controls
  const requiredControls = [
    "realism_level",
    "skin_detail",
    "imperfections",
    "humidity_level",
    "sweat_level",
    "film_look",
    "grain_level",
    "lens_preset",
    "depth_of_field",
    "framing",
  ];
  for (const k of requiredControls) {
    assert(k in c, `controls.${k} is required.`);
  }

  const brandId = parsed.brand_id.trim();
  const packType = parsed.pack_type as PackType;

  const req = parsed as PackRequestV1;
  const brandProfile = mapBrandProfile(brandId, req);
  const controls = mapControls(req.controls);

  const shotOverrides = isObject(req.shot_overrides) ? (req.shot_overrides as Record<string, string>) : {};

  return {
    brandId,
    packType,
    brandProfile,
    controls,
    globalNotes: typeof req.global_notes === "string" ? req.global_notes : undefined,
    shotOverrides,
    useCompositing: typeof (req as any).use_compositing === "boolean" ? (req as any).use_compositing : undefined,
  };
}
