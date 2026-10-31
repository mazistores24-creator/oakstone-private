# Oakstone Financial private operations

Oakstone's staff and client access portal. Client credentials are hashed with bcrypt, sign-in uses role-protected sessions, and new client access remains pending until an identity-verified account is linked and approved by staff.

## Start the service

Use Node.js 18 or newer and provide a MongoDB database. Set these environment variables before starting:

- `MONGODB_URI`: connection string for the Oakstone portal database.
- `MONGODB_DB`: database name (defaults to `oakstone_portal`).
- `SESSION_SECRET`: long, private random value used to sign sessions.
- `STAFF_EMAIL` and `STAFF_PASSWORD`: optional first operations-user credentials. The password must contain at least 12 characters. If the user does not already exist, the service stores a bcrypt hash.
- `STAFF_NAME`: optional display name for the operations user.
- `SUPPORT_EMAIL`: destination inbox for messages submitted on the public contact page.
- `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`: SMTP server settings used to deliver public contact messages.
- `SMTP_FROM`: optional verified sender address; defaults to `SMTP_USER`.
- `NODE_ENV=production`: enables secure cookies and requires MongoDB and `SESSION_SECRET`.

Bootstrap 5 is installed as a local dependency and served by the application; no CDN connection is needed for the responsive interface. Run `npm install` and `npm start` (use `npm.cmd` for both commands in Windows PowerShell). Run the isolated API tests with `npm test`; they use a temporary in-memory store and do not connect to MongoDB. Serve the application through HTTPS in production. Passwords must contain at least 12 characters and no more than 72 UTF-8 bytes to match bcrypt's input limit. Do not place credentials or secrets in source files.

## Data connections

The portal reads operational records from these MongoDB collections:

- `users`: credentials and client access status.
- `client_accounts`: one record per linked account. Each record must have `ownerEmail`, `status: "active"`, and `identityVerified: true`. Portfolio fields include `name`, `accountId`, `currency`, numeric `nav` and `cash`, `performance`, `holdings`, and optional `allocation` and `mandate` fields.
- `house_book`: account ledger entries, including `createdAt`, `reference`, `clientReference` or `accountName`, `description`, numeric `amount`, and `status`.
- `market_prices`: approved price references with `symbol`, `name`, `price`, `change`, and `status: "approved"`.
- `client_requests`: client withdrawal and investment instructions, saved with a generated reference and `Pending review` status.
- `support_messages`: private client-to-staff support messages and replies.

When a client registers, the account remains pending. Staff can approve access from the Clients page only after an active, identity-verified account with the same `ownerEmail` is linked. Until a portfolio record is linked, the client sees account setup status instead of a balance.

## Withdrawal and investment instructions

Clients can submit withdrawal and investment requests. Investment requests include Bronze ($5,000–$34,999, 12 months), Silver ($35,000–$149,999), Gold ($150,000–$499,999), or Diamond ($500,000–$1,000,000) membership tiers. These ranges are denominated in USD; the app validates the chosen amount and only enables tier requests for USD-linked accounts. No daily return is stated or promised. The server saves instructions for staff review and displays them in the client request history and staff audit view. A request does not itself transfer money or place a securities order. To execute transactions, connect and authorize the custodian or brokerage API and its approval workflow; that provider is not currently configured in this codebase.

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
