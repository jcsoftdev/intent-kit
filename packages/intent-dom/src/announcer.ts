import type { Announcer } from '@jcsoftdev/intent-core';

const VISUALLY_HIDDEN =
  'position:absolute;width:1px;height:1px;margin:-1px;padding:0;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap;border:0';

const createRegion = (root: HTMLElement, role: 'status' | 'alert', live: string): HTMLElement => {
  const region = root.ownerDocument.createElement('div');
  region.setAttribute('role', role);
  region.setAttribute('aria-live', live);
  region.setAttribute('aria-atomic', 'true');
  region.setAttribute('style', VISUALLY_HIDDEN);
  root.append(region);
  return region;
};

const replaceMessage = (region: HTMLElement, message: string): void => {
  const entry = region.ownerDocument.createElement('span');
  entry.textContent = message;
  region.replaceChildren(entry);
};

export const createLiveRegionAnnouncer = (root: HTMLElement): Announcer & { dispose(): void } => {
  const polite = createRegion(root, 'status', 'polite');
  const assertive = createRegion(root, 'alert', 'assertive');
  return {
    announce(message, politeness) {
      replaceMessage(politeness === 'assertive' ? assertive : polite, message);
    },
    dispose() {
      polite.remove();
      assertive.remove();
    },
  };
};
