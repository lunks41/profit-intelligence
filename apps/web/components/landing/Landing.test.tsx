// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render } from '@testing-library/react';
import { PLANS, PLAN_IDS } from '@pi/contracts';
import { Landing } from './Landing';

const KEY = '3bbbd3e97c78785f41572acca98bc4d5';
afterEach(cleanup);

describe('the public front page', () => {
  it('says what the app does and lists every plan with Growth as most popular', () => {
    const { container } = render(<Landing clientId={KEY} />);
    expect(container.textContent).toContain('See the profit your Shopify store really makes');
    for (const id of PLAN_IDS) expect(container.textContent).toContain(PLANS[id].name);
    expect(container.textContent?.match(/Most popular/g)).toHaveLength(1);
    // only the platforms tested with a real account are offered at launch
    expect(container.textContent).toContain('Ad platforms: Meta · Google');
    expect(container.textContent).not.toContain('Reddit');
    // paid plans that are not approved yet are not sold: they say so
    expect(container.textContent).toContain('Opening soon');
  });

  it('links to the privacy policy and support', () => {
    const { container } = render(<Landing clientId={KEY} />);
    const hrefs = Array.from(container.querySelectorAll('a')).map((a) => a.getAttribute('href'));
    expect(hrefs).toEqual(expect.arrayContaining(['/privacy', '/support', '#features', '#plans']));
  });

  it('sends the merchant to Shopify to install, and asks again for a bad store name', () => {
    const assign = vi.fn();
    Object.defineProperty(window, 'location', {
      value: {
        set href(v: string) {
          assign(v);
        },
      },
      configurable: true,
    });
    const { container } = render(<Landing clientId={KEY} />);
    const input = container.querySelector('input')!;
    const form = container.querySelector('form')!;
    fireEvent.change(input, { target: { value: 'not a store!' } });
    fireEvent.submit(form);
    expect(assign).not.toHaveBeenCalled();
    expect(container.querySelector('[role=alert]')?.textContent).toContain('store name');
    fireEvent.change(input, { target: { value: 'my-shop.myshopify.com' } });
    fireEvent.submit(form);
    expect(assign).toHaveBeenCalledWith(
      `https://admin.shopify.com/store/my-shop/oauth/install?client_id=${KEY}`,
    );
  });

  it('does not offer an install it cannot do when the app key is missing', () => {
    const { container } = render(<Landing clientId={undefined} />);
    fireEvent.change(container.querySelector('input')!, { target: { value: 'my-shop' } });
    fireEvent.submit(container.querySelector('form')!);
    expect(container.querySelector('[role=alert]')?.textContent).toContain('not open yet');
  });
});
