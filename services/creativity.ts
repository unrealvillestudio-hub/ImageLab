// services/creativity.ts
// Creativity suffix builder used by PromptPack tabs.

import type { CreativityLevel, CreativeBlocksSelection } from "../config/creativityBlocks";
import { CREATIVE_BLOCKS, CREATIVITY_LEVEL_TO_BLOCKS, renderCreativitySuffix } from "../config/creativityBlocks";
import { mulberry32, pickOne, xfnv1a } from "../utils/rng";

export interface CreativityContext {
  runSig: string;
  variantIndex: number;
}

function clampCreativityLevel(x: unknown): CreativityLevel {
  const n = Number(x);
  if (n === 1 || n === 2 || n === 3) return n;
  return 1;
}

export function buildCreativitySuffix(level: unknown, ctx: CreativityContext): string {
  const lvl = clampCreativityLevel(level);
  const blockIds = CREATIVITY_LEVEL_TO_BLOCKS[lvl] || [];
  if (!blockIds.length) return "";

  const seed = xfnv1a(`${ctx.runSig}::v${ctx.variantIndex}::creativity${lvl}`);
  const rnd = mulberry32(seed);

  const selection: CreativeBlocksSelection = {};
  for (const id of blockIds) {
    selection[id] = pickOne(CREATIVE_BLOCKS[id].options, rnd);
  }

  return renderCreativitySuffix(selection);
}
