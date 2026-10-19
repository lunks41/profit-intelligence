'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { SyncStatusResponse } from '@pi/contracts';
import { apiGet, apiPost } from '../../lib/api';

const ACTIVE = new Set(['queued', 'running']);
export const isImporting = (s: SyncStatusResponse | null) => !!s && ACTIVE.has(s.state);

/**
 * The shop's import status, polled quickly while an import runs and slowly otherwise. One place
 * owns the polling so the notice at the top and the details at the bottom never double it.
 */
export function useSyncStatus() {
  const [status, setStatus] = useState<SyncStatusResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);
  const [requestedAt, setRequestedAt] = useState<number | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const load = useCallback(async () => {
    try {
      const next = await apiGet<SyncStatusResponse>('/sync/status');
      setStatus(next);
      setError(null);
      timer.current = setTimeout(load, ACTIVE.has(next.state) ? 3000 : 30000);
    } catch {
      setError('Could not load the import status.');
      timer.current = setTimeout(load, 15000);
    }
  }, []);

  useEffect(() => {
    const first = setTimeout(load, 400); // let App Bridge finish loading
    return () => {
      clearTimeout(first);
      if (timer.current) clearTimeout(timer.current);
    };
  }, [load]);

  const resync = useCallback(async () => {
    setStarting(true);
    try {
      await apiPost('/sync');
      setRequestedAt(Date.now());
      if (timer.current) clearTimeout(timer.current);
      await load();
    } catch {
      setError('Could not start the import.');
    } finally {
      setStarting(false);
    }
  }, [load]);

  return { status, error, starting, requestedAt, resync };
}
