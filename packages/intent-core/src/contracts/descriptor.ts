import type { StandardSchemaV1 } from './standard-schema.js';

export type RiskLevel = 'read' | 'write' | 'destructive';
export type CapabilityKind = 'navigate' | 'read' | 'write' | 'handoff';
export type AgentExposure = 'allowed' | 'handoff' | 'never';
export type CapabilityScope = 'global' | 'route' | 'component' | 'entity';

export interface EntityParam<TPath extends string = string> {
  readonly path: TPath;
  readonly entity: string;
  readonly scope?: 'any' | 'own';
}

type DepthStep = [never, 0, 1, 2, 3, 4, 5];

type ChildPaths<TKey extends string, TValue, TDepth extends number> =
  NonNullable<TValue> extends readonly (infer TElement)[]
    ? | `${TKey}[]`
      | (TElement extends object ? `${TKey}[].${PathsOf<TElement, DepthStep[TDepth]>}` : never)
    : NonNullable<TValue> extends object
      ? `${TKey}.${PathsOf<NonNullable<TValue>, DepthStep[TDepth]>}`
      : never;

type PathsOf<T, TDepth extends number> = [TDepth] extends [never]
  ? never
  : T extends readonly unknown[]
    ? never
    : T extends object
      ? {
          [K in keyof T & string]-?: K | ChildPaths<K, T[K], TDepth>;
        }[keyof T & string]
      : never;

export type InputPath<T> = PathsOf<T, 6>;

export type Reversibility =
  | { readonly kind: 'none' }
  | { readonly kind: 'compensate'; readonly via: string; readonly windowMs: number }
  | { readonly kind: 'grace'; readonly delayMs: number };

export type Idempotency =
  | { readonly kind: 'none' }
  | { readonly kind: 'natural' }
  | { readonly kind: 'key'; readonly carrier: 'header' | 'body'; readonly field: string };

export type ConfirmationPolicy = 'never' | 'always' | 'whenVoice' | 'whenIrreversible';

export interface Destination<TRouteId extends string> {
  readonly routeId: TRouteId;
  readonly params?: Readonly<Record<string, string>>;
  readonly target?: { readonly intent: string; readonly key?: string };
}

export interface DestinationRule<TRole extends string, TRouteId extends string> {
  readonly default: Destination<TRouteId>;
  readonly byRole?: Partial<Record<TRole, Destination<TRouteId>>>;
}

export interface CapabilityDescriptor<
  TRole extends string,
  TRouteId extends string,
  TInput = unknown,
  TOutput = unknown,
> {
  readonly id: string;
  readonly version: number;
  readonly kind: CapabilityKind;
  readonly agent: AgentExposure;
  readonly description: string;
  readonly aliases: readonly string[];
  readonly examples: readonly string[];
  readonly patterns: readonly string[];
  readonly scope: CapabilityScope;
  readonly input: StandardSchemaV1<unknown, TInput>;
  readonly output?: StandardSchemaV1<unknown, TOutput>;
  readonly entities: readonly EntityParam[];
  readonly risk: RiskLevel;
  readonly confirmation: ConfirmationPolicy;
  readonly reversibility: Reversibility;
  readonly idempotency: Idempotency;
  readonly roles: readonly TRole[];
  readonly destination?: DestinationRule<TRole, TRouteId>;
  readonly form?: { readonly formId: string };
}

export type CapabilityDefinition<
  TRole extends string,
  TRouteId extends string,
  TInput = unknown,
  TOutput = unknown,
> = Omit<CapabilityDescriptor<TRole, TRouteId, TInput, TOutput>, 'entities'> & {
  readonly entities: readonly EntityParam<InputPath<TInput>>[];
};

export type AnyDescriptor = CapabilityDescriptor<string, string, unknown, unknown>;

export type Unregister = () => void;

export function createCapabilityDefiner<TRole extends string, TRouteId extends string>() {
  return <TInput, TOutput>(
    definition: CapabilityDefinition<TRole, TRouteId, TInput, TOutput>,
  ): CapabilityDescriptor<TRole, TRouteId, TInput, TOutput> =>
    definition as CapabilityDescriptor<TRole, TRouteId, TInput, TOutput>;
}
