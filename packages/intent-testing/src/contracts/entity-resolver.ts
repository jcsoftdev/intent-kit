import type { EntityQuery, EntityResolution, EntityResolver } from '@jcsoftdev/intent-core';
import { describe, expect, it } from 'vitest';

export interface EntityResolverContractFixture<TPrincipal> {
  readonly resolver: EntityResolver<TPrincipal>;
  readonly principal: TPrincipal;
  readonly exact: { readonly text: string; readonly variant: string; readonly id: string };
  readonly ambiguous: { readonly text: string; readonly ids: readonly string[] };
  readonly unknown: string;
  readonly foreign?: { readonly principal: TPrincipal; readonly hiddenIds: readonly string[] };
}

const queryFor = (text: string): EntityQuery => ({ text, hints: {}, scope: 'any' });

const idsIn = (resolution: EntityResolution): readonly string[] => {
  switch (resolution.status) {
    case 'found':
      return [resolution.id];
    case 'choices':
      return resolution.options.map((option) => option.id);
    case 'notFound':
      return resolution.nearest.map((option) => option.id);
  }
};

const sorted = (ids: readonly string[]): readonly string[] => [...ids].sort();

export function describeEntityResolverContract<TPrincipal>(
  name: string,
  factory: () => EntityResolverContractFixture<TPrincipal>,
): void {
  describe(`${name} entity resolver contract`, () => {
    const signal = new AbortController().signal;

    it('resolves the exact text to found with the expected id', async () => {
      const { resolver, principal, exact } = factory();
      const resolution = await resolver.resolve(principal, queryFor(exact.text), { signal });
      expect(resolution).toMatchObject({ status: 'found', id: exact.id });
    });

    it('resolves a case or accent variant of the exact text to found with the same id', async () => {
      const { resolver, principal, exact } = factory();
      const resolution = await resolver.resolve(principal, queryFor(exact.variant), { signal });
      expect(resolution).toMatchObject({ status: 'found', id: exact.id });
    });

    it('resolves the ambiguous text to choices whose ids equal the expected set', async () => {
      const { resolver, principal, ambiguous } = factory();
      const resolution = await resolver.resolve(principal, queryFor(ambiguous.text), { signal });
      expect(resolution.status).toBe('choices');
      expect(sorted(idsIn(resolution))).toEqual(sorted(ambiguous.ids));
    });

    it('resolves the unknown text to notFound', async () => {
      const { resolver, principal, unknown } = factory();
      const resolution = await resolver.resolve(principal, queryFor(unknown), { signal });
      expect(resolution.status).toBe('notFound');
    });

    it('resolves empty and blank text to notFound', async () => {
      const { resolver, principal } = factory();
      for (const text of ['', '   ']) {
        const resolution = await resolver.resolve(principal, queryFor(text), { signal });
        expect(resolution.status).toBe('notFound');
      }
    });

    it('tenant isolation: never returns an id hidden from the foreign principal in found, options or nearest', async () => {
      const { resolver, exact, ambiguous, unknown, foreign } = factory();
      if (foreign === undefined) {
        throw new Error('the fixture must provide foreign to verify tenant isolation');
      }
      expect(foreign.hiddenIds.length).toBeGreaterThan(0);
      const texts = [exact.text, exact.variant, ambiguous.text, unknown];
      for (const text of texts) {
        const resolution = await resolver.resolve(foreign.principal, queryFor(text), { signal });
        expect(idsIn(resolution).filter((id) => foreign.hiddenIds.includes(id))).toEqual([]);
      }
    });

    it('with an already-aborted signal rejects with the reason', async () => {
      const { resolver, principal, exact } = factory();
      const reason = new Error('already aborted');
      const controller = new AbortController();
      controller.abort(reason);
      await expect(
        resolver.resolve(principal, queryFor(exact.text), { signal: controller.signal }),
      ).rejects.toBe(reason);
    });
  });
}
