document.querySelectorAll('[data-brand]').forEach((el) => { if (window.OAKSTONE_BRAND) el.textContent = window.OAKSTONE_BRAND.name; });

const state = { view: 'overview', data: null, query: '', support: { threads: [], selectedEmail: '', messages: [], error: '' } };
const root = document.getElementById('view-root');
const escapeHtml = (value) => String(value ?? '').replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
const initials = (name) => String(name || 'Staff member').split(/\s+/).filter(Boolean).map((part) => part[0]).slice(0, 2).join('').toUpperCase();
const toast = (message) => { const el = document.getElementById('toast'); el.textContent = message; el.classList.add('show'); clearTimeout(toast.timer); toast.timer = setTimeout(() => el.classList.remove('show'), 2600); };
const matchesQuery = (...parts) => !state.query || parts.join(' ').toLowerCase().includes(state.query.toLowerCase());
const currentDate = () => new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
function pageHeading(kicker, title, subtitle, action = '') { return `<div class="ops-page-heading"><div><span class="ops-kicker">${kicker}</span><h1>${title}</h1><p>${subtitle}</p></div>${action}</div>`; }
function card(title, value, note, symbol) { return `<article class="ops-stat col-12 col-sm-6 col-xl-3"><div class="ops-stat-top"><span>${escapeHtml(title)}</span><span class="ops-stat-icon">${escapeHtml(symbol)}</span></div><strong>${escapeHtml(value)}</strong><small>${escapeHtml(note)}</small></article>`; }
function table(rows, columns, emptyMessage) {
  const headers = columns.map((column) => `<th>${column.label}</th>`).join('');
  const body = rows.length ? rows.map((row) => `<tr>${columns.map((column) => `<td>${column.render ? column.render(row) : escapeHtml(row[column.key])}</td>`).join('')}</tr>`).join('') : `<tr><td colspan="${columns.length}" class="ops-empty-cell">${escapeHtml(emptyMessage)}</td></tr>`;
  return `<div class="ops-table-wrap table-responsive"><table class="ops-table table table-hover align-middle"><thead><tr>${headers}</tr></thead><tbody>${body}</tbody></table></div>`;
}
function ledgerTable(rows, compact = false) {
  const visible = rows.filter((row) => matchesQuery(row.date, row.ref, row.account, row.description, row.amount, row.status));
  return `<div class="ops-table-wrap table-responsive"><table class="ops-table table table-hover align-middle ${compact ? 'compact' : ''}"><thead><tr><th>DATE / REF</th><th>ACCOUNT</th><th>DESCRIPTION</th><th>AMOUNT</th><th>STATUS</th></tr></thead><tbody>${visible.map((row) => `<tr><td><strong>${escapeHtml(row.date)}</strong><small>${escapeHtml(row.ref)}</small></td><td>${escapeHtml(row.account)}</td><td>${escapeHtml(row.description)}</td><td class="ops-amount">${escapeHtml(row.amount)}</td><td><span class="ops-status">${escapeHtml(row.status)}</span></td></tr>`).join('') || `<tr><td colspan="5" class="ops-empty-cell">${state.query ? 'No entries match your search.' : 'House book entries appear here when the account feed is connected.'}</td></tr>`}</tbody></table></div>`;
}
function requestEvents() {
  return state.data.audit.map((event, index) => ({
    date: new Date(event.createdAt).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }), ref: event.reference, actor: event.person, email: event.email || event.person, type: event.type, action: event.action.toUpperCase(), target: event.context, detail: event.status, status: event.status
  })).filter((event) => matchesQuery(event.date, event.ref, event.actor, event.action, event.target, event.detail));
}
function recentRequestTable(events) {
  const rows = events.slice(0, 4);
  return `<div class="ops-table-wrap table-responsive"><table class="ops-table table table-hover align-middle compact"><thead><tr><th>DATE / REF</th><th>CLIENT REQUEST</th><th>ACCOUNT</th><th>STATUS</th></tr></thead><tbody>${rows.map((event) => `<tr><td><strong>${escapeHtml(event.date)}</strong><small>${escapeHtml(event.ref)}</small></td><td>${escapeHtml(event.action)}</td><td>${escapeHtml(event.target)}</td><td><span class="ops-status ops-status-review">${escapeHtml(event.status)}</span></td></tr>`).join('') || '<tr><td colspan="4" class="ops-empty-cell">No client requests are waiting for review.</td></tr>'}</tbody></table></div>`;
}
function renderOverview() {
  const data = state.data;
  const rows = data.ledger.filter((row) => matchesQuery(row.account, row.description, row.ref)).slice(0, 4);
  const requests = data.metrics.find((metric) => metric.label === 'Open requests')?.value || '0';
  const actions = `<button class="ops-action-row" data-view="audit"><span class="ops-action-icon warm">!</span><span><strong>Review client requests</strong><small>${requests} currently recorded</small></span><b>›</b></button><button class="ops-action-row" data-view="clients"><span class="ops-action-icon cool">♙</span><span><strong>Review linked accounts</strong><small>${data.clients.length} active account links</small></span><b>›</b></button><button class="ops-action-row" data-view="pricing"><span class="ops-action-icon green">↗</span><span><strong>Price source</strong><small>${data.pricing.length ? `${data.pricing.length} approved references` : 'Not configured'}</small></span><b>›</b></button>`;
  return `${pageHeading(`WORKSPACE / ${currentDate().toUpperCase()}`, 'Portfolio operations', 'A current view of linked accounts, requests, and control activity.')}
    <section class="ops-stat-grid row g-3">${data.metrics.map((metric) => card(metric.label, metric.value, metric.change, metric.icon)).join('')}</section>
    <div class="ops-overview-grid row g-3"><section class="ops-card ops-book-card col-12 col-xl-8"><div class="ops-card-heading"><div><span class="ops-kicker">HOUSE BOOK</span><h2>Recent activity</h2></div><button class="ops-text-action" data-view="housebook">View house book <span>→</span></button></div>${ledgerTable(rows, true)}</section><section class="ops-card ops-actions-card col-12 col-xl-4"><div class="ops-card-heading"><div><span class="ops-kicker">OPERATIONS</span><h2>Primary actions</h2></div></div>${actions}</section></div>
    <div class="ops-overview-grid lower row g-3"><section class="ops-card ops-chart-card col-12 col-xl-7"><div class="ops-card-heading"><div><span class="ops-kicker">HOUSE BOOK COMPOSITION</span><h2>Portfolio overview</h2></div><span class="ops-updated">Account feed</span></div><div class="ops-data-empty"><strong>Portfolio history unavailable</strong><span>Connect an approved account feed to display valuation history.</span></div></section><section class="ops-card ops-control-card col-12 col-xl-5"><div class="ops-card-heading"><div><span class="ops-kicker">CONTROL STATE</span><h2>Platform checks</h2></div></div><div class="ops-control-row"><i class="pending">·</i><span><strong>Allocation rules</strong><small>Awaiting mandate data</small></span><em>Not linked</em></div><div class="ops-control-row"><i class="pending">·</i><span><strong>Price validations</strong><small>Connect an approved price source</small></span><em>Not linked</em></div><div class="ops-control-row"><i class="ok">✓</i><span><strong>Request recording</strong><small>Client instructions are stored</small></span><em>Active</em></div></section></div>
    <section class="ops-card ops-events-card"><div class="ops-card-heading"><div><span class="ops-kicker">EVENT LOG</span><h2>Recent client requests</h2></div><button class="ops-text-action" data-view="audit">View request history <span>→</span></button></div>${recentRequestTable(requestEvents())}</section>`;
}
function renderHouseBook() {
  const rows = state.data.ledger.filter((row) => matchesQuery(row.date, row.ref, row.account, row.description, row.amount, row.status));
  return `${pageHeading('OPERATIONS / HOUSE BOOK', 'House book', 'Review posted activity from the connected account ledger.', '<button class="ops-outline-button" data-action="export-ledger">↓ Export</button>')}<section class="ops-card ops-list-card"><div class="ops-list-toolbar"><div><span class="ops-kicker">HOUSE BOOK ENTRIES</span><p>${state.data.ledger.length} entries available</p></div></div>${ledgerTable(rows)}</section>`;
}
function renderClients() {
  if (!state.data) return `${pageHeading('OPERATIONS / CLIENTS', 'Clients', 'Review linked accounts and pending client access.')}<section class="ops-card ops-data-empty" role="status"><strong>Loading client data</strong><span>The client directory will appear when the dashboard data finishes loading.</span></section>`;
  const clients = (Array.isArray(state.data.clients) ? state.data.clients : []).filter((client) => matchesQuery(client.name, client.type, client.status));
  const pendingAccess = (Array.isArray(state.data.pendingAccess) ? state.data.pendingAccess : []).filter((client) => matchesQuery(client.email, client.userId, client.clientReference, client.accountId));
  const columns = [
    { label: 'CLIENT / ACCOUNT', render: (client) => `<span class="ops-client-name"><i>${escapeHtml(client.code)}</i><strong>${escapeHtml(client.name)}</strong></span>` },
    { label: 'MANDATE', key: 'type' }, { label: 'HOUSE BOOK', render: (client) => `<span class="ops-amount">${escapeHtml(client.value)}</span>` },
    { label: 'STATUS', render: (client) => `<span class="ops-status">${escapeHtml(client.status)}</span>` }, { label: 'LAST REVIEW', key: 'reviewed' }
  ];
  const accessColumns = [
    { label: 'USER ID', render: (client) => escapeHtml(client.userId || '—') },
    { label: 'EMAIL', key: 'email' }, { label: 'CLIENT REFERENCE', key: 'clientReference' },
    { label: 'ACCOUNT ID', render: (client) => escapeHtml(client.accountId || 'Not linked') },
    { label: 'PORTFOLIO', render: (client) => `<span class="ops-status ${client.accountReady ? 'ops-status-active' : 'ops-status-review'}">${client.accountReady ? 'Linked and verified' : 'Not linked'}</span>` },
    { label: 'ACCESS', render: (client) => `<div class="client-access-actions"><label class="account-link-confirm"><input type="checkbox" data-action="approve-client-identity" data-email="${escapeHtml(client.email)}"> I verified identity</label><button class="ops-outline-button" data-action="approve-client" data-email="${escapeHtml(client.email)}" disabled>Approve access</button></div>` }
  ];
  const createAccountForm = `<form id="staff-account-create-form" class="ops-card account-link-form"><div class="ops-card-heading"><div><span class="ops-kicker">STAFF ATTESTATION</span><h2>Create and link an account</h2></div></div><p>Enter an external account ID if one exists; otherwise Oakstone generates an internal ID. No balances, cash, performance, or holdings are created.</p><div class="row g-3"><div class="col-md-3"><label for="create-account-email">Client email</label><input class="form-control" id="create-account-email" name="email" type="email" maxlength="254" required></div><div class="col-md-3"><label for="create-account-reference">Client reference</label><input class="form-control" id="create-account-reference" name="accountReference" maxlength="120" required></div><div class="col-md-3"><label for="create-account-id">External account ID (optional)</label><input class="form-control" id="create-account-id" name="accountId" maxlength="120" placeholder="Auto-generated if blank"></div><div class="col-md-3"><label for="create-account-currency">Currency</label><input class="form-control" id="create-account-currency" name="currency" value="USD" minlength="3" maxlength="3" pattern="[A-Za-z]{3}" required></div><div class="col-md-6"><label for="create-account-name">Account name (optional)</label><input class="form-control" id="create-account-name" name="accountName" maxlength="120"></div></div><label class="account-link-confirm"><input type="checkbox" name="identityChecked" required> I verified the client identity and account identifiers against Oakstone’s records.</label><button class="ops-outline-button" type="submit">Create and link</button></form>`;
  const portfolioDataForm = `<form id="staff-portfolio-data-form" class="ops-card account-link-form"><div class="ops-card-heading"><div><span class="ops-kicker">STAFF DATA ATTESTATION</span><h2>Record portfolio balance</h2></div></div><p>Enter NAV and available cash from a verified statement or approved feed. This updates an existing linked account and does not change holdings.</p><div class="row g-3"><div class="col-md-3"><label for="portfolio-client-email">Client email</label><input class="form-control" id="portfolio-client-email" name="email" type="email" maxlength="254" required></div><div class="col-md-3"><label for="portfolio-account-reference">Client reference</label><input class="form-control" id="portfolio-account-reference" name="accountReference" maxlength="120" required></div><div class="col-md-3"><label for="portfolio-nav">Net asset value (NAV)</label><input class="form-control" id="portfolio-nav" name="nav" type="number" min="0" step="0.01" required></div><div class="col-md-3"><label for="portfolio-cash">Available cash</label><input class="form-control" id="portfolio-cash" name="cash" type="number" min="0" step="0.01" required></div><div class="col-md-6"><label for="portfolio-source-reference">Statement / approved-feed reference</label><input class="form-control" id="portfolio-source-reference" name="sourceReference" maxlength="200" required></div></div><label class="account-link-confirm"><input type="checkbox" name="dataChecked" required> I checked these values against the source reference above.</label><button class="ops-outline-button" type="submit">Save verified balances</button></form>`;
  const linkForm = `<form id="staff-account-link-form" class="ops-card account-link-form"><div class="ops-card-heading"><div><span class="ops-kicker">STAFF ATTESTATION</span><h2>Link a client account</h2></div></div><p>Match the client email to an existing account record. Verify identity and account ownership manually before submitting.</p><div class="row g-3"><div class="col-md-5"><label for="link-client-email">Client email</label><input class="form-control" id="link-client-email" name="email" type="email" maxlength="254" required></div><div class="col-md-4"><label for="link-account-reference">Existing account reference</label><input class="form-control" id="link-account-reference" name="accountReference" maxlength="120" required></div><div class="col-md-3 d-flex align-items-end"><button class="ops-outline-button" type="submit">Link account</button></div></div><label class="account-link-confirm"><input type="checkbox" name="identityChecked" required> I checked the client’s identity against Oakstone’s records and confirm this account belongs to them.</label></form>`;
  return `${pageHeading('OPERATIONS / CLIENTS', 'Clients', 'Review linked accounts and pending client access.')}${createAccountForm}${portfolioDataForm}${linkForm}<section class="ops-card ops-list-card"><div class="ops-list-toolbar"><div><span class="ops-kicker">CLIENT DIRECTORY</span><p>${clients.length} linked records</p></div><button class="ops-outline-button" data-action="export-clients">↓ Export</button></div>${table(clients, columns, 'No linked client accounts are available.')}</section><section class="ops-card ops-list-card pending-access-card"><div class="ops-list-toolbar"><div><span class="ops-kicker">ACCESS REQUESTS</span><p>${pendingAccess.length} waiting for identity review. Portfolio linking can happen later.</p></div></div>${table(pendingAccess, accessColumns, 'No client access requests are waiting for review.')}</section>`;
}
function renderAllocations() {
  const list = state.data.allocations.filter((item) => matchesQuery(item.client, item.mix));
  const avg = (key) => list.length ? Math.round(list.reduce((sum, item) => sum + Number(item[key] || 0), 0) / list.length) : 0;
  const equity = avg('equity'), fixed = avg('fixed'), cash = avg('cash');
  const hasMix = list.length > 0 && equity + fixed + cash > 0;
  const background = hasMix ? `conic-gradient(#2d3836 0 ${equity}%,#b79b65 ${equity}% ${equity + fixed}%,#e3e6e2 ${equity + fixed}% 100%)` : '#eceeeb';
  return `${pageHeading('OPERATIONS / ALLOCATIONS', 'Allocations', 'Review mandate allocations loaded from linked client accounts.')}<div class="ops-overview-grid"><section class="ops-card allocation-summary"><div class="ops-card-heading"><div><span class="ops-kicker">ALLOCATION OVERVIEW</span><h2>Mandate coverage</h2></div></div>${hasMix ? `<div class="ops-donut-area"><div class="ops-donut" style="background:${background}"><div><strong>${list.length}</strong><small>mandates</small></div></div><div class="donut-legend"><span><i class="donut-equity"></i>Equity <b>${equity}%</b></span><span><i class="donut-fixed"></i>Fixed income <b>${fixed}%</b></span><span><i class="donut-cash"></i>Cash <b>${cash}%</b></span></div></div>` : '<div class="ops-data-empty"><strong>No allocation data</strong><span>Allocation details appear when linked accounts include a mandate mix.</span></div>'}</section><section class="ops-card ops-control-card"><div class="ops-card-heading"><div><span class="ops-kicker">PRE-TRADE CONTROLS</span><h2>Allocation rules</h2></div></div><div class="ops-data-empty"><strong>Rules not connected</strong><span>Load approved mandate restrictions before enabling allocation checks.</span></div></section></div><section class="ops-card ops-list-card"><div class="ops-card-heading"><div><span class="ops-kicker">CLIENT MANDATES</span><h2>Current allocations</h2></div></div><div class="allocation-list">${list.map((item) => `<div class="ops-allocation-row searchable-row"><span class="ops-client-code">${escapeHtml(item.initials)}</span><div class="ops-allocation-client"><strong>${escapeHtml(item.client)}</strong><small>${escapeHtml(item.mix)}</small></div><div class="ops-allocation-track"><span style="width:${Number(item.equity || 0)}%"></span><span style="width:${Number(item.fixed || 0)}%"></span><span style="width:${Number(item.cash || 0)}%"></span><div class="ops-allocation-legend"><small>Equity ${Number(item.equity || 0)}%</small><small>Fixed ${Number(item.fixed || 0)}%</small><small>Cash ${Number(item.cash || 0)}%</small></div></div><strong class="ops-amount">${escapeHtml(item.value)}</strong></div>`).join('') || '<div class="ops-empty-state">No client allocations are available.</div>'}</div></section>`;
}
function renderPricing() {
  const prices = state.data.pricing.filter((price) => matchesQuery(price.ticker, price.name));
  const columns = [
    { label: 'INSTRUMENT', render: (price) => `<strong>${escapeHtml(price.ticker)}</strong>` }, { label: 'DESCRIPTION', key: 'name' }, { label: 'REFERENCE', render: (price) => `<span class="ops-amount">${escapeHtml(price.price)}</span>` },
    { label: 'CHANGE', render: (price) => `<span class="${price.up ? 'ops-positive' : 'ops-negative'}">${escapeHtml(price.move)}</span>` }, { label: 'SOURCE', key: 'source' }, { label: 'STATUS', key: 'status' }
  ];
  return `${pageHeading('CONTROLS / PRICING', 'Pricing', 'Approved reference prices from the configured market data source.')}<div class="ops-overview-grid pricing-grid"><section class="ops-card ops-price-chart"><div class="ops-card-heading"><div><span class="ops-kicker">MARKET DATA</span><h2>Price performance</h2></div><span class="ops-live-dot">${prices.length ? 'CONNECTED' : 'NOT CONFIGURED'}</span></div><div class="ops-price-placeholder"><div class="ops-price-circle">↗</div><strong>${prices.length ? 'Price history unavailable' : 'No pricing source connected'}</strong><small>${prices.length ? 'Connect a historical price feed to view performance.' : 'Approved marks will appear here after a source is configured.'}</small></div></section><section class="ops-card"><div class="ops-card-heading"><div><span class="ops-kicker">SOURCE STATUS</span><h2>Pricing channel</h2></div></div><div class="ops-data-empty"><strong>${prices.length ? 'Reference prices loaded' : 'Not configured'}</strong><span>Pricing data is not generated by this portal. Connect your approved provider to populate this page.</span></div></section></div><section class="ops-card ops-list-card"><div class="ops-card-heading"><div><span class="ops-kicker">APPROVED MARKS</span><h2>Reference prices</h2></div></div>${table(prices, columns, 'No approved reference prices are available.')}</section>`;
}
function renderAudit() {
  const events = requestEvents();
  const columns = [
    { label: 'DATE / REF', render: (event) => `<strong>${escapeHtml(event.date)}</strong><small>${escapeHtml(event.ref)}</small>` }, { label: 'CLIENT', key: 'actor' }, { label: 'REQUEST', key: 'action' },
    { label: 'ACCOUNT', key: 'target' }, { label: 'STATUS', render: (event) => `<span class="ops-status ${event.status === 'Approved' ? 'ops-status-active' : 'ops-status-review'}">${escapeHtml(event.status)}</span>` },
    { label: 'REVIEW', render: (event) => event.type === 'deposit' && event.status === 'Pending review' ? `<button type="button" class="ops-outline-button" data-action="approve-deposit" data-reference="${escapeHtml(event.ref)}">Approve deposit</button>` : event.type === 'deposit' && event.status === 'Approved' ? 'Approved' : '—' }
  ];
  const openRequests = state.data.metrics.find((metric) => metric.label === 'Open requests')?.value || '0';
  return `${pageHeading('CONTROLS / AUDIT & CONTROLS', 'Audit & controls', 'Review client instructions submitted through the portal.', '<button class="ops-outline-button" data-action="export-requests">↓ Export requests</button>')}  <section class="ops-stat-grid audit-stats row g-3">${card('Open requests', openRequests, 'Withdrawal, deposit and investment instructions', '◷')}${card('Linked clients', String(state.data.clients.length), 'Active account records', '♙')}${card('House book entries', String(state.data.ledger.length), 'From the account ledger', '▤')}</section><section class="ops-card ops-audit-card"><div class="ops-list-toolbar"><div><span class="ops-kicker">CLIENT INSTRUCTIONS</span><p>Showing the most recent requests. Deposits update balances only after staff confirms custodian clearance.</p></div></div>${table(events, columns, 'No client requests are waiting for review.')}</section><section class="ops-card ops-control-note"><span class="ops-note-check">✓</span><div><strong>Request handling</strong><p>Submitted instructions are saved for staff review. Execution requires the connected custodian workflow and required approvals.</p></div></section>`;
}
function renderSupport() {
  const support = state.support;
  const selectedThread = support.threads.find((thread) => thread.email === support.selectedEmail);
  const threadItems = support.threads.length ? support.threads.map((thread) => {
    const date = new Date(thread.latestAt);
    const when = Number.isNaN(date.getTime()) ? '' : date.toLocaleDateString();
    return `<button type="button" class="support-thread list-group-item list-group-item-action ${thread.email === support.selectedEmail ? 'active' : ''}" data-support-email="${escapeHtml(thread.email)}"><strong>${escapeHtml(thread.name || thread.email)}</strong><small>${escapeHtml(thread.email)}</small><span>${escapeHtml(thread.latestMessage)}</span><time>${escapeHtml(when)}</time></button>`;
  }).join('') : '<p class="ops-empty-state">Client conversations will appear here when a client sends a message.</p>';
  const messages = support.error
    ? `<p class="support-error" role="alert">${escapeHtml(support.error)}</p>`
    : support.messages.length ? support.messages.map((message) => {
      const date = new Date(message.createdAt);
      const when = Number.isNaN(date.getTime()) ? '' : date.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
      return `<article class="support-message ${message.senderRole === 'staff' ? 'from-staff' : 'from-client'}"><div><strong>${message.senderRole === 'staff' ? 'Support team' : escapeHtml(message.senderName || 'Client')}</strong><time>${escapeHtml(when)}</time></div><p>${escapeHtml(message.text)}</p></article>`;
    }).join('') : '<p class="ops-empty-state">Select a client conversation to view messages.</p>';
  const conversation = selectedThread
    ? `<header class="support-conversation-heading"><div><strong>${escapeHtml(selectedThread.name || selectedThread.email)}</strong><small>${escapeHtml(selectedThread.email)}</small></div></header><div class="support-messages" id="support-message-list" role="log" aria-live="polite">${messages}</div><form id="staff-support-form" class="support-compose" data-support-email="${escapeHtml(selectedThread.email)}"><label class="visually-hidden" for="staff-support-message">Reply</label><textarea class="form-control" id="staff-support-message" name="message" rows="3" maxlength="2000" placeholder="Write a reply…" required></textarea><button class="btn btn-primary" type="submit">Send reply <span>→</span></button></form>`
    : '<div class="support-empty-conversation">Select a client to read and reply to their messages.</div>';
  return `${pageHeading('OPERATIONS / CLIENT SUPPORT', 'Client support', 'Respond to private messages from signed-in clients.')}<section class="ops-card support-workspace row g-0"><aside class="support-thread-list list-group list-group-flush col-12 col-md-4" id="support-thread-list">${threadItems}</aside><section class="support-conversation col">${conversation}</section></section>`;
}
const renderers = { overview: renderOverview, housebook: renderHouseBook, clients: renderClients, support: renderSupport, allocations: renderAllocations, pricing: renderPricing, audit: renderAudit };
function render() {
  root.innerHTML = renderers[state.view]();
  const labels = { overview: 'Overview', housebook: 'House book', clients: 'Clients', support: 'Client support', allocations: 'Allocations', pricing: 'Pricing', audit: 'Audit & controls' };
  document.getElementById('breadcrumb-current').textContent = labels[state.view];
  document.querySelectorAll('.ops-nav-item').forEach((item) => item.classList.toggle('active', item.dataset.view === state.view));
  if (state.view === 'support') renderSupportContent();
}
function renderSupportContent() {
  const list = document.getElementById('support-thread-list');
  if (!list) return;
  const support = state.support;
  const threadsHtml = support.threads.length ? support.threads.map((thread) => {
    const date = new Date(thread.latestAt);
    const when = Number.isNaN(date.getTime()) ? '' : date.toLocaleDateString();
    return `<button type="button" class="support-thread list-group-item list-group-item-action ${thread.email === support.selectedEmail ? 'active' : ''}" data-support-email="${escapeHtml(thread.email)}"><strong>${escapeHtml(thread.name || thread.email)}</strong><small>${escapeHtml(thread.email)}</small><span>${escapeHtml(thread.latestMessage)}</span><time>${escapeHtml(when)}</time></button>`;
  }).join('') : '<p class="ops-empty-state">Client conversations will appear here when a client sends a message.</p>';
  if (list.innerHTML !== threadsHtml) list.innerHTML = threadsHtml;
  const messagesElement = document.getElementById('support-message-list');
  if (!messagesElement) return;
  const messagesHtml = support.error
    ? `<p class="support-error" role="alert">${escapeHtml(support.error)}</p>`
    : support.messages.length ? support.messages.map((message) => {
      const date = new Date(message.createdAt);
      const when = Number.isNaN(date.getTime()) ? '' : date.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
      return `<article class="support-message ${message.senderRole === 'staff' ? 'from-staff' : 'from-client'}"><div><strong>${message.senderRole === 'staff' ? 'Support team' : escapeHtml(message.senderName || 'Client')}</strong><time>${escapeHtml(when)}</time></div><p>${escapeHtml(message.text)}</p></article>`;
    }).join('') : '<p class="ops-empty-state">No messages in this conversation yet.</p>';
  if (messagesElement.innerHTML !== messagesHtml) {
    const wasNearBottom = messagesElement.scrollHeight - messagesElement.scrollTop - messagesElement.clientHeight < 60;
    messagesElement.innerHTML = messagesHtml;
    if (wasNearBottom) messagesElement.scrollTop = messagesElement.scrollHeight;
  }
}
async function loadSupportInbox(quiet = false) {
  try {
    const response = await fetch('/api/staff/support/threads');
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || 'Support conversations could not be loaded.');
    state.support.threads = result.threads || [];
    const previousEmail = state.support.selectedEmail;
    if (!state.support.threads.some((thread) => thread.email === state.support.selectedEmail)) {
      state.support.selectedEmail = state.support.threads[0]?.email || '';
    }
    if (state.support.selectedEmail !== previousEmail && state.view === 'support') render();
    if (state.support.selectedEmail) {
      const messagesResponse = await fetch(`/api/staff/support/${encodeURIComponent(state.support.selectedEmail)}/messages`);
      const messagesResult = await messagesResponse.json();
      if (!messagesResponse.ok) throw new Error(messagesResult.error || 'Support conversation could not be loaded.');
      state.support.messages = messagesResult.messages || [];
    } else {
      state.support.messages = [];
    }
    state.support.error = '';
  } catch (error) {
    state.support.error = error.message;
    if (!quiet) toast(error.message);
  }
  if (state.view === 'support') renderSupportContent();
}
async function selectSupportConversation(email) {
  state.support.selectedEmail = email;
  state.support.messages = [];
  state.support.error = '';
  render();
  await loadSupportInbox();
}
function csv(rows) { return rows.map((row) => row.map((cell) => `"${String(cell ?? '').replace(/"/g, '""')}"`).join(',')).join('\r\n'); }
function download(name, contents) { const link = document.createElement('a'); link.href = URL.createObjectURL(new Blob([contents], { type: 'text/csv;charset=utf-8' })); link.download = name; link.click(); setTimeout(() => URL.revokeObjectURL(link.href), 1000); toast('Export downloaded'); }
document.querySelectorAll('.ops-nav-item').forEach((item) => item.addEventListener('click', () => { state.view = item.dataset.view; state.query = ''; document.getElementById('global-search').value = ''; render(); if (state.view === 'support') loadSupportInbox(); }));
document.getElementById('global-search').addEventListener('input', (event) => { state.query = event.target.value.trim(); render(); const input = document.getElementById('global-search'); input.focus(); input.setSelectionRange(input.value.length, input.value.length); });
document.getElementById('share-access').disabled = true;
document.querySelectorAll('#logout, #logout-mobile').forEach((button) => button.addEventListener('click', async () => { await fetch('/api/logout', { method: 'POST' }); location.replace('/'); }));
document.getElementById('close-deposit-approval').addEventListener('click', () => document.getElementById('deposit-approval-dialog').close());
document.addEventListener('click', async (event) => {
  const target = event.target.closest('[data-view], [data-action], [data-support-email]');
  if (!target) return;
  if (target.dataset.supportEmail) { await selectSupportConversation(target.dataset.supportEmail); return; }
  if (target.dataset.view) { state.view = target.dataset.view; state.query = ''; document.getElementById('global-search').value = ''; render(); return; }
  const action = target.dataset.action;
  if (action === 'approve-client-identity') {
    const controls = target.closest('.client-access-actions');
    const button = controls?.querySelector('[data-action="approve-client"]');
    if (button) button.disabled = !target.checked;
    return;
  }
  if (action === 'approve-deposit') {
    const form = document.getElementById('deposit-approval-form');
    form.elements.reference.value = target.dataset.reference;
    form.elements.settlementReference.value = '';
    form.elements.custodianCleared.checked = false;
    document.getElementById('deposit-approval-dialog').showModal();
    return;
  }
  if (action === 'export-ledger') download('oakstone-house-book.csv', csv([['Date','Reference','Account','Description','Amount','Status'], ...state.data.ledger.map((row) => [row.date,row.ref,row.account,row.description,row.amount,row.status])]));
  if (action === 'export-clients') download('oakstone-clients.csv', csv([['Client','Mandate','House book','Status','Last review'], ...state.data.clients.map((client) => [client.name,client.type,client.value,client.status,client.reviewed])]));
  if (action === 'export-requests') download('oakstone-client-requests.csv', csv([['Date','Reference','Client','Request','Account','Status'], ...requestEvents().map((request) => [request.date,request.ref,request.actor,request.action,request.target,request.status])]));
  if (action === 'approve-client') {
    target.disabled = true;
    try {
      const response = await fetch(`/api/staff/clients/${encodeURIComponent(target.dataset.email)}/approve`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ identityChecked: true }) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Client access could not be approved.');
      toast('Client access approved');
      await loadDashboard();
    } catch (error) {
      target.disabled = false;
      toast(error.message);
    }
  }
});
document.addEventListener('submit', async (event) => {
  const depositForm = event.target.closest('#deposit-approval-form');
  if (depositForm) {
    event.preventDefault();
    const button = depositForm.querySelector('button[type="submit"]');
    button.disabled = true;
    try {
      const reference = depositForm.elements.reference.value;
      const response = await fetch(`/api/staff/requests/${encodeURIComponent(reference)}/approve-deposit`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          settlementReference: depositForm.elements.settlementReference.value.trim(),
          custodianCleared: depositForm.elements.custodianCleared.checked
        })
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'The deposit could not be approved.');
      document.getElementById('deposit-approval-dialog').close();
      depositForm.reset();
      toast(`Deposit approved; ${result.currency} NAV and cash updated`);
      await loadDashboard();
    } catch (error) { toast(error.message); }
    finally { button.disabled = false; }
    return;
  }
  const portfolioForm = event.target.closest('#staff-portfolio-data-form');
  if (portfolioForm) {
    event.preventDefault();
    const button = portfolioForm.querySelector('button[type="submit"]');
    button.disabled = true;
    try {
      const email = portfolioForm.elements.email.value.trim();
      const response = await fetch(`/api/staff/clients/${encodeURIComponent(email)}/portfolio-data`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          accountReference: portfolioForm.elements.accountReference.value.trim(),
          nav: portfolioForm.elements.nav.valueAsNumber,
          cash: portfolioForm.elements.cash.valueAsNumber,
          sourceReference: portfolioForm.elements.sourceReference.value.trim(),
          dataChecked: portfolioForm.elements.dataChecked.checked
        })
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Portfolio balances could not be updated.');
      portfolioForm.reset();
      toast('Verified balances saved');
      await loadDashboard();
    } catch (error) { toast(error.message); }
    finally { button.disabled = false; }
    return;
  }
  const createForm = event.target.closest('#staff-account-create-form');
  if (createForm) {
    event.preventDefault();
    const button = createForm.querySelector('button[type="submit"]');
    button.disabled = true;
    try {
      const email = createForm.elements.email.value.trim();
      const response = await fetch(`/api/staff/clients/${encodeURIComponent(email)}/create-account`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          accountReference: createForm.elements.accountReference.value.trim(),
          accountId: createForm.elements.accountId.value.trim(),
          accountName: createForm.elements.accountName.value.trim(),
          currency: createForm.elements.currency.value.trim(),
          identityChecked: createForm.elements.identityChecked.checked
        })
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Client account could not be created.');
      createForm.reset();
      createForm.elements.currency.value = 'USD';
      toast(result.accountIdType === 'internal' ? `Linked with internal account ID ${result.accountId}` : 'Account created and linked');
      await loadDashboard();
    } catch (error) { toast(error.message); }
    finally { button.disabled = false; }
    return;
  }
  const linkForm = event.target.closest('#staff-account-link-form');
  if (linkForm) {
    event.preventDefault();
    const button = linkForm.querySelector('button[type="submit"]');
    button.disabled = true;
    try {
      const email = linkForm.elements.email.value.trim();
      const response = await fetch(`/api/staff/clients/${encodeURIComponent(email)}/link-account`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ accountReference: linkForm.elements.accountReference.value.trim(), identityChecked: linkForm.elements.identityChecked.checked }) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Client account could not be linked.');
      linkForm.reset();
      toast('Staff identity attestation recorded');
      await loadDashboard();
    } catch (error) { toast(error.message); }
    finally { button.disabled = false; }
    return;
  }
  const form = event.target.closest('#staff-support-form');
  if (!form) return;
  event.preventDefault();
  const button = form.querySelector('button[type="submit"]');
  const message = form.elements.message.value.trim();
  if (!message) return;
  button.disabled = true;
  try {
    const response = await fetch(`/api/staff/support/${encodeURIComponent(form.dataset.supportEmail)}/messages`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message })
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || 'Your reply could not be sent.');
    form.reset();
    await loadSupportInbox(true);
    toast('Reply sent to client');
  } catch (error) {
    toast(error.message);
  } finally {
    button.disabled = false;
  }
});
document.getElementById('year').textContent = new Date().getFullYear();
document.addEventListener('keydown', (event) => { if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') { event.preventDefault(); document.getElementById('global-search').focus(); } });
async function loadDashboard() {
  const session = await fetch('/api/session').then((response) => response.json());
  if (!session.user || session.user.role !== 'staff') return location.replace('/');
  const name = session.user.name || 'Operations user';
  document.getElementById('staff-name').textContent = name;
  document.getElementById('staff-initials').textContent = initials(name);
  document.getElementById('top-initials').textContent = initials(name);
  const response = await fetch('/api/staff/overview');
  if (response.status === 401) return location.replace('/');
  state.data = await response.json();
  render();
}
loadDashboard().catch(() => location.replace('/'));
setInterval(() => {
  if (state.view === 'support' && document.visibilityState === 'visible') loadSupportInbox(true);
}, 6000);
