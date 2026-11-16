import { useSyncExternalStore } from 'react';
import type { ConfirmationPort, ConfirmationRequest } from '@jcsoftdev/intent-core';
import { AlertDialog } from '@jcsoftdev/ui/overlays';
import type { AssistantCopy } from './copy.js';

type Answer = 'confirmed' | 'declined';

interface Pending {
  readonly request: ConfirmationRequest;
  readonly resolve: (answer: Answer) => void;
}

export interface DialogConfirmation {
  readonly port: ConfirmationPort;
  readonly Dialog: (props: { copy: AssistantCopy }) => React.JSX.Element;
}

export function createDialogConfirmationPort(): DialogConfirmation {
  let pending: Pending | undefined;
  const listeners = new Set<() => void>();

  const notify = () => {
    listeners.forEach((listener) => listener());
  };

  const subscribe = (listener: () => void) => {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  };

  const settle = (answer: Answer) => {
    const settled = pending;
    pending = undefined;
    notify();
    settled?.resolve(answer);
  };

  const port: ConfirmationPort = {
    confirm: (request, { signal }) =>
      new Promise<Answer>((resolve) => {
        if (signal.aborted) {
          resolve('declined');
          return;
        }
        if (pending) {
          settle('declined');
        }
        pending = { request, resolve };
        signal.addEventListener(
          'abort',
          () => {
            if (pending?.request === request) {
              settle('declined');
            }
          },
          { once: true },
        );
        notify();
      }),
  };

  const current = () => pending;

  function Dialog({ copy }: { copy: AssistantCopy }) {
    const active = useSyncExternalStore(subscribe, current, current);
    const heard = active?.request.heard;
    return (
      <AlertDialog
        open={active !== undefined}
        title={active?.request.summary ?? ''}
        description={heard === undefined ? undefined : copy.heard(heard)}
        confirmLabel={copy.confirm}
        cancelLabel={copy.decline}
        initialFocus="cancel"
        onConfirm={async () => settle('confirmed')}
        onCancel={() => settle('declined')}
      />
    );
  }

  return { port, Dialog };
}
