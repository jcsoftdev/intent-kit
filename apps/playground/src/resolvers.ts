import { createInMemoryEntityResolver } from '@jcsoftdev/intent-testing';
import type { ClosedOption, Clock, EntityResolver } from '@jcsoftdev/intent-core';
import type { EntityRecord } from '@jcsoftdev/intent-testing';
import { MINUTE_MS, tableLabel } from './restaurant.js';
import type { KitchenLineRecord, PlaygroundPrincipal, RestaurantStore } from './restaurant.js';

const PENDING_STATES: ReadonlySet<string> = new Set(['EN_COLA', 'PREPARANDO']);

export interface ResolverDependencies {
  readonly store: RestaurantStore;
  readonly clock: Clock;
  readonly normalize: (text: string) => string;
}

const toOption = ({ id, label, detail }: EntityRecord): ClosedOption =>
  detail === undefined ? { id, label } : { id, label, detail };

const isVisibleTo = (principal: PlaygroundPrincipal, line: KitchenLineRecord): boolean =>
  PENDING_STATES.has(line.state) &&
  (principal.activeRole !== 'waiter' || line.waiterId === principal.userId);

const minutesSince = (clock: Clock, createdAt: number): number =>
  Math.max(0, Math.floor((clock.now() - createdAt) / MINUTE_MS));

export function createPlaygroundResolvers(
  dependencies: ResolverDependencies,
): readonly EntityResolver<PlaygroundPrincipal>[] {
  const { store, clock, normalize } = dependencies;

  const tableRecords = (principal: PlaygroundPrincipal): readonly EntityRecord[] =>
    store.tables(principal.tenantId).map((table) => ({
      id: table.id,
      label: tableLabel(table),
      detail: table.zone,
      aliases: [String(table.number)],
    }));

  const dishRecords = (principal: PlaygroundPrincipal): readonly EntityRecord[] =>
    store
      .dishes(principal.tenantId)
      .filter(({ portions }) => portions > 0)
      .map((dish) => ({ id: dish.id, label: dish.name, detail: `quedan ${dish.portions}` }));

  const lineRecords = (principal: PlaygroundPrincipal): readonly EntityRecord[] =>
    store
      .lines(principal.tenantId)
      .filter((line) => isVisibleTo(principal, line))
      .toSorted((a, b) => a.createdAt - b.createdAt)
      .map((line) => ({
        id: line.id,
        label: `${line.tableLabel} · pedido ${line.serviceNumber} · hace ${minutesSince(clock, line.createdAt)} min`,
        detail: line.dishName,
        aliases: [line.dishName, line.tableLabel],
      }));

  const resolverOver = (
    entity: string,
    records: (principal: PlaygroundPrincipal) => readonly EntityRecord[],
  ): EntityResolver<PlaygroundPrincipal> =>
    createInMemoryEntityResolver<PlaygroundPrincipal>({
      entity,
      records,
      normalize,
      options: (principal) => records(principal).map(toOption),
    });

  return [
    resolverOver('table', tableRecords),
    resolverOver('dish', dishRecords),
    resolverOver('kitchenLine', lineRecords),
  ];
}
