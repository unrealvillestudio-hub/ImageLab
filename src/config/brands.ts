/**
 * brands.ts — ImageLab
 * 
 * BRANDS_FALLBACK: array estático usado cuando Supabase no está disponible.
 * Las marcas en producción se cargan desde Supabase via brandLoader.ts.
 * 
 * Para añadir una marca nueva:
 *   1. Añadirla en Supabase con los campos imagelab_* correctos.
 *   2. Añadirla aquí como fallback para desarrollo offline.
 * 
 * Fuente de verdad: Supabase tabla `brands`.
 */

import { BrandProfile } from "../core/types";

export const BRANDS_FALLBACK: BrandProfile[] = [
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
    id: "NeuroneSCF",
    displayName: "Neurone South & Central Florida",
    industry: "cosmetics_haircare",
    requiresProductLock: true,
    visualIdentity:
      "Professional hair care Miami. Patricia Osorio as authority figure. Salon context, tropical light, warm golden tones. Product shots require alpha channel. Reference photos available.",
    complianceRules:
      "Cosmetic claims only. No medical claims. FDA/FTC compliant. Focus on aesthetic and sensorial benefits. No before/after without disclaimer.",
    defaultNegativePrompt:
      "text, logos, watermark, medical imagery, clinical setting, extra fingers, low resolution, artifacts",
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
    complianceRules: "Show technical precision. No license plates visible.",
    defaultNegativePrompt: "dirty cars, rust, text, low lighting, license plates",
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
    displayName: "Patricia Osorio (Vizos Salón - Miami)",
    industry: "luxury_salon",
    requiresProductLock: false,
    visualIdentity:
      "Miami luxury vibe, Art Deco accents, gold and white marble, tropical sunlight through palms, high-end salon equipment.",
    complianceRules: "Miami premium aesthetic.",
    defaultNegativePrompt: "cold weather, dark rooms, cheap furniture",
  }
];

/**
 * @deprecated Usar fetchBrandProfiles() de brandLoader.ts en su lugar.
 * Este export se mantiene solo por compatibilidad con código que aún no migró.
 */
export const BRANDS = BRANDS_FALLBACK;
