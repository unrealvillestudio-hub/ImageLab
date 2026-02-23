
import { AspectRatio } from "../../core/types.ts";

export interface CustomizePackItem {
    id: string;
    label: string;
    width: number;
    height: number;
    aspectRatioLabel: AspectRatio;
    overlayRequired: boolean;
}

export interface CustomizePack {
    id: string;
    label: string;
    items: CustomizePackItem[];
}

export const CUSTOMIZE_PACKS: CustomizePack[] = [
    {
        id: "ig_organic_pack",
        label: "Instagram Organic",
        items: [
            { id: "feed_post_1_1", label: "Feed Post", width: 1080, height: 1080, aspectRatioLabel: "1:1", overlayRequired: true },
            { id: "reels_bg_9_16", label: "Reels Background", width: 1080, height: 1920, aspectRatioLabel: "9:16", overlayRequired: false }
        ]
    },
    {
        id: "web_hero_pack",
        label: "Web Hero Headers",
        items: [
            { id: "hero_desktop", label: "Desktop Hero", width: 1920, height: 600, aspectRatioLabel: "21:9", overlayRequired: true },
            { id: "hero_mobile", label: "Mobile Hero", width: 800, height: 1000, aspectRatioLabel: "4:5", overlayRequired: true }
        ]
    },
    {
        id: "ecom_catalog_pack",
        label: "E-Commerce Catalog",
        items: [
            { id: "catalog_square", label: "Main Square", width: 2048, height: 2048, aspectRatioLabel: "1:1", overlayRequired: true },
            { id: "catalog_portrait", label: "Listing Vertical", width: 1000, height: 1500, aspectRatioLabel: "2:3", overlayRequired: true }
        ]
    }
];
