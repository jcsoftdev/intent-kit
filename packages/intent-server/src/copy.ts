import type { AnyDescriptor } from '@jcsoftdev/intent-core';
import type { ServerCatalogView } from './catalog/server-catalog.js';

export interface InterpretationCopy {
  summarize(context: {
    readonly descriptor: AnyDescriptor;
    readonly input: unknown;
    readonly labels: Readonly<Record<string, string>>;
  }): string;
  promptFor(capabilityId: string, path: string): string;
  suggestions(view: ServerCatalogView): readonly string[];
}

const SUMMARY_SEPARATOR = ' · ';
const SUGGESTION_LIMIT = 3;
const INDEX_SEGMENT = /\[\d+\]/g;

const labelsOfPath = (labels: Readonly<Record<string, string>>, path: string): readonly string[] =>
  Object.entries(labels)
    .filter(([key]) => key.replace(INDEX_SEGMENT, '[]') === path)
    .map(([, label]) => label);

export const defaultInterpretationCopy: InterpretationCopy = {
  summarize: ({ descriptor, labels }) => {
    const parts = descriptor.entities.flatMap(({ path }) => labelsOfPath(labels, path));
    return parts.length === 0 ? descriptor.description : parts.join(SUMMARY_SEPARATOR);
  },
  promptFor: (_capabilityId, path) => path.split('.').at(-1) ?? path,
  suggestions: (view) =>
    view.entries.slice(0, SUGGESTION_LIMIT).flatMap((entry) => entry.manifest.examples.slice(0, 1)),
};
