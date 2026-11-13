import { describe, expect, it } from 'vitest';
import { createRouteMap } from './route-map.js';

type RouteId = 'home' | 'orders' | 'order' | 'new-order';

const map = createRouteMap<RouteId>({
  home: { path: '/' },
  orders: { path: '/orders', query: ['venueId', 'status'] },
  order: { path: '/orders/:id', query: ['venueId'] },
  'new-order': { path: '/orders/new' },
});

describe('createRouteMap', () => {
  it.each([
    [{ routeId: 'home' as const }, '/'],
    [
      { routeId: 'orders' as const, params: { venueId: 'v1', status: 'open' } },
      '/orders?venueId=v1&status=open',
    ],
    [
      { routeId: 'order' as const, params: { id: 'a b', venueId: 'v1' } },
      '/orders/a%20b?venueId=v1',
    ],
    [{ routeId: 'orders' as const, params: { other: 'x' } }, '/orders'],
  ])('href %j is %s', (destination, expected) => {
    expect(map.href(destination)).toBe(expected);
  });

  it.each([
    ['/', '', { routeId: 'home', params: {} }],
    ['/orders', 'venueId=v1&x=1', { routeId: 'orders', params: { venueId: 'v1' } }],
    ['/orders/42', 'venueId=v1', { routeId: 'order', params: { id: '42', venueId: 'v1' } }],
    ['/orders/a%20b', '', { routeId: 'order', params: { id: 'a b' } }],
    ['/orders/new', '', { routeId: 'new-order', params: {} }],
    ['/orders/', '', { routeId: 'orders', params: {} }],
  ])('match %s?%s', (pathname, search, expected) => {
    expect(map.match(pathname, new URLSearchParams(search))).toEqual(expected);
  });

  it('returns undefined for an unknown pathname', () => {
    expect(map.match('/nope/1/2', new URLSearchParams())).toBeUndefined();
  });

  it('supports bracket segments', () => {
    const bracket = createRouteMap<'item'>({ item: { path: '/items/[id]' } });
    expect(bracket.href({ routeId: 'item', params: { id: '7' } })).toBe('/items/7');
    expect(bracket.match('/items/7', new URLSearchParams())).toEqual({
      routeId: 'item',
      params: { id: '7' },
    });
  });
});
