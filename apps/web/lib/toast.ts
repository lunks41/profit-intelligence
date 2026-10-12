/**
 * Small messages at the top right of the app. `progress` shows a spinner until `finish` replaces it with a
 * result that goes away by itself; `info` is a plain message that goes away by itself. Drawn by <Toaster />.
 */
export interface ToastItem {
  id: number;
  text: string;
  state: 'busy' | 'done' | 'error' | 'info';
}

type Listener = (items: ToastItem[]) => void;

let items: ToastItem[] = [];
let next = 1;
const listeners = new Set<Listener>();
const timers = new Map<number, ReturnType<typeof setTimeout>>();

const emit = () => listeners.forEach((l) => l(items));

export function subscribeToasts(l: Listener): () => void {
  listeners.add(l);
  l(items);
  return () => {
    listeners.delete(l);
  };
}

export function dismissToast(id: number) {
  const t = timers.get(id);
  if (t) clearTimeout(t);
  timers.delete(id);
  items = items.filter((i) => i.id !== id);
  emit();
}

function expire(id: number, ms: number) {
  const t = timers.get(id);
  if (t) clearTimeout(t);
  timers.set(
    id,
    setTimeout(() => dismissToast(id), ms),
  );
}

export function toastInfo(text: string, ms = 4000): number {
  const id = next++;
  items = [...items, { id, text, state: 'info' }];
  emit();
  expire(id, ms);
  return id;
}

/** A message with a spinner, for work that is still going on. Returns the id to hand to `finishToast`. */
export function toastProgress(text: string): number {
  const id = next++;
  items = [...items, { id, text, state: 'busy' }];
  emit();
  return id;
}

export function finishToast(id: number, text: string, ok = true) {
  if (!items.some((i) => i.id === id)) return;
  items = items.map((i) => (i.id === id ? { ...i, text, state: ok ? 'done' : 'error' } : i));
  emit();
  expire(id, 4000);
}
