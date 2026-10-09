import type { DetailedHTMLProps, HTMLAttributes } from 'react';

// App Bridge navigation element (not covered by the Polaris types package).
type AppBridgeElement = DetailedHTMLProps<HTMLAttributes<HTMLElement>, HTMLElement>;

declare module 'react' {
  namespace JSX {
    interface IntrinsicElements {
      's-app-nav': AppBridgeElement;
    }
  }
}
