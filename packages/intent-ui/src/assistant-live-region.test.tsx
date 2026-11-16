import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, expect, test } from 'vitest';
import { AssistantLiveRegion } from './assistant-live-region.js';

afterEach(cleanup);

test('the live region is a polite status carrying the message', () => {
  render(<AssistantLiveRegion message="Escuchando" />);
  const region = screen.getByRole('status');
  expect(region.getAttribute('aria-live')).toBe('polite');
  expect(region.textContent).toBe('Escuchando');
});
