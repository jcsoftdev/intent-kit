import { foldText } from '@jcsoftdev/intent-core';
import type {
  CapabilityManifestEntry,
  InterpretRequest,
  Interpreter,
  Proposal,
} from '@jcsoftdev/intent-core';
import { KNOWN_DISH_NAMES } from './restaurant.js';

export interface KeywordInterpreter extends Interpreter {
  calls(): readonly InterpretRequest[];
}

const CONFIDENCE = 0.8;
const TABLE_MENTION = /\bmesa (\d+)\b/;

const DISH_WORDS: readonly string[] = KNOWN_DISH_NAMES.map(foldText).toSorted(
  (a, b) => b.length - a.length,
);

const mentions = (folded: string, phrase: string): boolean => ` ${folded} `.includes(` ${phrase} `);

const propertyNames = (entry: CapabilityManifestEntry): readonly string[] => {
  const { properties } = entry.inputJsonSchema;
  return typeof properties === 'object' && properties !== null && !Array.isArray(properties)
    ? Object.keys(properties)
    : [];
};

const slotsFor = (entry: CapabilityManifestEntry, folded: string): Proposal['slots'] => {
  const properties = propertyNames(entry);
  const table = TABLE_MENTION.exec(folded)?.[1];
  const dish = DISH_WORDS.find((word) => mentions(folded, word));
  return {
    ...(table !== undefined && properties.includes('tableId') ? { table } : {}),
    ...(dish !== undefined && properties.includes('lines') ? { dish } : {}),
    ...(dish !== undefined && properties.includes('lineIds') ? { kitchenLine: dish } : {}),
  };
};

export function createKeywordInterpreter(): KeywordInterpreter {
  const received: InterpretRequest[] = [];
  return {
    calls: () => [...received],
    async interpret(request, { signal }) {
      signal.throwIfAborted();
      received.push(request);
      const folded = foldText(request.text);
      const proposals = request.catalog
        .filter((entry) => entry.aliases.some((alias) => mentions(folded, foldText(alias))))
        .map((entry): Proposal => ({
          capabilityId: entry.id,
          slots: slotsFor(entry, folded),
          confidence: CONFIDENCE,
        }));
      return proposals.length === 0 ? { status: 'unsupported' } : { status: 'proposed', proposals };
    },
  };
}
