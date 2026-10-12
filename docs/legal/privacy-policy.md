# Privacy policy (draft for the owner to review)

This is the text used by the app's `/privacy` page. It describes what the app actually does, taken from `docs/privacy/retention.md`. The owner must add the legal entity name and the support email (the page reads `NEXT_PUBLIC_COMPANY_NAME` and `NEXT_PUBLIC_SUPPORT_EMAIL`) and have it reviewed before it is submitted to Shopify. It is not legal advice.

## What the app collects

- From your Shopify store: products, variants, costs Shopify holds, orders, line items, refunds and payment transactions, including payment fees Shopify reports. The destination **country code** of an order and the **weight** of products are kept only to choose a shipping cost rule.
- **No customer names, emails, street addresses or phone numbers are stored.** Each order keeps only a one-way key made from Shopify's customer id, so the app can tell which orders came from the same customer for lifetime value. The key cannot be turned back into the customer and is removed when Shopify asks for that customer to be erased.
- From you: product costs, fee and shipping rules, expenses, advertising account ids and access tokens you provide, report recipient email addresses, alert email addresses, and feedback you send.
- Operational data: sync jobs and webhook event records (topic, ids, status, never contents).

## How it is used

To calculate and show your profit, to send the reports and alerts you ask for, and to operate and secure the service.

## Who it is shared with

Not sold or shared for advertising. It is processed by the hosting and email providers needed to run the service. Advertising platforms are contacted only with the access token you give, to read your spend.

## Retention and deletion

Orders and related records for the last 90 days are kept while the app is installed. Report files are deleted after 7 days. After uninstall, the access token is removed at once and all shop data is deleted after 30 days, or immediately when Shopify sends `shop/redact`. Backups expire after 14 days.

## Security

Access tokens are encrypted at rest. Every request is tied to the signed Shopify session of one shop and the database separates shops with row-level security.

## Your rights and contact

Ask for access, correction or deletion at the support address. Customer data requests from Shopify are answered: nothing about a customer can be exported, and an erase request removes the customer's key from their orders.
