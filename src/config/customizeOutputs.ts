import { AspectRatio } from "../core/types.ts";

export interface OutputSpec {
    id: string;
    label: string;
    aspectRatio: AspectRatio | string; 
    requires: {
        backgroundB: boolean;
        productA: boolean;
    };
    exportTag: string;
    dimensions: { w: number; h: number }; 
}

export interface StrategyDef {
    id: StrategyId;
    label: string;
    outputs: OutputSpec[];
}

const DIM = {
    SQ: { w: 1080, h: 1080 },
    PORT: { w: 1080, h: 1350 }, 
    STORY: { w: 1080, h: 1920 }, 
    LAND: { w: 1920, h: 1080 }, 
    LINK: { w: 1200, h: 628 },  
    BANNER: { w: 1200, h: 400 }, 
    POSTER: { w: 1080, h: 1440 }, 
};

export const CUSTOMIZE_STRATEGIES: StrategyDef[] = [
    {
        id: "social",
        label: "Social Media",
        outputs: [
            { id: "ig_sq", label: "IG Feed Square (1:1)", aspectRatio: "1:1", requires: { backgroundB: true, productA: true }, exportTag: "IG_FEED_SQ", dimensions: DIM.SQ },
            { id: "tt_cover", label: "TikTok Cover (1:1)", aspectRatio: "1:1", requires: { backgroundB: true, productA: true }, exportTag: "TT_COVER_SQ", dimensions: DIM.SQ },
            { id: "ig_port", label: "IG Portrait (4:5)", aspectRatio: "4:5", requires: { backgroundB: true, productA: true }, exportTag: "IG_FEED_4x5", dimensions: DIM.PORT },
            { id: "ig_story", label: "IG Story / Reel (9:16)", aspectRatio: "9:16", requires: { backgroundB: true, productA: true }, exportTag: "IG_STORY", dimensions: DIM.STORY },
            { id: "tt_video", label: "TikTok Video (9:16)", aspectRatio: "9:16", requires: { backgroundB: true, productA: true }, exportTag: "TT_VIDEO_9x16", dimensions: DIM.STORY },
            { id: "tt_bg_noprod_9x16", label: "TikTok Background (No Prod) (9:16)", aspectRatio: "9:16", requires: { backgroundB: true, productA: false }, exportTag: "TT_BG_NOPROD_9x16", dimensions: DIM.STORY },
            { id: "reels_bg", label: "Reels Background (No Prod)", aspectRatio: "9:16", requires: { backgroundB: true, productA: false }, exportTag: "REELS_BG_CLEAN", dimensions: DIM.STORY },
            { id: "carousel", label: "Carousel Slide (4:5)", aspectRatio: "4:5", requires: { backgroundB: true, productA: true }, exportTag: "CAROUSEL_4x5", dimensions: DIM.PORT },
            { id: "pinterest", label: "Pinterest Pin (3:4)", aspectRatio: "3:4", requires: { backgroundB: true, productA: true }, exportTag: "PIN_3x4", dimensions: DIM.POSTER },
        ]
    },
    {
        id: "ecom",
        label: "E-Commerce / Web",
        outputs: [
            { id: "pdp_hero", label: "PDP Hero (1:1)", aspectRatio: "1:1", requires: { backgroundB: true, productA: true }, exportTag: "PDP_HERO", dimensions: DIM.SQ },
            { id: "pdp_vert", label: "PDP Vertical (4:5)", aspectRatio: "4:5", requires: { backgroundB: true, productA: true }, exportTag: "PDP_VERT", dimensions: DIM.PORT },
            { id: "web_hero", label: "Web Hero (16:9)", aspectRatio: "16:9", requires: { backgroundB: true, productA: true }, exportTag: "WEB_HERO", dimensions: DIM.LAND },
            { id: "coll_banner", label: "Collection Banner (3:1)", aspectRatio: "3:1", requires: { backgroundB: true, productA: false }, exportTag: "COLL_BANNER", dimensions: DIM.BANNER },
            { id: "email_header", label: "Email Header (3:1)", aspectRatio: "3:1", requires: { backgroundB: true, productA: true }, exportTag: "EMAIL_HEADER", dimensions: DIM.BANNER },
        ]
    },
    {
        id: "ads",
        label: "Ads (Performance)",
        outputs: [
            { id: "meta_feed", label: "Meta Feed (4:5)", aspectRatio: "4:5", requires: { backgroundB: true, productA: true }, exportTag: "META_FEED", dimensions: DIM.PORT },
            { id: "meta_story", label: "Meta Story (9:16)", aspectRatio: "9:16", requires: { backgroundB: true, productA: true }, exportTag: "META_STORY", dimensions: DIM.STORY },
            { id: "meta_link", label: "Meta Link (1.91:1)", aspectRatio: "1.91:1", requires: { backgroundB: true, productA: true }, exportTag: "META_LINK", dimensions: DIM.LINK },
            { id: "gdn_sq", label: "Google Display Sq (1:1)", aspectRatio: "1:1", requires: { backgroundB: true, productA: true }, exportTag: "GDN_SQ", dimensions: DIM.SQ },
            { id: "gdn_land", label: "Google Display Land (1.91:1)", aspectRatio: "1.91:1", requires: { backgroundB: true, productA: true }, exportTag: "GDN_LAND", dimensions: DIM.LINK },
        ]
    },
    {
        id: "creative",
        label: "Creatives / Exp",
        outputs: [
            { id: "poster_art", label: "Poster Art (3:4)", aspectRatio: "3:4", requires: { backgroundB: true, productA: true }, exportTag: "CREATIVE_POSTER", dimensions: DIM.POSTER },
            { id: "story_clean", label: "Story Background (Clean)", aspectRatio: "9:16", requires: { backgroundB: true, productA: false }, exportTag: "CREATIVE_BG_9x16", dimensions: DIM.STORY },
            { id: "wide_clean", label: "Cinematic Clean (16:9)", aspectRatio: "16:9", requires: { backgroundB: true, productA: false }, exportTag: "CREATIVE_BG_16x9", dimensions: DIM.LAND },
        ]
    }
];

export type StrategyId = "ecom" | "social" | "ads" | "creative";
export type IntentId = "organic" | "sales" | "branding" | "educational";

export const CUSTOMIZE_INTENTS: { id: IntentId; label: string }[] = [
    { id: "organic", label: "Organic / Lifestyle" },
    { id: "sales", label: "Sales / Conversion" },
    { id: "branding", label: "Branding / Awareness" },
    { id: "educational", label: "Educational / Info" },
];

export function getOutputSpec(strategyId: StrategyId, outputId: string): OutputSpec | undefined {
    const strat = CUSTOMIZE_STRATEGIES.find(s => s.id === strategyId);
    return strat?.outputs.find(o => o.id === outputId);
}
