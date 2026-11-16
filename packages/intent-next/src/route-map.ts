import type { Destination } from '@jcsoftdev/intent-core';

export interface RouteDefinition {
  readonly path: string;
  readonly query?: readonly string[];
}

export interface RouteMatch<TRouteId extends string> {
  readonly routeId: TRouteId;
  readonly params: Record<string, string>;
}

export interface RouteMap<TRouteId extends string> {
  href(destination: Destination<TRouteId>): string;
  match(pathname: string, search: URLSearchParams): RouteMatch<TRouteId> | undefined;
}

const PARAM_SEGMENT = /^(?::(\w+)|\[(\w+)\])$/;

const splitPath = (path: string): string[] => path.split('/').filter((part) => part !== '');

const paramName = (segment: string): string | undefined => {
  const found = PARAM_SEGMENT.exec(segment);
  return found?.[1] ?? found?.[2];
};

const dynamicSegmentCount = (path: string): number =>
  splitPath(path).filter((segment) => paramName(segment) !== undefined).length;

const matchPath = (path: string, pathname: string): Record<string, string> | undefined => {
  const pattern = splitPath(path);
  const actual = splitPath(pathname);
  if (pattern.length !== actual.length) {
    return undefined;
  }
  const params: Record<string, string> = {};
  for (const [index, segment] of pattern.entries()) {
    const value = actual[index] as string;
    const name = paramName(segment);
    if (name !== undefined) {
      params[name] = decodeURIComponent(value);
    } else if (segment !== value) {
      return undefined;
    }
  }
  return params;
};

const fillPath = (path: string, params: Readonly<Record<string, string>>): string => {
  const filled = splitPath(path).map((segment) => {
    const name = paramName(segment);
    return name === undefined ? segment : encodeURIComponent(params[name] ?? '');
  });
  return `/${filled.join('/')}`;
};

const pathParamNames = (path: string): string[] =>
  splitPath(path).flatMap((segment) => paramName(segment) ?? []);

export function createRouteMap<TRouteId extends string>(
  routes: Readonly<Record<TRouteId, RouteDefinition>>,
): RouteMap<TRouteId> {
  const entries = (Object.entries(routes) as [TRouteId, RouteDefinition][]).sort(
    ([, left], [, right]) => dynamicSegmentCount(left.path) - dynamicSegmentCount(right.path),
  );

  return {
    href(destination) {
      const route = routes[destination.routeId];
      const params = destination.params ?? {};
      const query = new URLSearchParams();
      for (const name of route.query ?? []) {
        const value = params[name];
        if (value !== undefined && !pathParamNames(route.path).includes(name)) {
          query.set(name, value);
        }
      }
      const path = fillPath(route.path, params);
      const queryText = query.toString();
      return queryText === '' ? path : `${path}?${queryText}`;
    },
    match(pathname, search) {
      for (const [routeId, route] of entries) {
        const params = matchPath(route.path, pathname);
        if (params === undefined) {
          continue;
        }
        for (const name of route.query ?? []) {
          const value = search.get(name);
          if (value !== null) {
            params[name] = value;
          }
        }
        return { routeId, params };
      }
      return undefined;
    },
  };
}
