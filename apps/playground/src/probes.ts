import type { MissingField, RequirementProbe } from '@jcsoftdev/intent-core';
import { z } from 'zod';
import type { ModifierGroupRecord, PlaygroundPrincipal, RestaurantStore } from './restaurant.js';

const draftLines = z.object({
  lines: z.array(z.object({ offeringId: z.string().optional() })).default([]),
});

const fieldFor = (index: number, group: ModifierGroupRecord): MissingField => ({
  path: `lines[${index}].modifiers`,
  reason: 'requirement',
  prompt: group.name,
  options: group.options
    .filter(({ available }) => available)
    .map(({ id, label }) => ({ id, label })),
  min: group.minSelections,
  max: group.maxSelections,
});

export function createModifiersProbe(
  store: RestaurantStore,
): RequirementProbe<PlaygroundPrincipal> {
  return {
    capabilityId: 'orders.create',
    paths: ['lines[].modifiers'],
    async probe(principal, draft, { signal }) {
      signal.throwIfAborted();
      const parsed = draftLines.safeParse(draft.input);
      if (!parsed.success) {
        return [];
      }
      const dishes = store.dishes(principal.tenantId);
      return parsed.data.lines.flatMap((line, index) => {
        const dish = dishes.find(({ id }) => id === line.offeringId);
        return (dish?.groups ?? [])
          .filter((group) => group.minSelections > 0)
          .map((group) => fieldFor(index, group));
      });
    },
  };
}
