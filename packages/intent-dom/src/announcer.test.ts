import { beforeEach, expect, test } from 'vitest';
import { createLiveRegionAnnouncer } from './announcer.js';

let root: HTMLElement;

beforeEach(() => {
  document.body.innerHTML = '<div id="root"></div>';
  root = document.getElementById('root') as HTMLElement;
});

test('polite goes to the role=status region', () => {
  const announcer = createLiveRegionAnnouncer(root);
  announcer.announce('Saved', 'polite');
  expect(root.querySelector('[role="status"]')?.textContent).toBe('Saved');
  expect(root.querySelector('[role="alert"]')?.textContent).toBe('');
});

test('assertive goes to the role=alert region', () => {
  const announcer = createLiveRegionAnnouncer(root);
  announcer.announce('Failed', 'assertive');
  expect(root.querySelector('[role="alert"]')?.textContent).toBe('Failed');
  expect(root.querySelector('[role="status"]')?.textContent).toBe('');
});

test('the same message twice is announced twice', () => {
  const announcer = createLiveRegionAnnouncer(root);
  announcer.announce('Saved', 'polite');
  const first = root.querySelector('[role="status"] span');
  announcer.announce('Saved', 'polite');
  const second = root.querySelector('[role="status"] span');
  expect(second?.textContent).toBe('Saved');
  expect(second).not.toBe(first);
  expect(first?.isConnected).toBe(false);
});

test('dispose removes both regions', () => {
  createLiveRegionAnnouncer(root).dispose();
  expect(root.children).toHaveLength(0);
});
