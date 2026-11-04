# Oakstone Financial private operations

Oakstone's staff and client access portal. Client credentials are hashed with bcrypt, sign-in uses role-protected sessions, and staff approve pending client access only after attesting that identity was checked. Portfolio data remains unavailable until a real account is separately linked and verified.

## Start the service

Use Node.js 18 or newer and provide a MongoDB database. For local development, put these settings in the ignored `.env` file; the app loads it on startup. Environment variables already set by the hosting provider take precedence, so configure the same MongoDB URI and database name in Render's Environment settings. Never commit `.env` or share its contents:

- `MONGODB_URI`: connection string for the Oakstone portal database.
- `MONGODB_DB`: database name (defaults to `oakstone_portal`).
- `SESSION_SECRET`: long, private random value used to sign sessions.
- `STAFF_EMAIL` and `STAFF_PASSWORD`: optional first operations-user credentials. The password must contain at least 12 characters. If the user does not already exist, the service stores a bcrypt hash.
- `STAFF_NAME`: optional display name for the operations user.
- `SUPPORT_EMAIL`: destination inbox for messages submitted on the public contact page.
- `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`: SMTP server settings used to deliver public contact messages.
- `SMTP_FROM`: optional verified sender address; defaults to `SMTP_USER`.
- `NODE_ENV=production`: enables secure cookies and requires MongoDB and `SESSION_SECRET`.

Bootstrap 5 is installed as a local dependency and served by the application; no CDN connection is needed for the responsive interface. Run `npm install` and `npm start` (use `npm.cmd` for both commands in Windows PowerShell). When `MONGODB_URI` is configured, startup fails if MongoDB is unreachable rather than silently switching to temporary memory storage. Run the isolated API tests with `npm test`; tests skip `.env` loading and use a temporary in-memory store. Serve the application through HTTPS in production. Passwords must contain at least 12 characters and no more than 72 UTF-8 bytes to match bcrypt's input limit. Do not place credentials or secrets in source files.

## Cloud routing

`npm run build` stages the frontend and locally installed Bootstrap assets in `dist`. Vercel deploys that static output, maps the client and dashboard paths to their HTML pages, and proxies `/api/*` to Render through `vercel.json`, keeping browser sessions same-origin. Update the Render destination if the service hostname changes. Configure `MONGODB_URI`, `MONGODB_DB`, `SESSION_SECRET`, and any optional staff or SMTP credentials in Render's environment settings, not in source files.

## Data connections

The portal reads operational records from these MongoDB collections:

- `users`: credentials and client access status.
- `client_accounts`: one record per linked account. Each record must have `ownerEmail`, `status: "active"`, and `identityVerified: true`. Portfolio fields include `name`, `accountId`, `currency`, numeric `nav` and `cash`, `performance`, `holdings`, and optional `allocation` and `mandate` fields.
- `house_book`: account ledger entries, including `createdAt`, `reference`, `clientReference` or `accountName`, `description`, numeric `amount`, and `status`.
- `market_prices`: approved price references with `symbol`, `name`, `price`, `change`, and `status: "approved"`.
- `client_requests`: client withdrawal, deposit, and investment instructions. Deposits remain `Pending review` until staff confirms custodian clearance.
- `support_messages`: private client-to-staff support messages and replies.

When a client registers, login remains pending until staff confirms the identity check and approves access from the Clients page. The approval records who attested and when. A client can then sign in and sees account setup status until a real portfolio record is linked. Staff can link that record later using the client's email and the account's exact `clientReference`; the server records the identity attestation on the account and in `account_link_audit`. Portfolio data remains unavailable until a matching account is linked and verified. This is a manual staff attestation, not automated identity proof. Staff remain responsible for checking identity and account ownership against Oakstone records before confirming. Clients cannot invoke staff routes or self-verify. Do not create placeholder portfolio records to enable login.

In the staff dashboard's **Create and link an account** form, the external account ID is optional. When none exists, the server generates a unique `OAK-ACC-...` internal ID and stores `accountIdType: "internal"`; this ID identifies the portal record only and does not represent a custodian account or imply a balance. A genuine externally assigned account ID can be entered when available.

Staff can use **Record portfolio balance** to update NAV and available cash for an existing active, identity-verified account. The update requires the exact client email and client reference, finite non-negative values, a statement or approved-feed reference, and explicit staff confirmation. The server records previous and new values, source, staff verifier, and timestamp in `account_link_audit`; it does not change holdings. Do not enter estimates or invented balances. Withdrawals remain unavailable until cash is recorded.

Clients with a linked, verified account can submit withdrawal, deposit, and investment requests. Each stays pending without changing balances until staff confirms custodian settlement from **Audit & controls** and enters the settlement reference. Settlement adds deposits to both NAV and cash, subtracts withdrawals from both, and subtracts investments from cash while NAV remains level as cash converts to holdings. Investment holdings still require custodian portfolio data. Each update marks the request approved and records before/after balances and the verifier in `client_request_audit`; duplicate approvals cannot apply twice. The portal does not initiate transfers or trades.

## Withdrawal and investment instructions

Investment requests include Bronze ($5,000–$34,999, 12 months), Silver ($35,000–$149,999), Gold ($150,000–$499,999), or Diamond ($500,000–$1,000,000) membership tiers. These ranges are denominated in USD; the app validates the chosen amount and only enables tier requests for USD-linked accounts with sufficient recorded cash. No daily return is stated or promised. The server saves instructions for staff review and displays them in the client request history and staff audit view. A request does not itself transfer funds or place an investment order. To execute transactions, connect and authorize the custodian or brokerage API and its approval workflow; that provider is not currently configured in this codebase.

## Client support and contact email

Signed-in clients can send private in-app messages from the Support section of their portfolio. Existing staff accounts can view and reply to those conversations under **Client support** in the operations dashboard. Messages are stored in the `support_messages` collection; use Atlas for persistent storage. The dashboard and client page refresh messages while open.

Non-clients can use `/contact.html` to email the support team. Delivery requires `SUPPORT_EMAIL` and the SMTP settings above; until configured, the form reports that email contact is unavailable. Set these values in your hosting provider’s environment settings or the local PowerShell session, and do not commit credentials.

## Main files

- `server.js`: authentication, account access, client requests, MongoDB stores, and protected API routes.
- `brand.js`: Oakstone brand configuration.
- `public/index.html`: staff sign-in.
- `public/client-login.html` and `public/client-register.html`: client sign-in and access request.
- `public/contact.html`: public email contact form.
- `public/dashboard.html`: staff operations workspace.
- `public/client.html`: client portfolio, transaction request, and support message page.
- `public/styles.css`: responsive portal styles.
