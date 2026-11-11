import {
  foldText,
  systemClock,
  type ClosedOption,
  type Clock,
  type Draft,
  type EntityQuery,
  type EntityResolution,
  type EntityResolver,
} from '@jcsoftdev/intent-core';

export interface EntityRecord {
  readonly id: string;
  readonly label: string;
  readonly detail?: string;
  readonly aliases?: readonly string[];
}

const MAX_NEAREST = 3;

const tokensOf = (normalized: string): readonly string[] =>
  normalized === '' ? [] : normalized.split(' ');

const toOption = (record: EntityRecord): ClosedOption =>
  record.detail === undefined
    ? { id: record.id, label: record.label }
    : { id: record.id, label: record.label, detail: record.detail };

const resolveFrom = (options: readonly ClosedOption[]): EntityResolution =>
  options.length === 1 && options[0]
    ? { status: 'found', id: options[0].id, label: options[0].label }
    : { status: 'choices', options };

export const createInMemoryEntityResolver = <TPrincipal>(config: {
  readonly entity: string;
  readonly records: (principal: TPrincipal, query: EntityQuery) => readonly EntityRecord[];
  readonly normalize?: (text: string) => string;
  readonly options?: (principal: TPrincipal, path: string, draft: Draft) => readonly ClosedOption[];
  readonly delayMs?: number;
  readonly clock?: Clock;
}): EntityResolver<TPrincipal> => {
  const normalize = config.normalize ?? foldText;
  const clock = config.clock ?? systemClock;

  const pause = async (signal: AbortSignal): Promise<void> => {
    signal.throwIfAborted();
    if (config.delayMs !== undefined) {
      await clock.delay(config.delayMs, { signal });
    }
  };

  const namesOf = (record: EntityRecord): readonly (readonly string[])[] =>
    [record.label, ...(record.aliases ?? [])].map((name) => tokensOf(normalize(name)));

  const isExact = (record: EntityRecord, text: string): boolean =>
    namesOf(record).some((tokens) => tokens.join(' ') === text);

  const isPartial = (record: EntityRecord, text: string, query: readonly string[]): boolean =>
    namesOf(record).some(
      (tokens) =>
        tokens.join(' ').startsWith(text) || query.every((token) => tokens.includes(token)),
    );

  const sharedTokens = (record: EntityRecord, query: readonly string[]): number =>
    Math.max(...namesOf(record).map((tokens) => query.filter((t) => tokens.includes(t)).length));

  const nearest = (
    records: readonly EntityRecord[],
    query: readonly string[],
  ): readonly ClosedOption[] =>
    records
      .map((record, index) => ({ record, index, shared: sharedTokens(record, query) }))
      .filter((entry) => entry.shared > 0)
      .sort((a, b) => b.shared - a.shared || a.index - b.index)
      .slice(0, MAX_NEAREST)
      .map((entry) => toOption(entry.record));

  return {
    entity: config.entity,
    async resolve(principal, query, { signal }) {
      await pause(signal);
      const records = config.records(principal, query);
      const text = normalize(query.text);
      const queryTokens = tokensOf(text);
      const exact = records.filter((record) => isExact(record, text));
      if (exact.length > 0) {
        return resolveFrom(exact.map(toOption));
      }
      const partial = records.filter((record) => isPartial(record, text, queryTokens));
      if (partial.length > 0) {
        return resolveFrom(partial.map(toOption));
      }
      return { status: 'notFound', nearest: nearest(records, queryTokens) };
    },
    async options(principal, path, draft, { signal }) {
      await pause(signal);
      return config.options?.(principal, path, draft) ?? [];
    },
  };
};
