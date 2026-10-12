import type { ReactNode } from 'react';

/** One column with the same gap between every card on a page. */
export function PageBody({ children }: { children: ReactNode }) {
  return <s-stack gap="small">{children}</s-stack>;
}
