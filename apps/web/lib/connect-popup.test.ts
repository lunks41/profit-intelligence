import { describe, expect, it } from 'vitest';
import { CONNECT_MESSAGE, isConnectMessage } from './connect-popup';

const msg = (origin: string, data: unknown) => ({ origin, data }) as MessageEvent;

describe('isConnectMessage', () => {
  it('accepts the message from our own origin', () => {
    expect(
      isConnectMessage(
        msg('https://app.example', { type: CONNECT_MESSAGE }),
        'https://app.example',
      ),
    ).toBe(true);
  });
  it('ignores other origins and other messages', () => {
    expect(
      isConnectMessage(
        msg('https://evil.example', { type: CONNECT_MESSAGE }),
        'https://app.example',
      ),
    ).toBe(false);
    expect(
      isConnectMessage(msg('https://app.example', { type: 'other' }), 'https://app.example'),
    ).toBe(false);
    expect(isConnectMessage(msg('https://app.example', 'text'), 'https://app.example')).toBe(false);
    expect(isConnectMessage(msg('https://app.example', null), 'https://app.example')).toBe(false);
  });
});
