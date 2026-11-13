import {
  IntentDefinitionError,
  IntentFailureError,
  type EventBus,
  type IntentEvent,
  type SemanticExpectation,
  type TargetRef,
  type TargetRegistry,
} from '@jcsoftdev/intent-core';
import { accessibleNameOf } from './accessible-name.js';

export type DomTargetRegistryMode = 'development' | 'production' | 'test';

export interface DomTargetRegistryOptions {
  readonly events?: EventBus<IntentEvent>;
  readonly mode: DomTargetRegistryMode;
}

const IMPLICIT_ROLES: Readonly<Record<string, string>> = {
  button: 'button',
  a: 'link',
  select: 'combobox',
  textarea: 'textbox',
  nav: 'navigation',
  main: 'main',
  form: 'form',
  table: 'table',
  ul: 'list',
  ol: 'list',
  li: 'listitem',
  dialog: 'dialog',
  img: 'img',
  h1: 'heading',
  h2: 'heading',
  h3: 'heading',
  h4: 'heading',
  h5: 'heading',
  h6: 'heading',
};

const INPUT_ROLES: Readonly<Record<string, string>> = {
  button: 'button',
  submit: 'button',
  reset: 'button',
  checkbox: 'checkbox',
  radio: 'radio',
  range: 'slider',
  search: 'searchbox',
  number: 'spinbutton',
};

const implicitRoleOf = (element: Element): string | undefined => {
  const tag = element.localName;
  if (tag === 'input') {
    return INPUT_ROLES[element.getAttribute('type') ?? 'text'] ?? 'textbox';
  }
  if (tag === 'a' && !element.hasAttribute('href')) {
    return undefined;
  }
  return IMPLICIT_ROLES[tag];
};

const roleOf = (element: Element): string | undefined =>
  element.getAttribute('role')?.trim().split(/\s+/)[0] || implicitRoleOf(element);

const violatesExpectation = (element: Element, expectation: SemanticExpectation): boolean =>
  roleOf(element) !== expectation.role ||
  (expectation.requireName && accessibleNameOf(element) === '');

const keyOf = (ref: TargetRef): string => `${ref.intent}\u0000${ref.key ?? ''}`;

const subjectOf = (ref: TargetRef): string =>
  ref.key === undefined ? ref.intent : `${ref.intent}:${ref.key}`;

const notFound = (): IntentFailureError =>
  new IntentFailureError({
    stage: 'navigation',
    code: 'TARGET_NOT_FOUND',
    retryable: true,
  });

const semanticsViolation = (): IntentFailureError =>
  new IntentFailureError({
    stage: 'presentation',
    code: 'SEMANTICS_VIOLATION',
    retryable: false,
  });

export const createDomTargetRegistry = (
  options: DomTargetRegistryOptions,
): TargetRegistry<Element> => {
  const targets = new Map<string, Element>();
  const waiters = new Set<() => void>();

  const notifyWaiters = (): void => {
    for (const check of [...waiters]) {
      check();
    }
  };

  const reportViolation = (ref: TargetRef, expectation: SemanticExpectation): void => {
    options.events?.emit({
      type: 'semantics.violation',
      intent: ref.intent,
      ...(ref.key === undefined ? {} : { key: ref.key }),
      expected: expectation,
    });
    if (options.mode !== 'production') {
      throw semanticsViolation();
    }
  };

  const find = (ref: TargetRef): Element | undefined => targets.get(keyOf(ref));

  return {
    register(ref, element, expectation) {
      const id = keyOf(ref);
      if (targets.has(id)) {
        throw new IntentDefinitionError('DUPLICATE_TARGET', subjectOf(ref));
      }
      if (violatesExpectation(element, expectation)) {
        reportViolation(ref, expectation);
      }
      targets.set(id, element);
      notifyWaiters();
      return () => {
        if (targets.get(id) === element) {
          targets.delete(id);
        }
      };
    },
    find,
    waitFor(ref, { signal, timeoutMs }) {
      return new Promise<Element>((resolve, reject) => {
        const settle = (finish: () => void): void => {
          clearTimeout(timer);
          observer?.disconnect();
          waiters.delete(check);
          signal.removeEventListener('abort', onAbort);
          finish();
        };
        const check = (): void => {
          const element = find(ref);
          if (element) {
            settle(() => resolve(element));
          }
        };
        const onAbort = (): void => settle(() => reject(signal.reason));
        const timer = setTimeout(() => settle(() => reject(notFound())), timeoutMs);
        const observer =
          typeof MutationObserver === 'function' ? new MutationObserver(check) : undefined;
        if (signal.aborted) {
          onAbort();
          return;
        }
        signal.addEventListener('abort', onAbort, { once: true });
        waiters.add(check);
        observer?.observe(document, { childList: true, subtree: true });
        check();
      });
    },
  };
};
