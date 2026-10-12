'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { apiGet } from '../lib/api';

interface Running {
  kind: string;
  label: string;
  count: number;
}

const IDLE_MS = 30_000;
const BUSY_MS = 2_500;

/**
 * Shows what the app is doing in the background for the shop: a small spinner and "Recalculating profit" while a
 * recalculation, a sync, an ad import or a report is waiting or running. A change the merchant makes (the app tells
 * this component through the `pi:changed` event) is looked at right away and then every few seconds until the work
 * is done; then "Figures updated" shows for a moment and the screens load their figures again.
 */
export function ActivityIndicator() {
  const [running, setRunning] = useState<Running[]>([]);
  const [justDone, setJustDone] = useState<string | null>(null);
  const kicked = useRef(false);
  const was = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const alive = useRef(true);

  const poll = useCallback(async () => {
    let next: Running[] = [];
    try {
      next = (await apiGet<{ running: Running[] }>('/activity')).running;
    } catch {
      // the indicator is a convenience: a failed look is tried again later
    }
    if (!alive.current) return;
    setRunning(next);
    const busy = next.length > 0;
    if (!busy && (was.current || kicked.current)) {
      // work that took time says Figures updated; a change that needed none (an expense, a rule) says Saved
      setJustDone(was.current ? 'Figures updated' : 'Saved');
      window.dispatchEvent(new Event('pi:data-updated'));
      setTimeout(() => alive.current && setJustDone(null), 3500);
    }
    kicked.current = false;
    was.current = busy;
    timer.current = setTimeout(() => void poll(), busy ? BUSY_MS : IDLE_MS);
  }, []);

  useEffect(() => {
    alive.current = true;
    // wait briefly so App Bridge has loaded before the first token request
    timer.current = setTimeout(() => void poll(), 800);
    // something was changed: look straight away, the work may be queued in a second
    let kick: ReturnType<typeof setTimeout> | null = null;
    const changed = () => {
      kicked.current = true;
      if (kick) clearTimeout(kick);
      kick = setTimeout(() => {
        if (timer.current) clearTimeout(timer.current);
        void poll();
      }, 700);
    };
    window.addEventListener('pi:changed', changed);
    return () => {
      alive.current = false;
      if (timer.current) clearTimeout(timer.current);
      if (kick) clearTimeout(kick);
      window.removeEventListener('pi:changed', changed);
    };
  }, [poll]);

  if (running.length === 0 && !justDone) return null;
  const text = running.length > 0 ? running.map((r) => r.label).join(', ') : (justDone ?? '');
  return (
    <div
      role="status"
      aria-live="polite"
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: '0.5rem',
        padding: '0 0.75rem',
        height: '28px',
        borderRadius: '0.5rem',
        background: '#fff',
        boxShadow: 'inset 0 0 0 0.0625rem rgba(0,0,0,0.12)',
        color: '#303030',
        whiteSpace: 'nowrap',
      }}
    >
      {running.length > 0 ? (
        <s-spinner accessibilityLabel="Working" size="base" />
      ) : (
        <s-icon type="check-circle" size="small" />
      )}
      <span>{running.length > 0 ? `${text}…` : text}</span>
    </div>
  );
}
