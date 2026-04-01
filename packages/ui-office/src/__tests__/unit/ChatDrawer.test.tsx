import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ChatDrawer } from '../../components/chat/ChatDrawer';

function firePointer(el: Element, type: string, props: Record<string, unknown>) {
  const event = new Event(type, { bubbles: true, cancelable: true });
  Object.assign(event, { pointerId: 1, ...props });
  fireEvent(el, event);
}

const OPEN_KEY = 'offisim-chat-open';
const HEIGHT_KEY = 'offisim-chat-height';

function mockMatchMedia(matches: boolean) {
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    value: vi.fn().mockImplementation(() => ({
      matches,
      media: '(max-width: 768px)',
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  });
}

describe('ChatDrawer', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    localStorage.clear();
    mockMatchMedia(false);
    Object.defineProperty(window, 'innerHeight', {
      configurable: true,
      value: 1000,
    });
    Object.defineProperty(HTMLElement.prototype, 'setPointerCapture', {
      configurable: true,
      value: vi.fn(),
    });
    Object.defineProperty(HTMLElement.prototype, 'releasePointerCapture', {
      configurable: true,
      value: vi.fn(),
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('renders as a 40px bar when collapsed', () => {
    localStorage.setItem(OPEN_KEY, 'false');

    const { container } = render(
      <ChatDrawer>
        <div>Chat Content</div>
      </ChatDrawer>,
    );

    expect(container.firstElementChild).toHaveStyle({ height: '40px' });
  });

  it('uses the persisted height when expanded by requestOpen', () => {
    localStorage.setItem(OPEN_KEY, 'false');
    localStorage.setItem(HEIGHT_KEY, '280');

    const { container, rerender } = render(
      <ChatDrawer requestOpen={0}>
        <div>Chat Content</div>
      </ChatDrawer>,
    );

    rerender(
      <ChatDrawer requestOpen={1}>
        <div>Chat Content</div>
      </ChatDrawer>,
    );

    expect(container.firstElementChild).toHaveStyle({ height: '280px' });
  });

  it('clamps drag resize to the configured min and max bounds', () => {
    localStorage.setItem(OPEN_KEY, 'true');
    localStorage.setItem(HEIGHT_KEY, '240');

    const { container } = render(
      <ChatDrawer>
        <div>Chat Content</div>
      </ChatDrawer>,
    );

    const handle = screen.getByTestId('chat-resize-handle');
    firePointer(handle, 'pointerdown', { clientY: 500 });
    firePointer(handle, 'pointermove', { clientY: 1200 });
    firePointer(handle, 'pointerup', { clientY: 1200 });

    expect(container.firstElementChild).toHaveStyle({ height: '160px' });

    firePointer(handle, 'pointerdown', { clientY: 500 });
    firePointer(handle, 'pointermove', { clientY: -300 });
    firePointer(handle, 'pointerup', { clientY: -300 });

    expect(container.firstElementChild).toHaveStyle({ height: '450px' });
  });

  it('defaults to collapsed on narrow screens', () => {
    mockMatchMedia(true);

    const { container } = render(
      <ChatDrawer>
        <div>Chat Content</div>
      </ChatDrawer>,
    );

    expect(container.firstElementChild).toHaveStyle({ height: '40px' });
  });
});
