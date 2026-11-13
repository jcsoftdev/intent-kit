import type { Revealer } from '@jcsoftdev/intent-core';
import { defaultMatchMedia, prefersReducedMotion, type MatchMedia } from './reduced-motion.js';

export const HIGHLIGHT_ATTRIBUTE = 'data-intent-highlight';
const DEFAULT_HIGHLIGHT_MS = 350;
const DEFAULT_STATIC_OUTLINE_MS = 2000;
const EDITABLE_SELECTOR =
  'input, textarea, select, [contenteditable]:not([contenteditable="false"])';

export interface DomRevealerOptions {
  readonly highlightMs?: number;
  readonly staticOutlineMs?: number;
  readonly matchMedia?: MatchMedia;
}

const isUserEditing = (element: Element): boolean => {
  const active = element.ownerDocument.activeElement;
  return active !== null && active !== element && active.matches(EDITABLE_SELECTOR);
};

const scrollTo = (element: Element, reducedMotion: boolean): void => {
  element.scrollIntoView?.({ behavior: reducedMotion ? 'auto' : 'smooth', block: 'center' });
};

const focusUnlessEditing = (element: Element): void => {
  if (element instanceof HTMLElement && !isUserEditing(element)) {
    element.focus({ preventScroll: true });
  }
};

const highlight = (
  element: Element,
  durationMs: number,
  reducedMotion: boolean,
  signal: AbortSignal,
): void => {
  element.setAttribute(HIGHLIGHT_ATTRIBUTE, reducedMotion ? 'static' : 'pulse');
  const clear = (): void => {
    clearTimeout(timer);
    signal.removeEventListener('abort', clear);
    element.removeAttribute(HIGHLIGHT_ATTRIBUTE);
  };
  const timer = setTimeout(clear, durationMs);
  signal.addEventListener('abort', clear, { once: true });
};

export const createDomRevealer = (options: DomRevealerOptions = {}): Revealer<Element> => {
  const highlightMs = options.highlightMs ?? DEFAULT_HIGHLIGHT_MS;
  const staticOutlineMs = options.staticOutlineMs ?? DEFAULT_STATIC_OUTLINE_MS;
  const matchMedia = options.matchMedia ?? defaultMatchMedia();
  return {
    async reveal(element, mode, { signal }) {
      signal.throwIfAborted();
      const reducedMotion = prefersReducedMotion(matchMedia);
      scrollTo(element, reducedMotion);
      if (mode !== 'focus') {
        highlight(element, reducedMotion ? staticOutlineMs : highlightMs, reducedMotion, signal);
      }
      if (mode !== 'highlight') {
        focusUnlessEditing(element);
      }
    },
  };
};
