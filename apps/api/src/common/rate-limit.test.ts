import { describe, expect, it } from 'vitest';
import { SlidingWindowLimiter } from './rate-limit.js';

const make = (windowMs = 60_000, maxKeys = 50_000) => {
  let now = 1_000_000;
  const l = new SlidingWindowLimiter(windowMs, maxKeys);
  l.setClock(() => now);
  return { l, advance: (ms: number) => (now += ms) };
};

describe('SlidingWindowLimiter', () => {
  it('allows up to the limit, then refuses with a wait time', () => {
    const { l } = make();
    for (let i = 0; i < 3; i++) expect(l.hit('a', 3)).toEqual({ ok: true });
    expect(l.hit('a', 3)).toEqual({ ok: false, retryAfterSeconds: 60 });
  });

  it('counts each key separately', () => {
    const { l } = make();
    for (let i = 0; i < 3; i++) l.hit('a', 3);
    expect(l.hit('a', 3).ok).toBe(false);
    expect(l.hit('b', 3).ok).toBe(true);
  });

  it('lets requests through again as old ones leave the window', () => {
    const { l, advance } = make(60_000);
    l.hit('a', 2);
    advance(30_000);
    l.hit('a', 2);
    expect(l.hit('a', 2)).toEqual({ ok: false, retryAfterSeconds: 30 }); // oldest leaves in 30s
    advance(30_001);
    expect(l.hit('a', 2).ok).toBe(true);
  });

  it('a refused request is not counted, so waiting is enough', () => {
    const { l, advance } = make();
    l.hit('a', 1);
    for (let i = 0; i < 20; i++) l.hit('a', 1);
    advance(60_001);
    expect(l.hit('a', 1).ok).toBe(true);
  });

  it('the wait time is never below one second', () => {
    const { l, advance } = make(60_000);
    l.hit('a', 1);
    advance(59_999);
    expect(l.hit('a', 1)).toEqual({ ok: false, retryAfterSeconds: 1 });
  });

  it('count does not add a request', () => {
    const { l } = make();
    l.hit('a', 5);
    expect(l.count('a')).toBe(1);
    expect(l.count('a')).toBe(1);
    expect(l.count('nobody')).toBe(0);
  });

  it('forgets idle keys and never remembers more keys than its cap', () => {
    const { l, advance } = make(60_000, 10);
    for (let i = 0; i < 25; i++) l.hit(`k${i}`, 5);
    advance(61_000);
    for (let i = 0; i < 25; i++) l.hit(`new${i}`, 5);
    // the old ones are gone, and the map stayed bounded
    expect(l.count('k0')).toBe(0);
    expect(l.count('new24')).toBe(1);
  });

  it('a limit of zero refuses everything', () => {
    const { l } = make();
    expect(l.hit('a', 0).ok).toBe(false);
  });
});
