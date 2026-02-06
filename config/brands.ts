import { BrandProfile } from "../types";

export const BRANDS: BrandProfile[] = [
  {
    id: "new",
    displayName: "--- NEW (Clear Context) ---",
    industry: "general",
    requiresProductLock: false,
    visualIdentity: "Clear, neutral, clinical photography, high-end commercial quality.",
    complianceRules: "No text, no logos.",
    defaultNegativePrompt: "text, logos, watermarks, blurry, low resolution, artifacts"
  },
  {
    id: "D7Herbal",
    displayName: "D7Herbal",
    industry: "cosmetics_haircare",
    requiresProductLock: true,
    visualIdentity:
      "Botanical premium, clean bathroom, soft light, editorial realism, minimal props, negative space for overlays.",
    complianceRules: "Cosmetic claims only. Avoid absolute outcomes. Focus on routine.",
    defaultNegativePrompt: "readable text, logo, watermark, packaging, bottles, low resolution",
  },
  {
    id: "VivoseMask",
    displayName: "Vivosé Mask",
    industry: "beauty_skincare",
    requiresProductLock: true,
    visualIdentity:
      "Modern spa aesthetic, silk textures, soft pink and white tones, luxurious hydration vibe, close-up macro details.",
    complianceRules: "Focus on skin glow and wellness.",
    defaultNegativePrompt: "extra fingers, text, watermark, messy background",
  },
  {
    id: "DiamondDetails",
    displayName: "Diamond Details",
    industry: "automotive_detailing",
    requiresProductLock: true,
    visualIdentity:
      "High-tech garage, neon rim lights, carbon fiber accents, wet floor reflections, aggressive contrast, professional detailing bay.",
    complianceRules: "Show technical precision.",
    defaultNegativePrompt: "dirty cars, rust, text, low lighting",
  },
  {
    id: "VizosCosmetics",
    displayName: "Vizos Cosmetics",
    industry: "high-end_beauty",
    requiresProductLock: true,
    visualIdentity:
      "Editorial runway style, bold dramatic shadows, obsidian surfaces, high fashion lighting, ultra-sharp focus on texture.",
    complianceRules: "Premium luxury standards.",
    defaultNegativePrompt: "cheap props, plastic, text",
  },
  {
    id: "PatriciaOsorioPersonal",
    displayName: "Patricia Osorio (Marca Personal)",
    industry: "personal_branding",
    requiresProductLock: false,
    visualIdentity:
      "Authentic lifestyle, bright airy offices, neutral minimalist interiors, natural soft sunlight, authoritative yet warm.",
    complianceRules: "Keep it natural and professional.",
    defaultNegativePrompt: "fake smiles, dark shadows, messy clutter",
  },
  {
    id: "PatriciaOsorioComunidad",
    displayName: "Patricia Osorio Conectando (Comunidad)",
    industry: "community_networking",
    requiresProductLock: false,
    visualIdentity:
      "Vibrant social settings, coworking spaces, networking events context, dynamic energy, warm community feel.",
    complianceRules: "Focus on connection and energy.",
    defaultNegativePrompt: "loneliness, cold colors, boring scenes",
  },
  {
    id: "PatriciaOsorioVizosSalon",
    displayName: "PatriciaOsorio (Vizos Salón - Miami)",
    industry: "luxury_salon",
    requiresProductLock: false,
    visualIdentity:
      "Miami luxury vibe, Art Deco accents, gold and white marble, tropical sunlight through palms, high-end salon equipment.",
    complianceRules: "Miami premium aesthetic.",
    defaultNegativePrompt: "cold weather, dark rooms, cheap furniture",
  }
];