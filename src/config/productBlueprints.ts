// Fix: Relative import
import { ProductBlueprint } from "../core/types.ts";

/**
 * PRODUCT BLUEPRINTS
 * 
 * This file contains the "Industrial Accuracy" configurations for specific products.
 * Using a Blueprint ensures that:
 * 1. The product is never hallucinated or deformed (Product Lock).
 * 2. Shadows, reflection, and scaling are mathematically consistent.
 * 3. Scenarios are pre-prompted to match the product's lighting direction.
 */

export const D7_HERBAL_BLUEPRINT: ProductBlueprint = {
  productId: "d7_locion_capilar",
  brandId: "D7Herbal",
  label: "Loción Capilar D7 (150ml)",
  transparencySensitive: true, // IMPORTANT: Cap is clear plastic
  
  defaultCompositeParams: {
    scale: 1.2,
    offsetX: 0,
    offsetY: 150, // Anchored low to hit the "floor" in standard generations
    shadowOpacity: 0.5,
    shadowBlur: 20,
    aoOpacity: 0.7
  },

  sourceAssets: {
    cap_on: "assets/d7_cap_on.png", // Placeholder path
  },

  scenarios: [
    {
      id: "bathroom_sink_premium",
      label: "Lavabo Lujoso (Mañana)",
      scenePrompt: "Luxury marble bathroom sink counter, soft morning light coming from the left (matching product shot), blurred mirror in background, high key, spa atmosphere, white orchid reflection, 8k resolution, architectural digest style. Empty counter space in the center.",
      recommendedNegativeSpace: "center"
    },
    {
      id: "vanity_counter_minimal",
      label: "Tocador Minimal (Podium)",
      scenePrompt: "Minimalist white vanity counter, geometric shapes, soft shadows, podium style, high-end cosmetics photography, neutral beige and white tones, softbox lighting from left. Clean negative space.",
      recommendedNegativeSpace: "center",
      compositeOverrides: {
          scale: 1.1, // Slightly smaller for podium look
          offsetY: 120
      }
    },
    {
      id: "botanical_stone",
      label: "Piedra Natural (Zen)",
      scenePrompt: "Smooth river stone surface, blurred waterfall background, nature bokeh, soft sunlight filtering through leaves, zen garden aesthetic, spa wellness vibe. Surface in foreground.",
      recommendedNegativeSpace: "center",
      compositeOverrides: {
          shadow: {
              opacity: 0.7, // Harder shadow outdoors
              blur: 15
          }
      }
    }
  ]
};

export const PRODUCT_BLUEPRINTS: Record<string, ProductBlueprint> = {
  "d7_locion_capilar": D7_HERBAL_BLUEPRINT
};