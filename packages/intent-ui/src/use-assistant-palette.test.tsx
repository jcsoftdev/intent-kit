import {
  act,
  cleanup,
  render,
  renderHook,
  screen,
  fireEvent,
  waitFor,
} from '@testing-library/react';
import { afterEach, expect, test } from 'vitest';
import { CommandPalette } from '@jcsoftdev/ui/palette';
import { copy, createTestKit, wrapperOf } from '../test/support.js';
import { useAssistantPalette } from './use-assistant-palette.js';

afterEach(cleanup);

const utterances = (inputs: ReturnType<typeof createTestKit>['inputs']) =>
  inputs.flatMap((input) =>
    input.kind === 'utterance' ? [{ text: input.text, source: input.source }] : [],
  );

test('the assistant item label is askAssistant(query)', () => {
  const { result } = renderHook(() => useAssistantPalette({ copy }), {
    wrapper: wrapperOf(createTestKit()),
  });
  expect(result.current.assistantItem('mesa 4')?.label).toBe('Preguntar: mesa 4');
  expect(result.current.assistantItem('   ')).toBeUndefined();
});

test('submitting a query sends its text with source text', async () => {
  const test$ = createTestKit();
  const { result } = renderHook(() => useAssistantPalette({ copy }), {
    wrapper: wrapperOf(test$),
  });
  await act(async () => {
    result.current.onSubmitQuery?.('  mesa 4, dos lomos ');
  });
  expect(utterances(test$.inputs)).toEqual([{ text: 'mesa 4, dos lomos', source: 'text' }]);
});

test('selecting the assistant item submits the query', async () => {
  const test$ = createTestKit();
  const { result } = renderHook(() => useAssistantPalette({ copy }), {
    wrapper: wrapperOf(test$),
  });
  await act(async () => {
    result.current.assistantItem('ya servi el 12')?.onSelect();
  });
  expect(utterances(test$.inputs)).toEqual([{ text: 'ya servi el 12', source: 'text' }]);
});

test('the palette Enter with no selected item calls submit with source text', async () => {
  const test$ = createTestKit();
  const Palette = () => {
    const palette = useAssistantPalette({ copy, micSlot: <span>mic</span> });
    return (
      <CommandPalette
        open
        onClose={() => undefined}
        items={[]}
        label="Asistente"
        placeholder="Buscar"
        emptyLabel="Sin resultados"
        formatResultCount={(count) => String(count)}
        onSubmitQuery={palette.onSubmitQuery}
        inputEnd={palette.inputEnd}
      />
    );
  };
  const Wrapper = wrapperOf(test$);
  render(
    <Wrapper>
      <Palette />
    </Wrapper>,
  );
  const input = await screen.findByRole('combobox');
  fireEvent.change(input, { target: { value: 'mesa 4' } });
  fireEvent.keyDown(input, { key: 'Enter' });
  await waitFor(() =>
    expect(utterances(test$.inputs)).toEqual([{ text: 'mesa 4', source: 'text' }]),
  );
  expect(screen.getByText('mic')).toBeTruthy();
});
