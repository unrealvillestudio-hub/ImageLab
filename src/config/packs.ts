import { PackSpec, ASPECT_RATIOS } from "../core/types.ts";

export const PACKS: PackSpec[] = [
  {
    id: "landing_conv",
    label: "Landing Conversions",
    packType: "landing_conv",
    assets: [
      {
        assetId: "hero_conv",
        assetType: "Hero Conversion",
        width: 1920,
        height: 1080,
        genAspectRatio: ASPECT_RATIOS.WIDE,
        shotDescription: "Clean premium background with 40% negative space on the right for headlines. High-end lighting on a professional surface.",
        compositeProduct: true,
        productPlacement: { anchor: "center_left", marginPct: 0.1, shadow: { opacity: 0.3, blur: 20 } }
      }
    ],
  },
  {
    id: "landing_conv_aggr",
    label: "Landing Conversions (Aggressive)",
    packType: "landing_conv_aggr",
    assets: [
      {
        assetId: "hero_aggr",
        assetType: "Aggressive Hero",
        width: 1920,
        height: 1080,
        genAspectRatio: ASPECT_RATIOS.WIDE,
        shotDescription: "Extreme cinematic lighting, dramatic shadows, obsidian or dark marble surface. Huge negative space. Aggressive depth of field.",
        compositeProduct: true,
        productPlacement: { 
          anchor: "center_left", 
          scale: 1.15, 
          shadow: { opacity: 0.6, blur: 30, offsetY: 15 },
          ambientOcclusion: { enabled: true, opacity: 0.7, blur: 4 }
        }
      }
    ],
  },
  {
    id: "web_inst",
    label: "Web (Institutional)",
    packType: "web_inst",
    assets: [
      {
        assetId: "web_hero_inst",
        assetType: "Institutional Banner",
        width: 1920,
        height: 800,
        genAspectRatio: ASPECT_RATIOS.WIDE,
        shotDescription: "Trustworthy corporate background, minimalist modern office, very soft bright lighting. Balanced and clean.",
        compositeProduct: true,
        productPlacement: { anchor: "center_right", marginPct: 0.1, scale: 0.85 }
      }
    ],
  },
  {
    id: "ecom_standard",
    label: "E-Commerce",
    packType: "ecom_standard",
    assets: [
      {
        assetId: "ecom_main",
        assetType: "Standard Catalog Shot",
        width: 1200,
        height: 1200,
        genAspectRatio: ASPECT_RATIOS.SQUARE,
        shotDescription: "Pure studio high-key background with subtle floor gradient. Perfectly even lighting. Minimalist premium surface.",
        compositeProduct: true,
        productPlacement: { anchor: "center", scale: 1.25, shadow: { opacity: 0.2, blur: 15 } }
      }
    ],
  },
  {
    id: "ig_organic_pack",
    label: "Instagram Organic",
    packType: "ig_org",
    assets: [
      {
        assetId: "ig_feed_sq",
        assetType: "Feed Post (1:1)",
        width: 1080,
        height: 1080,
        genAspectRatio: ASPECT_RATIOS.SQUARE,
        shotDescription: "Aesthetic lifestyle flat lay or tabletop. Natural soft sunlight, trendy interior elements in bokeh. Feels authentic and non-commercial.",
        compositeProduct: true,
        productPlacement: { anchor: "center", scale: 1.1, shadow: { opacity: 0.35, blur: 12 } }
      },
      {
        assetId: "ig_reels_bg",
        assetType: "Reels Background (9:16)",
        width: 1080,
        height: 1920,
        genAspectRatio: ASPECT_RATIOS.STORY,
        shotDescription: "Dynamic lifestyle scene, vertical composition. Ample negative space in the bottom 30% for Reel metadata/captions. Saturated and vibrant.",
        compositeProduct: true,
        productPlacement: { anchor: "center", scale: 1.2, offsetY: -150 }
      }
    ],
  },
  {
    id: "yt_pack",
    label: "YouTube",
    packType: "yt_org",
    assets: [
      {
        assetId: "yt_thumb_hero",
        assetType: "High-Impact Thumbnail",
        width: 1280,
        height: 720,
        genAspectRatio: ASPECT_RATIOS.WIDE,
        shotDescription: "Vibrant high-contrast background. One side (left or right) is extremely clean to allow for massive bold text. Expressive lighting.",
        compositeProduct: true,
        productPlacement: { anchor: "center_right", marginPct: 0.05, scale: 1.4, rotationDeg: 5 }
      }
    ],
  }
];

export function getPack(packType: string): PackSpec | undefined {
  return PACKS.find(p => p.packType === packType);
}