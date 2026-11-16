const REDUCED_MOTION_QUERY = '(prefers-reduced-motion: reduce)';

export type MatchMedia = (query: string) => MediaQueryList;

export const prefersReducedMotion = (matchMedia: MatchMedia | undefined): boolean =>
  matchMedia?.(REDUCED_MOTION_QUERY).matches ?? false;

export const defaultMatchMedia = (): MatchMedia | undefined =>
  typeof globalThis.matchMedia === 'function' ? (query) => globalThis.matchMedia(query) : undefined;
