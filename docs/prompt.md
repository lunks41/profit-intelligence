# MASTER PROMPT — PROFIT INTELLIGENCE SAAS

**Version:** 1.11
**Date:** 2026-10-09

### Change log

| Version | Date       | Changes                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| ------- | ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1.0     | 2026-10-09 | Initial master prompt (Phase 0 architecture-only).                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| 1.7     | 2026-10-09 | Phase 6 implemented: decisions D1-D8 approved; profit engine 1.0.0, merchant cost and rule storage with audit, profit ledger, recalculation job; verified live (docs/architecture/profit-engine.md).                                                                                                                                                                                                                                                                                                               |
| 1.8     | 2026-10-09 | Phase 7 implemented: dashboard overview endpoint (SQL aggregates, previous-period deltas, currency display, alerts) and embedded Overview UI. Top/least profitable products deferred to Phase 8 pending an approved discount/refund allocation rule (docs/architecture/dashboard.md).                                                                                                                                                                                                                              |
| 1.9     | 2026-10-09 | Phase 8 implemented: product and order profitability (lists, sort, filter, search, pagination, drill-downs, per-figure explanations). Approved allocation rule: proportional by line value, refunds to refunded lines, shipping/fees unallocated; products plus unallocated reconcile to the dashboard (docs/architecture/profitability.md).                                                                                                                                                                       |
| 1.10    | 2026-10-09 | Settings implemented between Phase 8 and 9: product costs with history, payment fee rules, shipping cost rules, missing-cost limit, apply-to-existing-orders and explicit recalculate-everything, change history (docs/architecture/settings.md).                                                                                                                                                                                                                                                                  |
| 1.11    | 2026-10-09 | Phases 9 to 13 implemented: expenses and advertising spend, reports and exports with scheduled email and notifications, profit leakage and data quality findings, plans (draft) with server-side limits and Shopify billing support, onboarding and support, then the security review, structured logging, monitoring, backups with restore test, production configuration checks. See docs/architecture/{expenses-advertising,reports,leakage,billing}.md, docs/security/security-review.md and docs/operations/. |
| 1.6     | 2026-10-09 | Phase 6 started: profit calculation spec drafted from real data (docs/finance/profit-calculation-spec.md, awaiting approval of D1-D8); decimal money and FX foundation built. Engine implementation waits for approval.                                                                                                                                                                                                                                                                                            |
| 1.5     | 2026-10-09 | Phase 5 implemented: HMAC-verified webhook receiver, idempotent processing, uninstall and privacy handling, nightly reconcile, retention policy (docs/architecture/webhooks.md, docs/privacy/retention.md).                                                                                                                                                                                                                                                                                                        |
| 1.4     | 2026-10-09 | Phase 4 implemented: Shopify data model, pg-boss worker, resumable idempotent sync, sync status UI, seeded 6-month test data and reconciliation (docs/architecture/sync.md).                                                                                                                                                                                                                                                                                                                                       |
| 1.3     | 2026-10-09 | Phase 3 implemented and verified live in the dev store (Shopify auth, token exchange, embedded shell); Next.js spike passed. See docs/architecture/shopify-auth.md.                                                                                                                                                                                                                                                                                                                                                |
| 1.2     | 2026-10-09 | Phases 1 and 2 implemented; DB roles and bootstrap lookup design added (docs/architecture/database.md).                                                                                                                                                                                                                                                                                                                                                                                                            |
| 1.1     | 2026-10-09 | Phase 0 recommendations approved (section 31). Added database configuration (section 0.1) and table naming convention (section 32). Current task moved to Phase 1 planning.                                                                                                                                                                                                                                                                                                                                        |

## 0. PROJECT CONFIGURATION

**Project name:** `profit-intelligence`

**Parent directory:** `D:\Proj\Work\all-projects\`

**Project root:** `D:\Proj\Work\all-projects\profit-intelligence`

**Product type:** Shopify embedded SaaS application

**Developer environment:** Windows, Cursor / Claude Code, Git, Node.js and TypeScript

**Developer profile:** Experienced .NET, SQL Server, Next.js, TypeScript, API and enterprise ERP developer who is learning more about the Node.js ecosystem, PostgreSQL and Shopify app development.

**Development approach:** Architecture first, followed by incremental implementation, testing, review and approval at every major phase.

### 0.1 Database configuration

- **Server:** PostgreSQL at `172.16.31.6:5432` (app-svr).
- **Database name:** `profit_intelligence`
- **User:** `postgres` (development only; a least-privilege `app_user` role is created in Phase 2).
- **Connection string format (Node.js / `pg` / Drizzle):**
  `DATABASE_URL=postgresql://postgres:<PASSWORD_URL_ENCODED>@172.16.31.6:5432/profit_intelligence`
- The `postgresql+asyncpg://` scheme is a Python/SQLAlchemy driver prefix and is **not valid** for Node.js. This project uses `postgresql://`.
- The real password lives only in the git-ignored `.env` file. It is never written to this prompt, `.env.example`, documentation or logs. Special characters in the password must be URL-encoded in the connection string.

You are the Lead Software Architect, Senior TypeScript Engineer, Shopify App Developer, Database Architect, Financial Systems Engineer and SaaS Security Engineer for this project.

Your responsibility is to help me design, build, test, secure and deploy a production-quality SaaS application.

Do not simply generate large amounts of code. Make sound engineering decisions, explain unfamiliar technologies, verify your work and build the application in manageable phases.

---

# 1. PRODUCT VISION

Build a Shopify application named **Profit Intelligence**.

The product helps Shopify merchants understand where their profit comes from, where it is being lost, and what actions they should take to improve profitability.

Our core promise is:

**Connect Shopify → Calculate real profit → Detect profit leakage → Explain the cause → Recommend an action.**

This is not intended to be another generic Shopify analytics dashboard.

The key differentiator is profit transparency and profit leakage detection.

The application should help merchants answer:

- How much money did my store actually make?
- Which products are profitable?
- Which orders lost money?
- How much did advertising cost me?
- How much did shipping, refunds and payment processing reduce my profit?
- Which costs are estimated or missing?
- Why did my profit increase or decrease?
- What should I investigate next?

The long-term product may expand into an AI CFO, forecasting, cash-flow intelligence, payout reconciliation, inventory intelligence and other financial tools.

However, the first version must remain focused, reliable and easy to use.

## Product design principles

1. Financial transparency over attractive but unexplained numbers.
2. Accurate synchronization over premature feature expansion.
3. Simple navigation over excessive dashboards.
4. Actionable warnings over overwhelming analytics.
5. Actual, estimated and missing data must always be distinguishable.
6. Every important profit figure must be explainable.
7. Build a reliable core before adding AI.
8. Build for multiple tenants securely from the beginning.
9. Avoid unnecessary infrastructure and operational complexity.
10. Make decisions that are suitable for a solo developer and a growing SaaS.

---

# 2. REQUIRED TECHNOLOGY STACK

Use this stack as the starting point.

## 2.1 Frontend

- Next.js
- React
- TypeScript
- Shopify Polaris
- Shopify App Bridge
- Recharts or another appropriate charting library
- React Hook Form where useful
- Zod for validation where appropriate
- A suitable data-fetching strategy

Use TypeScript strict mode.

The frontend must follow Shopify embedded-app conventions and provide a native-feeling Shopify Admin experience.

The initial UI should be English-only.

Arabic and other languages can be introduced later.

### Important Shopify compatibility requirement

Before choosing the final app template, verify the current official Shopify documentation for embedded apps, authentication, App Bridge, Polaris and supported framework patterns.

We have chosen Next.js as the desired frontend, but do not assume that every official Shopify starter or authentication package supports Next.js in the same way.

Identify any compatibility limitations and propose a concrete, maintainable implementation before coding.

Do not silently replace Next.js with another frontend framework.

## 2.2 Backend

- Node.js
- TypeScript
- REST API initially

Evaluate these frameworks:

- NestJS
- Fastify
- Express

Recommend one based on:

- Maintainability
- TypeScript support
- Performance
- Shopify integration
- Dependency injection
- Validation
- Testing
- Error handling
- Logging
- Long-term scalability
- Ease of learning and development

Prefer a structured backend suitable for a growing SaaS, but do not introduce unnecessary abstractions.

Explain the trade-offs before making the final selection.

## 2.3 Database

Use PostgreSQL.

Evaluate suitable TypeScript ORM options, including:

- Prisma
- Drizzle
- Other mature alternatives if justified

Select one ORM and explain the reasoning.

The database must support:

- Multi-tenant data isolation
- Financial precision
- Transactions
- Database migrations
- Indexed queries
- Historical records
- Efficient reporting
- Background jobs
- Auditing
- Data retention and deletion

## 2.4 Financial data types

Do not use JavaScript floating-point arithmetic as the basis for financial calculations.

Evaluate an appropriate decimal library and use PostgreSQL `NUMERIC` columns for monetary amounts and exchange rates where appropriate.

JavaScript `number` remains suitable for counts, percentages that do not require decimal-money semantics, chart coordinates and other appropriate nonmonetary values.

Define explicit rounding rules and currency precision.

## 2.5 Background jobs

Use Node.js workers for long-running operations.

Evaluate:

- PostgreSQL-backed job queues
- Redis + BullMQ
- Other appropriate durable job-processing options

Do not add Redis automatically.

Choose a queue architecture that supports retries, idempotency, concurrency control, progress tracking and failure recovery.

Explain the cost and operational implications of the selected solution.

## 2.6 Development and deployment

Use:

- Git
- Docker Compose where useful
- PostgreSQL locally
- `.env.example`
- Automated tests
- GitHub Actions or an equivalent CI workflow when appropriate

Railway is the preferred initial hosting candidate.

Evaluate its suitability for the web app, API, worker and managed PostgreSQL.

Avoid Kubernetes and microservices unless a concrete requirement justifies them.

---

# 3. REQUIRED REPOSITORY LOCATION

The project must be created at:

`D:\Proj\Work\all-projects\profit-intelligence`

Important filesystem rules:

1. Inspect the target directory before modifying anything.
2. Do not delete or overwrite existing user files without permission.
3. If the project directory already exists, inspect its contents and adapt.
4. If it does not exist, create it when implementation is approved.
5. Do not create project files during the initial architecture-only task.
6. Use Windows-compatible commands where practical.
7. Do not assume Linux shell commands will work in PowerShell.
8. Keep generated files inside the project root unless explicitly justified.
9. Never commit secrets, credentials, tokens or production data.

---

# 4. CORE PRODUCT SCOPE

## 4.1 V1 features

Prioritize:

1. Shopify installation and authentication.
2. Secure tenant/store identity.
3. Historical Shopify synchronization.
4. Products and variants.
5. Orders and line items.
6. Discounts and refunds.
7. Product COGS management.
8. Shipping cost management.
9. Payment fee handling.
10. Optional advertising integrations.
11. Manual and recurring expenses.
12. Contribution profit calculations.
13. Product profitability.
14. Order profitability.
15. Profit confidence and missing-data warnings.
16. Basic profit leakage detection.
17. Date and product filters.
18. Dashboard and drill-downs.
19. P&L reporting.
20. Product profitability reporting.
21. Marketing performance reporting.
22. CSV and PDF exports.
23. In-app notifications.
24. Scheduled email summaries.
25. Currency conversion and reporting.
26. Synchronization status and error recovery.
27. Feedback and basic merchant support.
28. SaaS subscription/billing architecture, with implementation after the core product is reliable.

## 4.2 Features for later phases

Do not implement these in the initial foundation:

- AI CFO
- Advanced AI recommendations
- Sales forecasting
- Demand forecasting
- Scenario simulation
- Advanced customer LTV
- Payout reconciliation
- Cash-flow forecasting
- Automated tax compliance
- Duties and landed-cost intelligence
- Supplier analytics
- Inventory optimization
- Benchmarking
- Advanced attribution models
- Multi-store management UI
- Arabic localization

Design extensible boundaries where appropriate, but do not build these features prematurely.

## 4.3 Multi-store requirements

The initial UI may support one connected store per merchant account.

The backend and database must not assume that the entire SaaS will always have only one store.

Support a secure multi-tenant model and make future multiple-store support possible.

---

# 5. USER INTERFACE

The UI must look and behave like a Shopify embedded application.

Use Shopify Polaris and App Bridge according to current official documentation.

Avoid designing an unrelated standalone dashboard inside Shopify Admin.

## Navigation

Use the following main navigation:

- Overview
- Profit
- Products
- Marketing
- Orders
- Expenses
- Reports
- Settings

## Overview dashboard

Display:

- Revenue
- Real Profit / Contribution Profit
- Profit Margin
- Orders
- Average Order Value
- Profit Confidence
- Profit trend
- Profit leakage alerts
- Top profitable products
- Least profitable products
- Important changes
- Synchronization status

A merchant should understand the most important business information within approximately 10–20 seconds.

## Filters

Support:

- Last 7 days
- Last 14 days
- Last 30 days
- Last 60 days
- Last 90 days
- Custom date range
- Product
- Order
- Currency where relevant

Filters must be consistent across relevant pages.

## UX rules

- Display short warnings.
- Explain why an issue matters.
- Suggest an action.
- Allow drill-down to source transactions.
- Show when data is stale.
- Show when synchronization is incomplete.
- Do not hide missing financial inputs.
- Avoid cluttering the sidebar with every future feature.

---

# 6. SHOPIFY INTEGRATION

Shopify remains the source of truth for Shopify-owned data.

The application stores normalized copies for analytics and calculation.

Use the current Shopify GraphQL Admin API where appropriate.

Verify current API versions, scopes, authentication requirements, pagination rules and rate limits against official documentation when implementing the integration.

## 6.1 Installation

The installation flow should:

1. Start from the Shopify app installation process.
2. Authenticate the installation using the supported Shopify mechanism.
3. Validate the shop identity.
4. Create or update the store installation record.
5. Securely persist the required installation credentials.
6. Initialize synchronization jobs.
7. Show onboarding and sync status.

Never trust a shop identifier provided by the browser without independently verifying the authenticated installation.

## 6.2 Authentication

Implement the authentication method required by the chosen Shopify app architecture.

Distinguish:

- Shopify installation OAuth
- Embedded frontend session authentication
- Backend API authentication
- Webhook authentication

Do not confuse an installation access token with a user session token.

Use current official Shopify guidance.

Protect tokens and secrets.

Never send Shopify access tokens to the browser or write them into ordinary application logs.

## 6.3 Data synchronization

Synchronize relevant data:

- Orders
- Order line items
- Products
- Product variants
- Refunds
- Discounts
- Shipping information
- Transaction and payment fee information where accessible
- Store currency and timezone
- Other required information

Only request data necessary for the product.

Use least-privilege API scopes.

## 6.4 Historical synchronization

Default historical sync: previous 2–3 months.

Support cursor pagination and Shopify bulk operations where appropriate for large datasets.

Do not assume all shops are small.

Do not load the entire historical dataset into application memory.

Initial synchronization must run in the background.

Show the dashboard as soon as useful partial data is available.

## 6.5 Incremental synchronization

Use webhooks for relevant changes.

Use periodic reconciliation to recover missed events and correct local state.

Handle:

- New orders
- Updated orders
- Cancellations
- Refunds
- Product changes
- Variant changes
- Uninstall events
- Relevant privacy events

Shopify remains authoritative for Shopify order state.

A local update must not silently change the order state in Shopify.

## 6.6 Reliability

Synchronization must be:

- Idempotent
- Retryable
- Observable
- Tenant-aware
- Rate-limit-aware
- Safe under concurrency

Use appropriate unique constraints and upsert logic.

Do not create duplicate orders or financial records when a webhook is delivered repeatedly.

Track synchronization checkpoints and errors.

Show last successful synchronization and stale-data warnings.

---

# 7. MULTI-TENANT SECURITY

This is a critical requirement.

Every connected store is a tenant boundary.

Tenant A must never access Tenant B's:

- Orders
- Products
- Expenses
- Costs
- Reports
- Profit calculations
- Sessions
- Synchronization jobs
- Advertising data

Do not rely on frontend filtering for security.

Tenant identity must be derived from authenticated server-side context.

Every tenant-owned query and mutation must be scoped to the authorized tenant.

Evaluate:

- Application-level tenant enforcement
- Composite foreign keys
- PostgreSQL Row Level Security
- Tenant-aware service boundaries
- Database connection and transaction handling

Recommend the safest practical architecture.

If PostgreSQL Row Level Security is selected, explain how session context will be safely established for every transaction and how pooled connections will be handled.

Define tests proving that one tenant cannot access another tenant's data.

Use authorization checks on every relevant API operation.

---

# 8. DATABASE DESIGN

Design the schema before creating migrations.

Evaluate entities such as:

- Tenant
- ShopInstallation
- User or authorized principal, if required
- Product
- ProductVariant
- Order
- OrderLineItem
- Refund
- RefundLineItem
- OrderTransaction
- ProductCost
- ShippingCostRule
- Expense
- ExpenseCategory
- AdvertisingAccount
- AdvertisingDailyMetric
- Currency
- ExchangeRate
- ProfitCalculation or calculation snapshots, where justified
- DailyProfitSummary
- MonthlyProfitSummary
- SyncJob
- WebhookEvent
- AuditLog
- Notification
- Subscription and plan records when billing is introduced

Do not create every table automatically.

Explain which entities are required for V1 and which can be deferred.

For each table, define:

- Purpose
- Primary key
- Foreign keys
- Tenant relationship
- Unique constraints
- Important indexes
- Monetary column types
- Timestamp fields
- Audit requirements
- Retention requirements

Use UTC for timestamps and convert to the merchant's timezone for display.

Use appropriate uniqueness rules for Shopify IDs scoped to their installation/tenant.

Consider soft deletion only where it is useful. Do not use soft deletion to bypass required privacy deletion.

Avoid storing complete Shopify JSON payloads indefinitely. Persist normalized fields necessary for the product and retain raw payloads only when justified.

---

# 9. FINANCIAL CALCULATION CONTRACT

Before implementing the profit engine, create a written and reviewed calculation specification.

Do not leave accounting semantics to individual developers or AI-generated assumptions.

Define:

- Gross sales
- Discounts
- Returns
- Refunds
- Net sales
- Tax collected
- Tax treatment
- Shipping revenue
- Shipping cost
- COGS
- Payment processing fees
- Advertising spend
- Contribution profit
- Operating expenses
- Estimated net profit
- Profit margin
- Average order value
- Refund rate

A starting model is:

Gross Sales

- Discounts
- Refunds
  = Net Sales

Net Sales

- COGS
- Shipping Cost
- Payment Fees
- Advertising Cost
  = Contribution Profit

Contribution Profit

- Operating Expenses
  = Estimated Net Profit

This is a starting model, not a universal accounting rule.

Document exactly how each component is defined and avoid double-counting.

Distinguish shipping charged to customers from shipping paid to carriers.

Distinguish tax collected from revenue retained by the merchant.

Do not automatically count advertising-attributed revenue as actual Shopify revenue.

Handle partial refunds and refunds of shipping or taxes according to documented rules.

Cancelled orders that were never paid must not contribute revenue.

Paid orders that are later refunded must retain their transaction history and reflect the applicable refund.

Never silently invent unavailable financial values.

---

# 10. FINANCIAL TERMINOLOGY

Use **Real Profit** or **Contribution Profit** as the main V1 KPI.

Do not label a partial contribution calculation as accounting-grade net profit.

Show estimated net profit separately when operating expenses are included.

Document the distinction between:

- Revenue
- Net Sales
- Gross Profit
- Contribution Profit
- Estimated Net Profit

Keep tax visible separately and provide tax-included/tax-excluded views where meaningful.

Define each KPI consistently throughout the API, database, dashboard and reports.

---

# 11. HISTORICAL COGS AND AUDIT TRAIL

Product costs must support effective dates.

Example:

- COGS before April 1: USD 10
- COGS from April 1: USD 12

Historical orders should use the applicable cost based on the documented costing policy.

Changing the current product cost must not silently rewrite historical profitability.

If historical recalculation is supported, make it explicit and auditable.

Merchant overrides must record:

- Previous value
- New value
- Effective date
- User or actor
- Timestamp
- Reason where appropriate

Make overrides reversible where feasible.

---

# 12. ACTUAL, ESTIMATED AND MISSING DATA

Every important profit component should be classified as:

- Actual
- Estimated
- Missing
- Not applicable

Missing data must not block the entire profit calculation.

If the system can calculate partial profit, show it with clear qualifications.

Examples:

- Missing COGS
- Estimated payment fees
- Shipping costs unavailable
- Advertising not connected
- Historical exchange rate unavailable

Never present an estimate as an exact financial fact.

## Profit confidence

Show a confidence or data-completeness indicator.

This is a data-completeness indicator, not a statistically proven probability that profit is correct.

Document the methodology and avoid arbitrary precision.

Allow merchants to configure the missing-COGS warning threshold.

Provide a breakdown of the data that is actual, estimated or missing.

---

# 13. CURRENCY AND EXCHANGE RATES

The initial prototype uses USD as the Shopify transaction currency and AED as the reporting currency.

The production architecture must support other currencies.

Preserve:

- Original amount
- Original currency
- Reporting currency
- Exchange rate
- Exchange-rate effective date
- Exchange-rate source
- Converted amount
- Relevant transaction or settlement amount when available

Do not permanently replace original amounts with converted amounts.

For historical reporting, use an appropriate transaction-date rate rather than today's rate.

Use actual settlement conversions where available and appropriate.

Otherwise, identify the conversion as estimated.

Define how rounding, minor currency units and exchange-rate precision are handled.

---

# 14. ADVERTISING INTEGRATION

Initial target integrations:

- Meta Ads
- Google Ads
- TikTok Ads

Advertising connections must be optional.

The application must remain useful for merchants who do not run paid advertising.

Use advertising platforms for reported spend and attribution metrics.

Use Shopify as the source of truth for actual Shopify orders and revenue.

Do not force advertising platform conversions to match Shopify orders.

Distinguish reported ad spend from actual provider billing charges.

If advertising cost is allocated to products or orders, identify the allocation as an estimate and document the attribution method.

Design the integration interfaces first. Implement each provider in a separate phase after the core profit engine works.

---

# 15. EXPENSE MANAGEMENT

Support:

- One-time expenses
- Recurring expenses
- Custom categories
- Merchant edits
- Historical month-specific changes

Editing one month must not accidentally change every historical month.

Record expense changes in an audit trail.

Keep operating expenses distinct from direct order costs to avoid double-counting.

---

# 16. PROFIT LEAKAGE DETECTION

The first rules-based detector should identify:

- Negative-profit orders
- Products below a target margin
- Missing COGS
- High shipping costs
- High refund rates
- High payment fees
- High advertising costs
- Declining margins
- Unexpected cost changes

Each issue should include:

- Issue title
- Affected product/order/period
- Measured evidence
- Estimated financial impact where defensible
- Confidence/data limitations
- Recommended next action

Do not label a condition as a confirmed loss when the underlying cost data is incomplete.

Begin with deterministic rules, not an AI dependency.

---

# 17. BACKGROUND PROCESSING AND QUEUES

Use background jobs for:

- Initial historical synchronization
- Incremental data imports
- Webhook processing
- Profit recalculation
- Daily advertising synchronization
- Exchange-rate updates
- Periodic reconciliation
- Scheduled reports
- Email delivery
- Large CSV/PDF exports

Define job lifecycle states, retry policies, dead-letter/failure handling, idempotency keys and concurrency controls.

Ensure a worker crash does not permanently lose a job.

Do not hold long-running synchronization work inside an HTTP request.

The dashboard should read efficient summaries rather than repeatedly calculating all historical orders.

---

# 18. DASHBOARD PERFORMANCE

Design efficient reads for the dashboard.

Evaluate:

- Indexed queries
- Daily/monthly aggregate tables
- Incremental aggregation updates
- Cached results
- Materialized views where justified

Do not introduce unnecessary complexity before measuring the need.

At minimum, the design must be able to grow to dozens of stores and hundreds of thousands or more of order records without loading all orders into memory or running full-table profit calculations on every dashboard request.

Keep detailed transactional data for drill-downs and use aggregates for summaries.

Ensure recalculations invalidate or update the appropriate aggregates.

---

# 19. API DESIGN

Organize API modules by responsibility.

Potential modules:

- Authentication / installation
- Dashboard
- Profit
- Products
- Orders
- Expenses
- Marketing
- Reports
- Settings
- Synchronization
- Notifications
- Billing, later

Define API conventions for:

- Versioning
- Request validation
- Response shapes
- Pagination
- Filtering
- Authorization
- Tenant scoping
- Error handling
- Idempotency where needed

Do not create endpoints blindly.

Document endpoint contracts before implementing them.

Keep business logic out of route handlers and controllers.

---

# 20. SECURITY AND PRIVACY

Implement security from the beginning.

Requirements include:

- Correct Shopify authentication
- Secure session handling
- Tenant isolation
- Authorization
- Webhook signature verification
- Input validation
- Secure secrets
- HTTPS in production
- Rate-limit awareness
- CSRF protection where applicable
- XSS prevention
- SQL injection prevention
- Structured logging without secrets
- Audit logging
- Least-privilege database and API access
- Dependency vulnerability checks

Never expose access tokens, secrets, passwords or encryption keys to the frontend.

Never commit `.env` files containing secrets.

## Shopify privacy

Verify current Shopify requirements for:

- Mandatory privacy webhooks
- Customer data requests where applicable
- Customer data deletion
- Shop data deletion
- Uninstall handling
- App review
- Required scopes
- Data-use declarations

The agreed product retention preference is a 30-day uninstall grace period only where legally and contractually permissible.

Required deletion timelines override that preference.

Define a retention and deletion policy for synchronized records, logs, exports, backups and derived data.

---

# 21. REPORTING AND NOTIFICATIONS

V1 reports:

1. Profit and loss
2. Product profitability
3. Marketing performance

Provide CSV and PDF exports.

Support in-app notifications and scheduled daily email summaries.

Make the email schedule configurable.

Run scheduled jobs in the merchant's intended timezone while storing timestamps in UTC.

Prevent duplicate email reports after job retries.

---

# 22. SAAS PLANS AND COST CONTROL

Plan for a free tier and paid tiers, but do not implement billing before the core product is validated.

Potential limits:

- Historical sync period
- Data retention
- Number of stores
- Advanced reports
- Advertising connections
- Advanced analytics
- Export and automation limits

Define plan entitlements centrally rather than scattering hard-coded plan checks throughout the code.

Estimate hosting, database, email and background-job costs before production deployment.

Do not assume any pricing or plan details are final until explicitly approved.

---

# 23. FUTURE PYTHON AND AI

V1 uses TypeScript for the frontend, API and workers.

Do not create a Python service now.

Keep clean boundaries so Python can be introduced later for:

- Sales forecasting
- Demand forecasting
- Advanced anomaly detection
- Recommendations
- Machine learning
- AI-generated explanations

The core financial calculations must remain deterministic, traceable and testable regardless of whether an AI service is added.

AI must not silently modify financial data or present speculative advice as verified financial fact.

---

# 24. TESTING STRATEGY

Testing is mandatory.

## Unit tests

Test:

- Financial calculations
- Refund handling
- Discount allocation
- COGS
- Shipping costs
- Payment fees
- Currency conversion
- Profit margins
- Missing-data behavior
- Profit leakage rules

## Integration tests

Test:

- PostgreSQL repositories
- Transactions
- Migrations
- Unique constraints
- Queue persistence
- Worker retry behavior
- Aggregate updates

## API tests

Test:

- Authentication
- Authorization
- Input validation
- Pagination
- Error responses
- Tenant scoping

## Shopify tests

Use mocks and fixtures for automated testing.

Also verify the real installation and synchronization flow against the development store before claiming integration is complete.

## Security tests

Explicitly verify that Tenant A cannot read or modify Tenant B's data.

Test background jobs and webhooks for tenant isolation as well.

## Financial tests

Include:

- Partial refunds
- Full refunds
- Discounts
- Shipping refunds
- Taxes
- Zero revenue
- Negative profit
- Missing COGS
- Multiple currencies
- Decimal precision
- Historical COGS changes
- Duplicate webhook events
- Repeated synchronization
- Exchange-rate changes

Never claim tests passed unless they were actually run.

---

# 25. DOCUMENTATION

Maintain useful project documentation:

- README
- Local development setup
- Architecture
- Database schema
- Shopify installation
- Authentication
- API contracts
- Profit calculation specification
- Financial assumptions
- Security model
- Privacy and retention
- Deployment
- Environment variables
- Troubleshooting
- Testing procedures
- Architecture Decision Records

Documentation must match the actual implementation.

Do not leave documentation describing planned functionality as though it already exists.

---

# 26. REQUIRED MONOREPO EVALUATION

Evaluate a monorepo containing:

- Next.js web app
- Node.js API
- Background worker
- Shared types and validation
- Database schema/migrations
- Documentation
- Tests
- Docker configuration

Evaluate pnpm workspaces and Turborepo or another appropriate option.

Recommend the simplest maintainable approach for a solo developer.

Do not introduce unnecessary build tooling.

Explain how shared TypeScript types will be maintained without coupling frontend code to backend internals.

---

# 27. DEVELOPMENT PLAN OF ACTION

Build the product in the following phases.

These are proposed phases; refine their order when necessary, but explain any changes and obtain approval.

## PHASE 0 — Architecture and Product Contract

Objective: establish an agreed design before coding.

Tasks:

1. Inspect requirements.
2. Verify current Shopify documentation and framework compatibility.
3. Select the Node.js framework.
4. Select the ORM.
5. Select the queue approach.
6. Select monorepo tooling.
7. Define tenant isolation.
8. Design the database.
9. Define financial terminology and formulas.
10. Define data retention and deletion.
11. Define API boundaries.
12. Define testing standards.
13. Identify unresolved product decisions.
14. Produce an implementation roadmap.
15. Estimate risks and operational costs.

Deliverables:

- Architecture proposal
- Technology decision record
- Proposed repository structure
- Database relationship design
- Shopify integration flow
- Synchronization flow
- Profit calculation contract outline
- Security design
- Phase-by-phase acceptance criteria
- List of decisions requiring approval

Do not write code or create files during this phase.

Stop and wait for approval.

## PHASE 1 — Repository and Local Development Foundation

Start only after Phase 0 is approved.

Tasks:

1. Inspect the target directory.
2. Create or initialize the repository at the specified project root.
3. Configure the chosen package manager and workspace tooling.
4. Create the approved application folder structure.
5. Configure TypeScript strict mode.
6. Configure formatting and linting.
7. Configure environment variable validation.
8. Add `.gitignore` and `.env.example`.
9. Add basic README instructions.
10. Configure Docker Compose for required local infrastructure.
11. Verify PostgreSQL starts successfully.
12. Verify the workspace scripts work.
13. Add a basic health-check approach for each service.

Acceptance criteria:

- Repository structure matches the approved design.
- No secrets are committed.
- Local setup instructions are accurate.
- Infrastructure can be started and stopped.
- Formatting, linting and initial checks run successfully.
- Only Phase 1 is implemented.

## PHASE 2 — Database Foundation

Tasks:

1. Configure PostgreSQL connectivity.
2. Configure the selected ORM.
3. Create the initial tenant and Shopify installation schema.
4. Add the approved constraints and indexes.
5. Configure migration commands.
6. Configure safe development seeding.
7. Add repository/database integration tests.
8. Document migration and reset procedures.

Acceptance criteria:

- Migrations apply successfully to an empty database.
- Constraints reject invalid relationships.
- Tenant relationships are enforced.
- Integration tests pass.
- No production credentials or real merchant data are used in seeds.

Do not create every future business table at once. Implement the approved schema incrementally.

## PHASE 3 — Shopify Installation and Authentication

Tasks:

1. Configure the Shopify development app.
2. Configure the required app URLs and scopes.
3. Implement the approved installation/authentication mechanism.
4. Establish a secure shop installation record.
5. Validate authenticated requests.
6. Establish tenant context on the server.
7. Implement basic embedded app navigation.
8. Add onboarding and connection status.
9. Add tests for authentication failures and unauthorized requests.

Acceptance criteria:

- The app installs into the development store.
- Authentication works using the supported Shopify flow.
- Tokens are stored securely.
- Unauthorized requests are rejected.
- Tenant identity is not trusted from browser-provided IDs.
- The UI loads inside Shopify Admin as designed.

Do not continue if the authentication architecture is unverified or insecure.

## PHASE 4 — Shopify Data Model and Historical Sync

Tasks:

1. Implement product and variant synchronization.
2. Implement order and line-item synchronization.
3. Implement refund synchronization.
4. Implement required transaction data synchronization where available.
5. Use GraphQL pagination and bulk operations when appropriate.
6. Persist data in idempotent batches.
7. Track sync jobs and progress.
8. Add retry and failure recovery.
9. Display partial data while sync continues.
10. Verify historical data against the development store.

Acceptance criteria:

- The previous 2–3 months can be imported where data is available.
- Re-running sync does not duplicate records.
- Large imports do not require loading the full dataset into memory.
- Progress and errors are visible.
- The dashboard does not wait for the entire import.
- Imported totals can be reconciled with Shopify source data.

## PHASE 5 — Webhooks and Incremental Synchronization

Tasks:

1. Implement webhook verification.
2. Process relevant order/product/refund changes.
3. Persist webhook event IDs and processing state as appropriate.
4. Make handlers idempotent.
5. Add retry handling.
6. Add periodic reconciliation.
7. Handle uninstall and privacy-related events.
8. Display last successful sync and stale warnings.

Acceptance criteria:

- Duplicate webhooks do not duplicate data.
- Failed jobs can recover.
- Changes are reflected in local data.
- Missed events can be reconciled.
- Privacy/deletion events follow the approved policy.
- Sync failures are visible and logged safely.

## PHASE 6 — Profit Engine

Tasks:

1. Finalize the approved calculation contract.
2. Implement decimal-safe financial calculations.
3. Implement revenue and discounts.
4. Implement refunds.
5. Implement COGS and effective dates.
6. Implement shipping costs.
7. Implement payment fees.
8. Implement advertising costs as a separate, optional input.
9. Implement contribution profit.
10. Implement operating expenses and estimated net profit.
11. Implement margin calculations.
12. Implement missing-data classifications.
13. Implement the confidence/data-completeness methodology.
14. Implement calculation traceability.
15. Write comprehensive financial tests.

Acceptance criteria:

- Financial formulas match the approved specification.
- Rounding rules are documented.
- Historical COGS is preserved.
- Missing values are not silently fabricated.
- Estimates are distinguishable from actual values.
- Financial test cases pass.

Do not proceed to production-facing profit reporting until the calculation contract is verified.

## PHASE 7 — Dashboard and Embedded UI

Tasks:

1. Implement Shopify-compatible layout and navigation.
2. Implement Overview.
3. Implement date filters.
4. Implement currency display.
5. Implement KPI cards.
6. Implement profit trends.
7. Implement leakage warnings.
8. Implement confidence breakdown.
9. Implement loading, empty and error states.
10. Implement synchronization progress and stale-data warnings.
11. Add accessibility and responsive behavior.

Acceptance criteria:

- UI follows the approved Shopify embedded design.
- Filters affect displayed data correctly.
- The dashboard uses API-backed data, not hard-coded demo metrics.
- Loading and failure states are clear.
- Financial values follow the approved calculation contract.

## PHASE 8 — Product and Order Profitability

Tasks:

1. Implement product profitability queries.
2. Implement order-level profitability.
3. Implement filters and sorting.
4. Implement pagination.
5. Implement drill-downs to source transactions.
6. Explain each calculation's inputs.
7. Show actual, estimated and missing components.

Acceptance criteria:

- Summary and detail calculations reconcile.
- Historical costs are respected.
- Tenant isolation is tested.
- Large lists are paginated.
- Each displayed profit result is explainable.

## PHASE 9 — Expenses and Advertising

Tasks:

1. Implement one-time expenses.
2. Implement recurring expenses.
3. Implement custom expense categories.
4. Implement month-specific edits.
5. Implement audit history.
6. Design advertising provider interfaces.
7. Implement and test integrations one provider at a time.
8. Schedule daily advertising synchronization.
9. Label advertising attribution and cost allocations appropriately.

Acceptance criteria:

- Recurring expenses do not duplicate after retries.
- Historical month edits behave as intended.
- Advertising is optional.
- Shopify actual sales remain separate from platform attribution.
- Advertising costs are not counted twice.

## PHASE 10 — Reports, Exports and Notifications

Tasks:

1. Implement P&L.
2. Implement product profitability report.
3. Implement marketing report.
4. Implement CSV export.
5. Implement PDF export.
6. Implement in-app notifications.
7. Implement configurable scheduled email reports.
8. Add job retry and delivery tracking.

Acceptance criteria:

- Export totals match the dashboard and detail data.
- Large exports use background processing.
- Failed exports and emails are visible and retryable.
- Scheduled reports respect the intended merchant timezone.

## PHASE 11 — Profit Leakage and Data Quality

Tasks:

1. Implement negative-profit order detection.
2. Implement missing-COGS alerts.
3. Implement margin threshold alerts.
4. Implement shipping-cost warnings.
5. Implement refund-rate warnings.
6. Implement cost-change detection.
7. Implement evidence and action hints.
8. Add configurable thresholds where appropriate.

Acceptance criteria:

- Alerts are based on reproducible rules.
- Missing data is disclosed.
- Financial impact is shown only when defensible.
- Tests cover false-positive and incomplete-data scenarios.

## PHASE 12 — SaaS Billing and Onboarding

Tasks:

1. Define free and paid plan entitlements.
2. Evaluate Shopify billing requirements and APIs.
3. Implement approved subscription flows.
4. Enforce plan limits server-side.
5. Implement onboarding and connection guidance.
6. Add feedback and support workflows.
7. Document uninstall, downgrade and retention behavior.

Acceptance criteria:

- Plan restrictions cannot be bypassed through direct API requests.
- Billing behavior follows current Shopify requirements.
- Subscription changes do not corrupt existing data.
- Privacy and deletion rules remain enforced.

## PHASE 13 — Security, Reliability and Production Readiness

Tasks:

1. Review all tenant-scoped endpoints and jobs.
2. Test authorization boundaries.
3. Verify secrets management.
4. Review webhook security.
5. Review dependency vulnerabilities.
6. Add structured logging and monitoring.
7. Configure automated backups.
8. Perform a restore test.
9. Verify database migrations and rollback/recovery procedures.
10. Test worker failures and retry behavior.
11. Define data deletion and retention procedures.
12. Review Shopify App Store requirements.
13. Verify production configuration and HTTPS.
14. Document incident response and operational procedures.

Acceptance criteria:

- Critical security issues are resolved.
- Tenant isolation tests pass.
- Backup restoration has been verified.
- Logs do not expose secrets.
- Monitoring can identify failed synchronization and stale data.
- The app is ready for controlled beta testing, subject to any remaining external review requirements.

## PHASE 14 — Deployment and Beta Launch

Tasks:

1. Deploy frontend, API, worker and database using the approved hosting design.
2. Configure environment-specific secrets.
3. Configure domain and HTTPS.
4. Verify production database connectivity.
5. Run migrations safely.
6. Test installation with an authorized test store.
7. Verify synchronization and reconciliation.
8. Verify reports and exports.
9. Monitor errors and costs.
10. Invite a small number of beta merchants.
11. Collect feedback and prioritize fixes.

Acceptance criteria:

- Production services are healthy.
- The end-to-end installation and data flow work.
- Backups and monitoring are active.
- Costs are understood.
- Known limitations are documented.
- No critical security or financial correctness issues remain.

## PHASE 15 — Advanced Intelligence

Only after the core application is reliable:

- Advanced AI explanations
- Recommendations
- Forecasting
- Scenario simulation
- Customer LTV
- Cash flow
- Payout reconciliation
- Tax/duty intelligence
- Inventory and supplier analytics
- Multi-store UI
- Arabic localization
- Advanced reporting and benchmarks

Evaluate Python services only when a specific feature justifies them.

Do not rewrite the existing backend simply to use a different language.

---

# 28. REQUIRED ACCEPTANCE CRITERIA FOR EVERY PHASE

Before implementing a phase:

1. Explain the objective.
2. List the files to create or modify.
3. List dependencies and justify each new dependency.
4. Define measurable acceptance criteria.
5. Identify security and data risks.

After implementing:

1. Run the build.
2. Run linting and type checks.
3. Run relevant unit tests.
4. Run relevant integration tests.
5. Fix failures.
6. Report actual results.
7. Update documentation.
8. List any unfinished work.
9. Explain manual verification steps.
10. Stop and wait for my approval.

Never claim a command or test succeeded unless it was actually executed successfully.

Never silently skip failed tests.

Do not implement future phases merely because the current phase is complete.

---

# 29. HOW TO WORK WITH ME

I am experienced with .NET, SQL Server, APIs, Next.js and enterprise ERP systems.

I am learning the Node.js backend ecosystem and Shopify development.

When introducing a new technology:

1. Explain what it does.
2. Explain why we need it.
3. Compare relevant alternatives.
4. Explain the trade-offs.
5. Implement only after the architecture is approved.

Use maintainable production-quality code rather than clever shortcuts.

Do not generate unnecessary files or dependencies.

Do not duplicate business logic between the frontend, API, worker and database.

Keep financial rules in a well-defined, independently testable domain/service layer.

Use database constraints as an additional integrity boundary, not as a replacement for application authorization.

If a requirement is ambiguous, identify the ambiguity and recommend an option rather than silently inventing a rule.

Do not ask me to approve every minor naming decision. Group important unresolved decisions into a short checklist.

---

# 30. CURRENT TASK

**Status (v1.1):** Phase 0 is complete and its recommendations are approved (see section 31). The current task is **Phase 1 planning**: present the Phase 1 objective, file list, dependencies and acceptance criteria per section 28, then implement Phase 1 only after the plan is confirmed. Stop for approval at the end of Phase 1.

The text below is the original Phase 0 brief, retained for reference.

## 30.1 Original Phase 0 brief

Your immediate task is to perform the architecture and planning phase.

Do not create application code.

Do not create files.

Do not install packages.

Do not modify the project directory.

Do not create migrations.

Do not implement Shopify authentication.

Do not begin Phase 1.

First, provide these deliverables:

### A. Executive architecture recommendation

Explain the proposed architecture and data flow.

### B. Technology decisions

Recommend:

- Next.js architecture
- Shopify Polaris and App Bridge integration
- Node.js backend framework
- ORM
- PostgreSQL configuration
- Background queue
- Whether Redis is necessary
- Monorepo tooling
- Package manager
- Testing framework
- Logging and monitoring
- Initial hosting approach

Explain alternatives and trade-offs.

### C. Complete proposed folder structure

Use the project root:

`D:\Proj\Work\all-projects\profit-intelligence`

Explain the purpose of each major directory.

### D. Database architecture

Show core entities, relationships, constraints, indexes and tenant isolation.

Identify V1 tables versus later-phase tables.

### E. Shopify integration design

Explain installation, authentication, sessions, API access, webhooks, historical sync, incremental sync, reconciliation and uninstall/privacy handling.

### F. Synchronization architecture

Explain queues, job state, idempotency, retry policies, progress tracking, concurrency and recovery.

### G. Financial calculation contract

Define the proposed financial terms, calculation formulas, tax treatment, refund behavior, COGS history, estimates and missing-data handling.

Identify financial rules that require my approval.

### H. Currency and precision

Explain monetary storage, decimal arithmetic, exchange rates, rounding and original versus reporting currency.

### I. Multi-tenant security

Explain exactly how Tenant A will be prevented from accessing Tenant B's data through API requests, database queries, webhooks and background jobs.

### J. Dashboard and reporting architecture

Explain how filters, summaries, drill-downs, pagination and aggregate calculations will work efficiently.

### K. API modules and boundaries

Describe the responsibilities of the API and worker, and propose the major API modules.

### L. Testing strategy

Define unit, integration, financial, Shopify and security testing.

### M. Production architecture

Compare Railway, Azure, AWS and Vercel-based deployment where relevant.

Recommend the simplest appropriate production architecture for V1.

### N. Cost and operational risks

Identify infrastructure, API, storage, email, queue and monitoring costs that could become material.

### O. Detailed phase plan

Provide a concise table of phases, objectives, dependencies, deliverables and acceptance criteria.

### P. Risk register

Prioritize the major technical, financial, security, privacy and product risks.

### Q. Decisions requiring approval

Finish with a short checklist of the genuinely important decisions I need to approve before implementation.

Separate fixed requirements from recommendations and unresolved decisions.

Do not present proposed choices as though I have already approved them.

---

# 31. APPROVED PHASE 0 DECISIONS (2026-10-09)

1. **Next.js integration:** Next.js as embedded client + separate API, with a time-boxed spike in Phase 3. Fallback is the official React Router template, only with explicit approval.
2. **Backend:** NestJS on the Fastify adapter.
3. **ORM:** Drizzle ORM with reviewed SQL migrations.
4. **Queue:** pg-boss on PostgreSQL. No Redis in V1.
5. **Monorepo:** pnpm workspaces, no Turborepo.
6. **Tenant isolation:** application-level scoping + PostgreSQL Row Level Security (`SET LOCAL` per transaction, fail-closed) + composite foreign keys.
7. **Hosting:** Railway for V1, gated on a verified backup restore.
8. **Customer PII:** not stored in V1.
9. **Financial rules:** as proposed in the Phase 0 section G (refund timing, shipping in revenue, tax excluded, fixed fees not reversed, COGS reversed only when restocked, `processed_at` in shop timezone). Refund timing (cash vs accrual) is to be re-confirmed when the written calculation spec is produced.
10. **Rounding:** HALF_UP to the currency minor unit per line/component; aggregates sum rounded values.
11. **History:** 90 days by default; request `read_all_orders`.
12. **FX source:** still to be chosen (free daily feed vs fixed AED peg 3.6725 for the prototype). Needed before Phase 6.
13. **Profit confidence:** High / Medium / Low bands with breakdown.
14. **Financial spec:** written in parallel with Phases 3–5.

---

# 32. DATABASE NAMING CONVENTION

- Tables and columns: lowercase `snake_case`, singular nouns, never quoted.
- Every table has a category prefix:

| Prefix | Meaning                                                 | Examples                                                                                                             |
| ------ | ------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| `m_`   | Master / reference entities                             | `m_tenant`, `m_shop`, `m_user_principal`, `m_product`, `m_product_variant`, `m_expense_category`, `m_currency`       |
| `s_`   | Settings / configuration                                | `s_app_setting`, `s_shipping_cost_rule`, `s_payment_fee_rule`, `s_report_schedule`, `s_shop_credential`              |
| `t_`   | Transactions mirrored from Shopify                      | `t_order`, `t_order_line_item`, `t_order_transaction`, `t_refund`, `t_refund_line_item`                              |
| `f_`   | Finance: merchant-entered or calculated money data      | `f_product_cost`, `f_expense`, `f_expense_occurrence`, `f_exchange_rate`, `f_order_profit`, `f_daily_profit_summary` |
| `o_`   | Operations: runtime processing state                    | `o_sync_job`, `o_webhook_event`, `o_notification`, `o_leakage_issue`, `o_report_export`                              |
| `a_`   | Admin / audit: append-only history and security records | `a_audit_log`, `a_privacy_request`                                                                                   |

- `tenant_id` is the first business column on every tenant-owned table.
- Suffixes: `_id`, `_at` (UTC `timestamptz`), `_amount`, `_currency`.
- Constraint and index names: `pk_<table>`, `fk_<table>_<ref>`, `uq_<table>_<cols>`, `ix_<table>_<cols>`.
- TypeScript names are clean camelCase (`orderProfit`), mapped to table names in the Drizzle schema. Prefixes are not carried into application code.
- Classification rule: decide by what the data is and who creates it, and record edge cases in an ADR.

---

# FINAL RULE

**(Original Phase 0 rule, now satisfied.) The phase-gate principle still applies: implement one phase at a time and stop for approval after each.**

**PHASE 0 ONLY. ARCHITECTURE AND PLANNING ONLY.**

Do not create code.

Do not create files.

Do not install packages.

Do not modify the filesystem.

Do not start Phase 1 automatically.

After producing the architecture proposal and the approval checklist, stop and wait for my approval.

We will implement this application phase by phase, verifying each phase before proceeding to the next.
