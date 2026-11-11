import type { ClosedOption, Draft, MissingField } from './interpretation.js';

export interface EntityQuery {
  readonly text: string;
  readonly hints: Readonly<Record<string, string>>;
  readonly scope: 'any' | 'own';
}

export type EntityResolution =
  | { readonly status: 'found'; readonly id: string; readonly label: string }
  | { readonly status: 'choices'; readonly options: readonly ClosedOption[] }
  | { readonly status: 'notFound'; readonly nearest: readonly ClosedOption[] };

export interface EntityResolver<TPrincipal> {
  readonly entity: string;
  resolve(
    principal: TPrincipal,
    query: EntityQuery,
    options: { signal: AbortSignal },
  ): Promise<EntityResolution>;
  options(
    principal: TPrincipal,
    path: string,
    draft: Draft,
    options: { signal: AbortSignal },
  ): Promise<readonly ClosedOption[]>;
}

export interface RequirementProbe<TPrincipal> {
  readonly capabilityId: string;
  readonly paths: readonly string[];
  probe(
    principal: TPrincipal,
    draft: Draft,
    options: { signal: AbortSignal },
  ): Promise<readonly MissingField[]>;
}

export interface PrincipalRoles<TRole extends string> {
  readonly active: TRole;
  readonly granted: readonly TRole[];
}
