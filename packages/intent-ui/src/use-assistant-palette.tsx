import { useCallback, type ReactNode } from 'react';
import { useIntentSession } from '@jcsoftdev/intent-react';
import type { CommandPaletteItem, CommandPaletteProps } from '@jcsoftdev/ui/palette';
import type { AssistantCopy } from './copy.js';

const ASSISTANT_ITEM_ID = 'intent-assistant-ask';

export interface AssistantPaletteOptions {
  readonly copy: AssistantCopy;
  readonly micSlot?: ReactNode;
}

export type AssistantPalette = Pick<CommandPaletteProps, 'onSubmitQuery' | 'inputEnd'> & {
  assistantItem(query: string): CommandPaletteItem | undefined;
};

export function useAssistantPalette({ copy, micSlot }: AssistantPaletteOptions): AssistantPalette {
  const { session } = useIntentSession();

  const ask = useCallback(
    (query: string) => {
      const text = query.trim();
      if (text !== '') {
        void session.submit({ text, source: 'text' });
      }
    },
    [session],
  );

  const assistantItem = useCallback(
    (query: string): CommandPaletteItem | undefined => {
      const text = query.trim();
      return text === ''
        ? undefined
        : {
            id: ASSISTANT_ITEM_ID,
            label: copy.askAssistant(text),
            group: '',
            keywords: [text],
            onSelect: () => ask(text),
          };
    },
    [ask, copy],
  );

  return { onSubmitQuery: ask, inputEnd: micSlot, assistantItem };
}
