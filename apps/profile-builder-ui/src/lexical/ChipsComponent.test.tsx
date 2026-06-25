import { useEffect, useState } from 'react';
import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent, act } from '@testing-library/react';
import { $getRoot, createEditor, LexicalEditor } from 'lexical';
import { $createChipsNode, Chip, ChipsNode, WIDGET_NODES } from './widget-nodes';
import { ChipsComponent } from './ChipsComponent';

// Mirrors how Lexical re-decorates a ChipsNode: re-renders ChipsComponent with
// the node's latest chips whenever the editor state changes — so the test sees
// the same prop flow as production (the component never reads the node directly).
function Harness({ editor, nodeKey }: { editor: LexicalEditor; nodeKey: string }) {
  const readChips = () =>
    editor.getEditorState().read(() => {
      const node = editor.getEditorState()._nodeMap.get(nodeKey);
      return node instanceof ChipsNode ? node.getChips() : [];
    });
  const [chips, setChips] = useState<Chip[]>(readChips);
  useEffect(() => editor.registerUpdateListener(() => setChips(readChips())), [editor]);
  return <ChipsComponent editor={editor} nodeKey={nodeKey} chips={chips} />;
}

function setup(initial: Chip[]) {
  const editor = createEditor({ namespace: 'test', nodes: WIDGET_NODES, onError: (e) => { throw e; } });
  let key = '';
  editor.update(
    () => {
      const node = $createChipsNode(undefined, initial);
      $getRoot().append(node);
      key = node.getKey();
    },
    { discrete: true },
  );
  const inputs = () => screen.getAllByPlaceholderText('tag') as HTMLInputElement[];
  render(<Harness editor={editor} nodeKey={key} />);
  return { inputs };
}

afterEach(cleanup);

describe('ChipsComponent — Enter adds a chip', () => {
  it('appends a new empty chip after the current one and focuses it', async () => {
    const { inputs } = setup([{ id: 'a', text: 'React' }]);
    expect(inputs()).toHaveLength(1);

    await act(async () => fireEvent.keyDown(inputs()[0], { key: 'Enter' }));

    const after = inputs();
    expect(after).toHaveLength(2);
    expect(after[1].value).toBe('');
    // Caret jumped into the freshly added chip.
    expect(document.activeElement).toBe(after[1]);
  });

  it('inserts the new chip directly after the one Enter was pressed in', async () => {
    const { inputs } = setup([
      { id: 'a', text: 'React' },
      { id: 'b', text: 'Vue' },
    ]);

    await act(async () => fireEvent.keyDown(inputs()[0], { key: 'Enter' }));

    const values = inputs().map((i) => i.value);
    expect(values).toEqual(['React', '', 'Vue']);
  });
});
