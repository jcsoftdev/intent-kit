import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { createDomRevealer, HIGHLIGHT_ATTRIBUTE } from './revealer.js';

const media = (reduced: boolean) => (query: string) =>
  ({ matches: reduced, media: query }) as MediaQueryList;

beforeEach(() => {
  vi.useFakeTimers();
  document.body.innerHTML = '<input id="field"><button id="target">Go</button>';
});

afterEach(() => {
  vi.useRealTimers();
});

const target = (): HTMLElement => document.getElementById('target') as HTMLElement;

test('highlight sets data-intent-highlight for 350 ms and removes it', async () => {
  const revealer = createDomRevealer({ matchMedia: media(false) });
  await revealer.reveal(target(), 'highlight', { signal: new AbortController().signal });
  expect(target().hasAttribute(HIGHLIGHT_ATTRIBUTE)).toBe(true);
  vi.advanceTimersByTime(349);
  expect(target().hasAttribute(HIGHLIGHT_ATTRIBUTE)).toBe(true);
  vi.advanceTimersByTime(1);
  expect(target().hasAttribute(HIGHLIGHT_ATTRIBUTE)).toBe(false);
});

test('reduced motion uses no smooth scroll and keeps a static outline for 2 s', async () => {
  const scroll = vi.fn();
  target().scrollIntoView = scroll;
  const revealer = createDomRevealer({ matchMedia: media(true) });
  await revealer.reveal(target(), 'highlight', { signal: new AbortController().signal });
  expect(scroll).toHaveBeenCalledWith({ behavior: 'auto', block: 'center' });
  expect(target().getAttribute(HIGHLIGHT_ATTRIBUTE)).toBe('static');
  vi.advanceTimersByTime(1999);
  expect(target().hasAttribute(HIGHLIGHT_ATTRIBUTE)).toBe(true);
  vi.advanceTimersByTime(1);
  expect(target().hasAttribute(HIGHLIGHT_ATTRIBUTE)).toBe(false);
});

test('motion allowed scrolls smoothly', async () => {
  const scroll = vi.fn();
  target().scrollIntoView = scroll;
  const revealer = createDomRevealer({ matchMedia: media(false) });
  await revealer.reveal(target(), 'focus', { signal: new AbortController().signal });
  expect(scroll).toHaveBeenCalledWith({ behavior: 'smooth', block: 'center' });
  expect(document.activeElement).toBe(target());
  expect(target().hasAttribute(HIGHLIGHT_ATTRIBUTE)).toBe(false);
});

test('focus is skipped when the active element is an input the user is editing', async () => {
  const field = document.getElementById('field') as HTMLInputElement;
  field.focus();
  const revealer = createDomRevealer({ matchMedia: media(false) });
  await revealer.reveal(target(), 'highlightAndFocus', { signal: new AbortController().signal });
  expect(document.activeElement).toBe(field);
  expect(target().hasAttribute(HIGHLIGHT_ATTRIBUTE)).toBe(true);
});

test('abort removes the highlight immediately', async () => {
  const controller = new AbortController();
  const revealer = createDomRevealer({ matchMedia: media(false) });
  await revealer.reveal(target(), 'highlight', { signal: controller.signal });
  controller.abort();
  expect(target().hasAttribute(HIGHLIGHT_ATTRIBUTE)).toBe(false);
});

test('an already aborted signal rejects without touching the element', async () => {
  const revealer = createDomRevealer({ matchMedia: media(false) });
  await expect(
    revealer.reveal(target(), 'highlight', { signal: AbortSignal.abort() }),
  ).rejects.toBeDefined();
  expect(target().hasAttribute(HIGHLIGHT_ATTRIBUTE)).toBe(false);
});
