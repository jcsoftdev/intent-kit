import { useEffect } from 'react';
import { useIntentSession } from '@jcsoftdev/intent-react';
import { toast } from '@jcsoftdev/ui/overlays';
import type { AssistantCopy } from './copy.js';

export interface UndoToastOptions {
  readonly copy: AssistantCopy;
  message(planId: string): string;
  isUndoable?(planId: string): boolean;
}

export function useUndoToast({ copy, message, isUndoable = () => true }: UndoToastOptions): void {
  const { session, state } = useIntentSession();
  const planId = state.name === 'presenting' ? state.planId : undefined;

  useEffect(() => {
    if (planId === undefined || !isUndoable(planId)) {
      return;
    }
    const id = toast(message(planId), {
      action: {
        label: copy.undo,
        onClick: () => {
          void session.undo(planId);
        },
      },
    });
    return () => {
      toast.dismiss(id);
    };
  }, [planId, session, copy, message, isUndoable]);
}
