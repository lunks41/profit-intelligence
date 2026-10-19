'use client';

import { useEffect, useState } from 'react';
import { CONNECT_MESSAGE } from '../../lib/connect-popup';

/**
 * Where a platform sign-in window lands when it is over. It tells the app that opened it and closes itself. If the
 * window was not opened by the app (for example a bookmark), it just says so.
 */
export default function ConnectDone() {
  const [closed, setClosed] = useState(false);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    const q = new URLSearchParams(window.location.search);
    const error = q.get('connect_error');
    setFailed(Boolean(error));
    if (window.opener) {
      window.opener.postMessage(
        { type: CONNECT_MESSAGE, provider: q.get('connect'), error },
        window.location.origin,
      );
      window.close();
    }
    setClosed(true);
  }, []);
  return (
    <main
      style={{ maxWidth: '28rem', margin: '4rem auto', padding: '0 1rem', textAlign: 'center' }}
    >
      <h1 style={{ fontSize: '1.25rem' }}>
        {failed ? 'The platform was not connected' : 'Signed in'}
      </h1>
      <p>
        {closed
          ? 'You can close this window and go back to Tanvo Profit.'
          : 'Finishing the sign-in…'}
      </p>
    </main>
  );
}
