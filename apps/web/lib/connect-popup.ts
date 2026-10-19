/** The message the small "connected" page sends to the app when a platform sign-in window finishes. */
export const CONNECT_MESSAGE = 'pi-ad-connect';

export interface ConnectMessage {
  type: typeof CONNECT_MESSAGE;
  provider: string | null;
  error: string | null;
}

/** True for a message from our own pages saying a platform sign-in finished. */
export function isConnectMessage(
  event: MessageEvent,
  ownOrigin: string,
): event is MessageEvent<ConnectMessage> {
  if (event.origin !== ownOrigin) return false;
  const d: unknown = event.data;
  return typeof d === 'object' && d !== null && (d as { type?: unknown }).type === CONNECT_MESSAGE;
}

/** The sign-in window: wide enough for the platform's login and permission screens. */
export const POPUP_FEATURES = 'popup=yes,width=620,height=780,left=200,top=60';
export const POPUP_NAME = 'pi-ad-connect';
