import { render } from '@testing-library/react';
import type { PrefabDefinition } from '@offisim/shared-types';

const bookshelfSpy = vi.fn(() => null);
const whiteboardSpy = vi.fn(() => null);

vi.mock('../../components/scene/prefabs/BookshelfMesh3D.js', () => ({
  BookshelfMesh3D: (props: unknown) => bookshelfSpy(props),
}));

vi.mock('../../components/scene/prefabs/WhiteboardMesh3D.js', () => ({
  WhiteboardMesh3D: (props: unknown) => whiteboardSpy(props),
}));

import { Prefab3D } from '../../components/scene/prefabs/Prefab3D.js';

function makeKnowledgePrefab(prefabId: string, template = prefabId): PrefabDefinition {
  return {
    prefabId,
    name: prefabId,
    description: prefabId,
    category: 'knowledge',
    gridSize: [2, 1],
    composite: false,
    render2D: { template },
    bindingSlots: [],
  };
}

describe('Prefab3D knowledge routing', () => {
  beforeEach(() => {
    bookshelfSpy.mockClear();
    whiteboardSpy.mockClear();
  });

  it('renders dedicated whiteboard mesh for whiteboard prefabs', () => {
    render(<Prefab3D definition={makeKnowledgePrefab('whiteboard')} />);

    expect(whiteboardSpy).toHaveBeenCalled();
    expect(bookshelfSpy).not.toHaveBeenCalled();
  });

  it('keeps non-whiteboard knowledge prefabs on the bookshelf mesh path', () => {
    render(<Prefab3D definition={makeKnowledgePrefab('bookshelf', 'bookshelf')} />);

    expect(bookshelfSpy).toHaveBeenCalled();
    expect(whiteboardSpy).not.toHaveBeenCalled();
  });
});
