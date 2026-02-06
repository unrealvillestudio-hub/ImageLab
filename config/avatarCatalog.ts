
export type BasePortraitStyleId = string;
export type ContextStyleId = string;
export type RoleId = string;

export interface CatalogItem {
  id: string;
  label: string;
  rules: string;
  presets?: CatalogItem[];
}

export interface StylePackItem {
  id: string;
  label: string;
  rules: string;
  allowed_base: string[];
  allowed_context: string[];
}

export const AVATAR_CATALOG = {
  basePortraitStyles: [
    { id: "studio_minimal_neutral", label: "Studio Minimal (neutral)", rules: "Clean studio portrait, neutral seamless, soft even key light, minimal distractions." },
    { id: "corporate_headshot", label: "Corporate Headshot", rules: "Premium corporate headshot, controlled softbox lighting, shallow depth, high-end retouch, natural skin texture." },
    { id: "editorial_fashion", label: "Editorial Fashion", rules: "Editorial fashion portrait, crisp styling, magazine-grade lighting, confident pose, premium grading." },
    { id: "documentary", label: "Documentary", rules: "Documentary portrait, natural imperfections, truthful lighting, minimal stylization." },
    { id: "magazine_cover", label: "Magazine Cover", rules: "Magazine cover portrait framing, high-end editorial light, clean composition (NO text overlays)." },
    { id: "cinematic_film_still", label: "Cinematic (film still)", rules: "Cinematic film-still portrait, dramatic but realistic lighting, subtle filmic contrast, shallow depth." },
    { id: "lifestyle_natural_light", label: "Lifestyle Natural Light", rules: "Lifestyle portrait, natural window light, candid realism, warm authentic tones." },
  ],

  contextStyles: [
    {
      id: "studio",
      label: "Studio",
      rules: "Studio environment.",
      presets: [
        { id: "seamless_white", label: "Seamless white", rules: "Neutral white seamless background, soft shadow under subject, studio lighting." },
        { id: "seamless_gray", label: "Seamless gray", rules: "Neutral gray seamless, soft gradation, controlled studio light." },
        { id: "soft_gradient_neutral", label: "Soft gradient neutral", rules: "Subtle neutral gradient backdrop, premium studio feel." },
        { id: "dramatic_low_key_setup", label: "Low-key dramatic setup", rules: "Low-key studio portrait, controlled shadows, rim light." },
      ],
    },
    {
      id: "office",
      label: "Office",
      rules: "Professional office environment.",
      presets: [
        { id: "executive_boardroom", label: "Executive boardroom", rules: "Executive boardroom, premium wood, glass, subtle bokeh." },
        { id: "modern_office_lobby", label: "Modern office lobby", rules: "Corporate lobby, clean marble, premium minimalism, soft daylight." },
        { id: "creative_agency_loft", label: "Creative agency loft", rules: "Loft office, brick/concrete, creative vibe, soft key light." },
        { id: "minimal_tech_desk", label: "Minimal tech desk", rules: "Modern tech workspace, clean desk, monitors in background blur." },
      ],
    },
    {
      id: "podcast",
      label: "Podcast & Media",
      rules: "Media production environment.",
      presets: [
        { id: "podcast_studio_minimal", label: "Podcast studio (minimal)", rules: "Podcast studio, microphone visible near subject, acoustic panels, clean lighting." },
        { id: "radio_booth_warm", label: "Radio booth (warm)", rules: "Radio booth interior, acoustic foam, warm practical lights, intimate vibe." },
        { id: "youtube_set_rgb", label: "YouTube Set (Soft RGB)", rules: "Creator studio, shelf with props in background, subtle LED accent lights (teal/orange)." },
      ],
    },
    {
      id: "architecture",
      label: "Architecture / Outdoor",
      rules: "Architectural environment.",
      presets: [
        { id: "modern_villa_exterior_blur", label: "Modern villa exterior (blur)", rules: "Modern villa exterior, clean lines, subject in foreground, background slightly blurred." },
        { id: "downtown_street_blur", label: "Downtown street (blur)", rules: "Downtown city street, depth of field, urban texture, soft daylight." },
        { id: "suburbs_home_driveway", label: "Suburbs home driveway", rules: "Suburban house frontage, calm street, natural light, upscale neighborhood." },
        { id: "pueblo_plaza_day", label: "Pueblo plaza (day)", rules: "Old town plaza, stone textures, warm mediterranean light, architectural arches." },
      ],
    },
    {
        id: "indoor_home",
        label: "Indoor (Home)",
        rules: "Home lifestyle environment.",
        presets: [
            { id: "luxury_living_room", label: "Luxury Living Room", rules: "High-end living room, soft textures, warm lighting, architectural digest style." },
            { id: "modern_kitchen_island", label: "Modern Kitchen Island", rules: "Clean modern kitchen, marble island, bright morning light." },
            { id: "bathroom_vanity_no_mirror", label: "Bathroom Vanity (No Mirror)", rules: "Luxury bathroom vanity, marble, skincare products (blurred), NO MIRRORS in frame." }
        ]
    }
  ],

  roles: [
    { id: "none_everyday", label: "None / Everyday", rules: "Everyday person, natural wardrobe, authentic vibe." },
    { id: "ceo", label: "CEO / Executive", rules: "Executive wardrobe, confident posture, premium presence.", presets: [
      { id: "formal_suit", label: "Formal suit", rules: "Tailored suit, clean grooming, premium confidence." },
      { id: "smart_casual_exec", label: "Smart casual exec", rules: "Blazer + minimal top, modern executive style." },
    ]},
    { id: "podcast_host", label: "Podcast Host", rules: "Podcast host vibe, microphone present, confident, engaging expression.", presets: [
        { id: "podcast_pro", label: "Podcast pro (mic-ready)", rules: "Professional casual, headphones optional, leaning forward slightly." }
    ]},
    { id: "marketing_director", label: "Marketing Director", rules: "Creative professional look, stylish but approachable.", presets: [
        { id: "smart_casual", label: "Smart casual", rules: "Trendy blazer, solid colors, clean look." }
    ]},
    { id: "customer_support_lead", label: "Customer Support Lead", rules: "Friendly, headset optional, warm smile, service-oriented attire." },
    { id: "doctor_clinician", label: "Doctor / Clinician", rules: "Clinical professional look, clean environment cues.", presets: [
        { id: "white_coat", label: "White coat", rules: "White coat, stethoscope optional, clean clinical cues." },
        { id: "scrubs", label: "Scrubs", rules: "Medical scrubs, calm professional presence." }
    ]}
  ],

  stylePacks: [
      { 
          id: "corp_clean", 
          label: "Corp Clean", 
          rules: "Corporate aesthetic, cool color temperature, high contrast, sharp focus, trust-building tone.",
          allowed_base: ["corporate_headshot", "studio_minimal_neutral"],
          allowed_context: ["office", "studio"]
      },
      { 
          id: "podcast_modern", 
          label: "Podcast Modern", 
          rules: "New media aesthetic, warm practical lights, vibrant but matte grading, depth of field.",
          allowed_base: ["documentary", "lifestyle_natural_light"],
          allowed_context: ["podcast"]
      },
      { 
          id: "editorial_mag", 
          label: "Editorial Mag", 
          rules: "High-fashion editorial grading, film grain subtle, rich blacks, artistic composition.",
          allowed_base: ["magazine_cover", "editorial_fashion"],
          allowed_context: ["architecture", "studio"]
      },
      {
          id: "warm_lifestyle",
          label: "Warm Lifestyle",
          rules: "Golden hour tones, soft contrast, authentic skin tones, cozy atmosphere.",
          allowed_base: ["lifestyle_natural_light", "documentary"],
          allowed_context: ["indoor_home", "architecture"]
      }
  ] as StylePackItem[]
};
