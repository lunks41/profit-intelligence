'use client';

import { useState } from 'react';
import { installUrl } from '../../lib/install-url';

/** Asks for the store name and sends the merchant to Shopify, which shows its own install screen. */
export function InstallForm({ clientId }: { clientId: string | undefined }) {
  const [store, setStore] = useState('');
  const [error, setError] = useState<string | null>(null);

  return (
    <form
      className="pi-landing-install"
      onSubmit={(e) => {
        e.preventDefault();
        const url = installUrl(store, clientId);
        if (!url) {
          setError(
            clientId
              ? 'Enter your store name, for example my-shop or my-shop.myshopify.com.'
              : 'Installing is not open yet.',
          );
          return;
        }
        setError(null);
        window.location.href = url;
      }}
    >
      <label htmlFor="pi-store" className="pi-landing-sr">
        Your Shopify store
      </label>
      <input
        id="pi-store"
        value={store}
        onChange={(e) => setStore(e.target.value)}
        placeholder="your-store.myshopify.com"
        autoComplete="off"
        spellCheck={false}
        aria-describedby={error ? 'pi-store-error' : undefined}
      />
      <button type="submit">Install on Shopify</button>
      {error && (
        <p id="pi-store-error" role="alert" className="pi-landing-error">
          {error}
        </p>
      )}
    </form>
  );
}
