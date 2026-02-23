
import { AspectRatio, SceneNegativeSpace } from "../core/types.ts";

export interface EcomPreset {
    id: string;
    label: string;
    params: {
        scale: number;
        shadowOpacity: number;
        shadowBlur: number;
        offsetY: number;
        aoEnabled: boolean;
    };
}

export interface AvatarPreset {
    id: string;
    label: string;
    baseStyle: string;
    context: string;
    role: string;
    ar: AspectRatio;
    strictIdentity: boolean;
}

export interface ScenePreset {
    id: string;
    label: string;
    archetype: string;
    ar: AspectRatio;
    ns: SceneNegativeSpace;
    variants: number;
}

export const ECOM_PRESETS: EcomPreset[] = [
    { 
        id: 'standard_studio', 
        label: 'Standard Studio', 
        params: { scale: 1.0, shadowOpacity: 0.4, shadowBlur: 15, offsetY: 0, aoEnabled: true } 
    },
    { 
        id: 'floating_hero', 
        label: 'Floating Hero', 
        params: { scale: 1.1, shadowOpacity: 0.25, shadowBlur: 30, offsetY: -20, aoEnabled: false } 
    },
    { 
        id: 'grounded_hard', 
        label: 'Grounded (Hard Light)', 
        params: { scale: 1.0, shadowOpacity: 0.6, shadowBlur: 5, offsetY: 10, aoEnabled: true } 
    },
    { 
        id: 'macro_detail', 
        label: 'Macro Detail', 
        params: { scale: 1.5, shadowOpacity: 0.3, shadowBlur: 20, offsetY: 0, aoEnabled: true } 
    },
    {
        id: 'lifestyle_blend',
        label: 'Lifestyle Blend',
        params: { scale: 0.9, shadowOpacity: 0.35, shadowBlur: 10, offsetY: 5, aoEnabled: true }
    },
    {
        id: 'packshot_clean',
        label: 'Packshot Clean',
        params: { scale: 1.05, shadowOpacity: 0.15, shadowBlur: 8, offsetY: 0, aoEnabled: false }
    },
    {
        id: 'dramatic_low',
        label: 'Dramatic Low',
        params: { scale: 1.0, shadowOpacity: 0.8, shadowBlur: 25, offsetY: 0, aoEnabled: true } 
    },
    {
        id: 'flatlay_top',
        label: 'Flatlay Top-Down',
        params: { scale: 0.85, shadowOpacity: 0.5, shadowBlur: 12, offsetY: 0, aoEnabled: true } 
    }
];

export const AVATAR_PRESETS: AvatarPreset[] = [
    { id: 'linkedin_pro', label: 'LinkedIn Pro', baseStyle: 'corporate_headshot', context: 'office', role: 'none_everyday', ar: '3:4', strictIdentity: true },
    { id: 'fashion_editorial', label: 'Fashion Editorial', baseStyle: 'editorial_fashion', context: 'studio', role: 'marketing_director', ar: '3:4', strictIdentity: false },
    { id: 'podcast_host', label: 'Podcast Host', baseStyle: 'lifestyle_natural_light', context: 'podcast', role: 'podcast_host', ar: '16:9', strictIdentity: true },
    { id: 'tech_ceo', label: 'Tech CEO', baseStyle: 'studio_minimal_neutral', context: 'office', role: 'ceo', ar: '3:4', strictIdentity: true },
    { id: 'creative_director', label: 'Creative Director', baseStyle: 'magazine_cover', context: 'studio', role: 'marketing_director', ar: '3:4', strictIdentity: false },
    { id: 'doctor_clinic', label: 'Doctor / Clinic', baseStyle: 'corporate_headshot', context: 'office', role: 'doctor_clinician', ar: '3:4', strictIdentity: true },
    { id: 'social_story', label: 'Social Story Real', baseStyle: 'lifestyle_natural_light', context: 'indoor_home', role: 'none_everyday', ar: '9:16', strictIdentity: true },
    { id: 'cinematic_hero', label: 'Cinematic Hero', baseStyle: 'cinematic_film_still', context: 'architecture', role: 'none_everyday', ar: '16:9', strictIdentity: false },
    { id: 'customer_support', label: 'Customer Support', baseStyle: 'studio_minimal_neutral', context: 'studio', role: 'customer_support_lead', ar: '1:1', strictIdentity: true },
    { id: 'docu_style', label: 'Documentary Style', baseStyle: 'documentary', context: 'architecture', role: 'none_everyday', ar: '3:2', strictIdentity: true },
    { id: 'beauty_campaign', label: 'Beauty Campaign', baseStyle: 'editorial_fashion', context: 'studio', role: 'none_everyday', ar: '4:5', strictIdentity: true },
    { id: 'remote_worker', label: 'Remote Worker', baseStyle: 'lifestyle_natural_light', context: 'indoor_home', role: 'none_everyday', ar: '4:3', strictIdentity: true }
];

export const SCENE_PRESETS: ScenePreset[] = [
    { id: 'story_minimal', label: 'Story Minimal', ar: '9:16', ns: 'center', archetype: 'studio_minimal', variants: 3 },
    { id: 'web_hero', label: 'Web Hero Wide', ar: '16:9', ns: 'right_third', archetype: 'office_modern', variants: 3 },
    { id: 'square_social', label: 'Social Square', ar: '1:1', ns: 'center', archetype: 'lifestyle_natural_light', variants: 4 },
    { id: 'luxury_bath', label: 'Luxury Bathroom', ar: '4:5', ns: 'center', archetype: 'bathroom_premium', variants: 3 },
    { id: 'tech_desk', label: 'Tech Desk Setup', ar: '16:9', ns: 'center', archetype: 'office_modern', variants: 3 },
    { id: 'organic_podium', label: 'Organic Podium', ar: '4:5', ns: 'center', archetype: 'spa_wellness', variants: 3 },
    { id: 'urban_street', label: 'Urban Street', ar: '9:16', ns: 'bottom_third', archetype: 'rooftop_terrace', variants: 3 },
    { id: 'kitchen_counter', label: 'Kitchen Counter', ar: '1:1', ns: 'center', archetype: 'kitchen_editorial', variants: 3 },
    { id: 'boutique_shelf', label: 'Boutique Shelf', ar: '4:5', ns: 'center', archetype: 'boutique_retail', variants: 3 },
    { id: 'industrial_loft', label: 'Industrial Loft', ar: '16:9', ns: 'left_third', archetype: 'warehouse_industrial', variants: 3 },
    { id: 'zen_garden', label: 'Zen Garden', ar: '1:1', ns: 'center', archetype: 'zen_garden', variants: 3 },
    { id: 'auto_detail', label: 'Auto Detailing', ar: '16:9', ns: 'center', archetype: 'detail_shop', variants: 3 }
];
