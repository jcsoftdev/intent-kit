import { useRef, type KeyboardEvent } from 'react';
import type { useVoiceCommand } from '@jcsoftdev/intent-react';
import { Button } from '@jcsoftdev/ui/atoms';
import type { AssistantCopy } from './copy.js';

const HOLD_KEYS: readonly string[] = [' ', 'Enter'];

export interface PushToTalkButtonProps {
  readonly voice: ReturnType<typeof useVoiceCommand>;
  readonly copy: AssistantCopy;
  readonly busy: boolean;
  readonly size?: 'sm' | 'md';
}

export function PushToTalkButton({ voice, copy, busy, size = 'md' }: PushToTalkButtonProps) {
  const holding = useRef(false);

  const press = () => {
    if (holding.current) {
      return;
    }
    holding.current = true;
    voice.press();
  };

  const release = () => {
    if (!holding.current) {
      return;
    }
    holding.current = false;
    voice.release();
  };

  const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (!HOLD_KEYS.includes(event.key)) {
      return;
    }
    event.preventDefault();
    if (!event.repeat) {
      press();
    }
  };

  const onKeyUp = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (!HOLD_KEYS.includes(event.key)) {
      return;
    }
    event.preventDefault();
    release();
  };

  return (
    <Button
      size={size}
      variant={voice.listening ? 'primary' : 'secondary'}
      loading={busy}
      aria-pressed={voice.listening}
      onPointerDown={press}
      onPointerUp={release}
      onPointerCancel={release}
      onPointerLeave={release}
      onKeyDown={onKeyDown}
      onKeyUp={onKeyUp}
      onBlur={release}
    >
      {voice.listening ? copy.listening : copy.holdToTalk}
    </Button>
  );
}
