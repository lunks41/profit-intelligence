// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render } from '@testing-library/react';
import { Masonry } from './Masonry';

afterEach(cleanup);

describe('Masonry', () => {
  it('keeps the order of the cards and leaves out the ones with nothing to show', () => {
    const { container } = render(
      <Masonry>
        <p>one</p>
        {null}
        <p>two</p>
        {undefined}
        <p>three</p>
      </Masonry>,
    );
    const texts = Array.from(container.querySelectorAll('p')).map((p) => p.textContent);
    expect(texts).toEqual(['one', 'two', 'three']);
    expect(container.firstElementChild?.children).toHaveLength(3);
  });

  it('lays the cards out as a grid with a minimum column width', () => {
    const { container } = render(
      <Masonry min="20rem">
        <p>one</p>
      </Masonry>,
    );
    const grid = container.firstElementChild as HTMLElement;
    expect(grid.style.display).toBe('grid');
    expect(grid.style.gridTemplateColumns).toContain('20rem');
  });
});
