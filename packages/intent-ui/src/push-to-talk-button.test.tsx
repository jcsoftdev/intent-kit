import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, test, vi } from 'vitest';
import { copy } from '../test/support.js';
import { PushToTalkButton } from './push-to-talk-button.js';

afterEach(cleanup);

const voiceOf = (listening: boolean) => ({
  listening,
  partial: '',
  press: vi.fn(),
  release: vi.fn(),
  cancel: vi.fn(),
});

test('push-to-talk: pointer down presses, pointer up releases', () => {
  const voice = voiceOf(false);
  render(<PushToTalkButton voice={voice} copy={copy} busy={false} />);
  const button = screen.getByRole('button', { name: copy.holdToTalk });
  fireEvent.pointerDown(button);
  expect(voice.press).toHaveBeenCalledTimes(1);
  fireEvent.pointerUp(button);
  expect(voice.release).toHaveBeenCalledTimes(1);
  fireEvent.pointerLeave(button);
  expect(voice.release).toHaveBeenCalledTimes(1);
});

test('push-to-talk: pointer leave and cancel release a held press', () => {
  const voice = voiceOf(false);
  render(<PushToTalkButton voice={voice} copy={copy} busy={false} />);
  const button = screen.getByRole('button');
  fireEvent.pointerDown(button);
  fireEvent.pointerLeave(button);
  expect(voice.release).toHaveBeenCalledTimes(1);
  fireEvent.pointerDown(button);
  fireEvent.pointerCancel(button);
  expect(voice.release).toHaveBeenCalledTimes(2);
});

test.each([' ', 'Enter'])('push-to-talk: %j held presses once and keyup releases', (key) => {
  const voice = voiceOf(false);
  render(<PushToTalkButton voice={voice} copy={copy} busy={false} />);
  const button = screen.getByRole('button');
  fireEvent.keyDown(button, { key });
  fireEvent.keyDown(button, { key, repeat: true });
  expect(voice.press).toHaveBeenCalledTimes(1);
  fireEvent.keyUp(button, { key });
  expect(voice.release).toHaveBeenCalledTimes(1);
});

test('a key other than Space or Enter does nothing', () => {
  const voice = voiceOf(false);
  render(<PushToTalkButton voice={voice} copy={copy} busy={false} />);
  fireEvent.keyDown(screen.getByRole('button'), { key: 'a' });
  expect(voice.press).not.toHaveBeenCalled();
});

test('aria-pressed follows listening and aria-busy follows busy', () => {
  const { rerender } = render(<PushToTalkButton voice={voiceOf(false)} copy={copy} busy={false} />);
  let button = screen.getByRole('button');
  expect(button.getAttribute('aria-pressed')).toBe('false');
  expect(button.getAttribute('aria-busy')).toBeNull();
  rerender(<PushToTalkButton voice={voiceOf(true)} copy={copy} busy />);
  button = screen.getByRole('button', { name: new RegExp(copy.listening) });
  expect(button.getAttribute('aria-pressed')).toBe('true');
  expect(button.getAttribute('aria-busy')).toBe('true');
});
