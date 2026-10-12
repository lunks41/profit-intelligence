/**
 * The message of Shopify itself (App Bridge toast), the way every Shopify app shows a short result. It appears in
 * the Shopify admin, outside the app, so it looks the same as in the rest of the admin. Outside the admin (a
 * local preview) there is nothing to show it, so it does nothing.
 */
export function showToast(message: string, options: { isError?: boolean; duration?: number } = {}) {
  try {
    window.shopify?.toast?.show(message, { duration: 5000, ...options });
  } catch {
    // a message is a courtesy; the work it talks about has happened either way
  }
}
