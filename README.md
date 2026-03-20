# ImageLab — Unreal>ille Studio

Generador de prompt packs para imagen AI del ecosistema Unreal>ille Studio.
Produce prompts estructurados para generación de escenas, avatares y assets de producto.

**Deploy:** Google AI Studio
**Contexto completo del ecosistema:** [`CoreProject/CONTEXT.md`](https://github.com/unrealvillestudio-hub/CoreProject/blob/main/CONTEXT.md)

---

## Rol en el ecosistema

ImageLab transforma BPs (personas, locaciones, productos) en prompts de imagen listos para ejecutar en modelos generativos. Es el punto de entrada visual del ecosistema.

```
BluePrints (BP_PERSON + BP_LOCATION + BP_PRODUCT)
    ↓
ImageLab (genera prompt packs)
    ↓
Modelos de imagen (Midjourney, Flux, SDXL, etc.)
```

**Limitación confirmada:** Consistencia facial multi-persona simultánea requiere ComfyUI + InstantID. No solucionable en AI Studio.

---

## Stack

- React 18 + TypeScript + Vite + Tailwind
- AI: Gemini 2.0 Flash (Gemini API)
- Deploy: Google AI Studio

---

## Dependencias

| Consume | Provee |
|---------|--------|
| BP_PERSON (voz visual, rasgos) | Prompt packs de escena |
| BP_LOCATION (atributos visuales) | Prompts de avatar |
| BP_PRODUCT (packaging, colores) | Prompts de producto |

---

## Changelog

| Fecha | Cambio |
|---|---|
| 2026-03-20 | README actualizado con arquitectura de ecosistema |

---

## Desarrollo local

```bash
npm install
cp .env.example .env.local  # añade GEMINI_API_KEY
npm run dev
```
