
export type ModuleTipId = "promptpack" | "scene_gen" | "ecomm_studio" | "avatar_gen" | "videopodcast_gen" | "customize" | "library";

export interface ModuleTipData {
    title: string;
    bullets: string[];
    bestWorkflow: string;
    avoid: string;
}

export const MODULE_TIPS: Record<ModuleTipId, ModuleTipData> = {
    promptpack: {
        title: "Goal: Generate packs from JSON",
        bullets: [
            "Paste a valid JSON spec → Preflight must PASS.",
            "Use Creativity 1/2/3 to control variation.",
            "Assets/People toggles only attach images to the model (optional)."
        ],
        bestWorkflow: "Generate 3–6 scenes here, then compose in Tools → E-Comm Studio.",
        avoid: "Don’t expect pixel-perfect product compositing here—use E-Comm Studio for overlay."
    },
    scene_gen: {
        title: "Goal: Create backgrounds with negative space",
        bullets: [
            "Generate scenes WITHOUT product.",
            "Aim for clean negative space where the product will be placed.",
            "Use Session History to compare variants quickly."
        ],
        bestWorkflow: "Scene Gen → pick best scenes → E-Comm Studio overlay.",
        avoid: "Avoid generating bottles/labels when compositing later."
    },
    ecomm_studio: {
        title: "Goal: Deterministic product overlay (ICR)",
        bullets: [
            "Use your PNG/WebP with alpha as Subject A (product).",
            "Pick a background from Session History / Asset Library.",
            "Adjust scale/offset/shadow/AO—product stays intact."
        ],
        bestWorkflow: "Choose 3 candidate scenes → run 3 variants → send winners to Asset Library.",
        avoid: "Don’t send product images to the model when PIXEL_LOCK overlay is ON."
    },
    avatar_gen: {
        title: "Goal: Generate people assets (brand avatars)",
        bullets: [
            "Use consistent refs for identity when needed.",
            "Generate clean cutouts (transparent background preferred)."
        ],
        bestWorkflow: "Create 3–5 avatars → keep best in People Library → use as refs later.",
        avoid: "Avoid mixing identity refs if Strict Identity is ON."
    },
    videopodcast_gen: {
        title: "Goal: Generate high-end podcast scenes",
        bullets: [
            "Select an archetype (Studio, Car, Street, etc.).",
            "Pick a brand to load authorized personas and locations.",
            "Select multiple angles to generate a complete set of scenes."
        ],
        bestWorkflow: "Setup step 1 → Select personas and location step 2 → Generate batch step 3.",
        avoid: "Don't skip angle selection—at least one is required for generation."
    },
    customize: {
        title: "Goal: Fine-tune composition parameters",
        bullets: [
            "Use this to adjust scale/offset/shadow/AO safely.",
            "Reset clears active slots, not your libraries."
        ],
        bestWorkflow: "Compose in E-Comm → tweak in Customize → export to Library.",
        avoid: "Don’t use Customize to replace missing assets—upload to library instead."
    },
    library: {
        title: "Goal: Reuse generated assets fast",
        bullets: [
            "Session History = temporary (FIFO 30).",
            "Asset Library = permanent."
        ],
        bestWorkflow: "Generate → shortlist in Session History → promote to Asset Library.",
        avoid: "Don’t rely on Session History for long-term storage."
    }
};
