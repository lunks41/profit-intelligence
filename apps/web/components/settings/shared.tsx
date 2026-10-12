'use client';

import { useState } from 'react';
import { ApiRequestError } from '../../lib/api';

/** Runs a save action, tracks "busy", and turns a failure into a readable message. */
export function useAction() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function run<T>(fn: () => Promise<T>): Promise<T | null> {
    setBusy(true);
    setError(null);
    try {
      return await fn();
    } catch (e) {
      setError(
        e instanceof ApiRequestError && (e.status !== 0 || e.code === 'not_embedded')
          ? e.message
          : 'Could not save. Check your connection and try again.',
      );
      return null;
    } finally {
      setBusy(false);
    }
  }
  return { busy, error, run, clearError: () => setError(null) };
}

export function FormError({ message }: { message: string | null }) {
  return message ? (
    <s-banner tone="critical">
      <s-paragraph>{message}</s-paragraph>
    </s-banner>
  ) : null;
}

export function Saved({ text }: { text: string | null }) {
  return text ? (
    <s-banner tone="success">
      <s-paragraph>{text}</s-paragraph>
    </s-banner>
  ) : null;
}

/** Whether a string is a positive-or-zero money amount with at most 4 decimals. */
export const isAmount = (v: string) => /^\d{1,12}(\.\d{1,4})?$/.test(v.trim());
export const isPercent = (v: string) => /^\d{1,3}(\.\d{1,4})?$/.test(v.trim()) && Number(v) <= 100;

export const todayLocal = () => new Date().toISOString().slice(0, 10);

/**
 * The row of buttons at the foot of a form or dialog. Always at the right end, the way out (Cancel, Close,
 * Keep it) first and the main action last, so every screen puts Save where the eye expects it.
 */
export function FormActions({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        display: 'flex',
        justifyContent: 'flex-end',
        alignItems: 'center',
        flexWrap: 'wrap',
        gap: '0.5rem',
      }}
    >
      {children}
    </div>
  );
}
