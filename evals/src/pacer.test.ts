import { describe, expect, it } from 'vitest';

import { TokenWindow } from './pacer.js';

describe('TokenWindow', () => {
  it('does not wait while the minute has room', () => {
    let now = 0;
    const window = new TokenWindow(8000, () => now);
    window.record(3000);
    now = 10_000;

    expect(window.waitMsFor(4000)).toBe(0);
  });

  it('waits until the oldest spending leaves the window', () => {
    let now = 0;
    const window = new TokenWindow(8000, () => now);
    window.record(5000);
    now = 20_000;
    window.record(2000);
    now = 30_000;

    // 7000 spent; 6000 more needs the 5000 from t=0 to age out at t=60s.
    expect(window.waitMsFor(6000)).toBe(30_000);
  });

  it('forgets spending older than a minute', () => {
    let now = 0;
    const window = new TokenWindow(8000, () => now);
    window.record(8000);
    now = 61_000;

    expect(window.waitMsFor(7000)).toBe(0);
  });
});
