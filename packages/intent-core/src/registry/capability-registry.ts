import { IntentFailureError } from '../contracts/index.js';
import type {
  AnyDescriptor,
  CapabilityRegistry,
  DiscoveryFilter,
  Effect,
  EffectLoader,
  Failure,
} from '../contracts/index.js';
import { IntentDefinitionError } from '../contracts/index.js';
import { validateDescriptor } from './validate-descriptor.js';

interface Entry {
  readonly descriptor: AnyDescriptor;
  readonly loader?: EffectLoader;
  effect?: Effect<unknown, unknown>;
  pending?: Promise<Effect<unknown, unknown>>;
}

const notFound: Failure = {
  stage: 'execution',
  code: 'CAPABILITY_NOT_FOUND',
  retryable: false,
};
const noLoader: Failure = { stage: 'execution', code: 'EXECUTION_FAILED', retryable: false };
const loadFailed: Failure = { stage: 'execution', code: 'EXECUTION_FAILED', retryable: true };

const matches = (descriptor: AnyDescriptor, filter: DiscoveryFilter): boolean =>
  (filter.role === undefined || descriptor.roles.includes(filter.role)) &&
  (filter.exposures === undefined || filter.exposures.includes(descriptor.agent)) &&
  (filter.scopes === undefined || filter.scopes.includes(descriptor.scope));

export const createCapabilityRegistry = (): CapabilityRegistry => {
  const entries = new Map<string, Entry>();

  const startLoad = (entry: Entry, loader: EffectLoader): Promise<Effect<unknown, unknown>> => {
    const pending = new Promise<Awaited<ReturnType<EffectLoader>>>((resolve) => {
      resolve(loader());
    }).then(
      (module) => {
        if (entries.get(entry.descriptor.id) === entry) {
          entry.effect = module.default;
        }
        entry.pending = undefined;
        return module.default;
      },
      () => {
        entry.pending = undefined;
        throw new IntentFailureError(loadFailed);
      },
    );
    entry.pending = pending;
    return pending;
  };

  return {
    register(descriptor, loader) {
      validateDescriptor(descriptor);
      if (entries.has(descriptor.id)) {
        throw new IntentDefinitionError('DUPLICATE_ID', descriptor.id);
      }
      const entry: Entry = { descriptor, ...(loader ? { loader } : {}) };
      entries.set(descriptor.id, entry);
      return () => {
        if (entries.get(descriptor.id) === entry) {
          entries.delete(descriptor.id);
        }
      };
    },
    get: (id) => entries.get(id)?.descriptor,
    discover: (filter) =>
      [...entries.values()]
        .map((entry) => entry.descriptor)
        .filter((descriptor) => matches(descriptor, filter)),
    async loadEffect(id, options) {
      options.signal.throwIfAborted();
      const entry = entries.get(id);
      if (!entry) {
        throw new IntentFailureError(notFound);
      }
      if (entry.effect) {
        return entry.effect;
      }
      if (!entry.loader) {
        throw new IntentFailureError(noLoader);
      }
      return entry.pending ?? startLoad(entry, entry.loader);
    },
  };
};
