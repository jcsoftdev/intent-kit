export {
  SPANISH_NORMALIZATION,
  createMatchKey,
  createNormalizer,
  foldSpanishPlural,
  numberWordsOf,
} from './normalize.js';
export type { NormalizationRules } from './normalize.js';
export { compilePattern } from './pattern.js';
export type { CapturedSlots, CompiledPattern, SlotKind } from './pattern.js';
export { ambiguousSlotKeys, buildDraftInput, buildSlotIndex, resolveSlotKey } from './slots.js';
export type { SlotIndex, SlotTarget } from './slots.js';
