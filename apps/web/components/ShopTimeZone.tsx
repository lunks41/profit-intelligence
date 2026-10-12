'use client';

import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import type { SessionResponse } from '@pi/contracts';
import { apiGet } from '../lib/api';
import { setShopTimeZone } from '../lib/shop-time';

/**
 * Learns the time zone of the shop before any screen draws, so dates and times are shown (and "today" is
 * worked out) in the zone of the shop. If the session cannot be read the zone of the browser is used and the
 * screen opens anyway.
 */
export function ShopTimeZone({ children }: { children: ReactNode }) {
  const [ready, setReady] = useState(false);
  useEffect(() => {
    let live = true;
    apiGet<SessionResponse>('/session')
      .then((s) => setShopTimeZone(s.shop.timezone))
      .catch(() => setShopTimeZone(null))
      .finally(() => live && setReady(true));
    return () => {
      live = false;
    };
  }, []);
  return ready ? <>{children}</> : null;
}
