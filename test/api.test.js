const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const net = require('node:net');
const path = require('node:path');
const { setTimeout: delay } = require('node:timers/promises');
const { test } = require('node:test');

const root = path.join(__dirname, '..');
const staffEmail = 'staff@example.test';
const staffPassword = 'test-staff-password-1234';
let child;
let baseUrl;
let cookie = '';
let latestSetCookie = '';
let output = '';

async function reservePort() {
  const server = net.createServer();
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const { port } = server.address();
  await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  return port;
}

async function request(pathname, options = {}) {
  const headers = { ...options.headers };
  if (cookie) headers.Cookie = cookie;
  const response = await fetch(`${baseUrl}${pathname}`, { ...options, headers });
  latestSetCookie = response.headers.get('set-cookie') || '';
  const sessionCookie = latestSetCookie.match(/(?:^|,\s*)oakstone\.sid=([^;,]*)/);
  if (sessionCookie) cookie = `oakstone.sid=${sessionCookie[1]}`;
  const contentType = response.headers.get('content-type') || '';
  const body = contentType.includes('application/json') ? await response.json() : await response.text();
  return { response, body };
}

async function jsonRequest(pathname, body, method = 'POST') {
  return request(pathname, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
}

test('isolated API integration', async (t) => {
  const port = await reservePort();
  baseUrl = `http://127.0.0.1:${port}`;
  const env = {
    ...process.env,
    NODE_ENV: 'test',
    PORT: String(port),
    SESSION_SECRET: 'test-session-secret-that-is-long-enough',
    STAFF_EMAIL: staffEmail,
    STAFF_PASSWORD: staffPassword,
    TEST_CLIENT_ACCOUNTS: JSON.stringify([{ ownerEmail: 'client@example.test', accountId: 'ACCT-1001', clientReference: 'OAK-EC7752D7', name: 'Existing client', status: 'pending', identityVerified: false, nav: 12345, marker: 'preserve-me' }])
  };
  delete env.MONGODB_URI;
  delete env.SMTP_HOST;
  delete env.SMTP_PORT;
  delete env.SMTP_USER;
  delete env.SMTP_PASS;
  delete env.SUPPORT_EMAIL;
  child = spawn(process.execPath, ['server.js'], { cwd: root, env, stdio: ['ignore', 'pipe', 'pipe'] });
  child.stdout.setEncoding('utf8').on('data', (text) => { output += text; });
  child.stderr.setEncoding('utf8').on('data', (text) => { output += text; });

  let ready = false;
  const deadline = Date.now() + 10000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`API process exited during startup.\n${output}`);
    try {
      const response = await fetch(`${baseUrl}/api/health`);
      if (response.ok) {
        ready = true;
        break;
      }
    } catch {}
    await delay(100);
  }
  assert.equal(ready, true, `API process did not become ready.\n${output}`);

  try {
    await t.test('health, static pages, and API routing', async () => {
      const health = await request('/api/health');
      assert.equal(health.response.status, 200);
      assert.equal(health.body.ok, true);
      assert.equal(health.body.userStore, 'memory');
      assert.equal((await request('/')).response.status, 200);
      assert.equal((await request('/client')).response.status, 200);
      assert.equal((await request('/vendor/bootstrap.min.css')).response.status, 200);

      const missing = await request('/api/not-a-route');
      assert.equal(missing.response.status, 404);
      assert.equal(missing.body.error, 'API endpoint not found.');
      for (const method of ['POST', 'PUT', 'PATCH', 'DELETE']) {
        const unsupportedMethod = await request('/api/health', { method });
        assert.equal(unsupportedMethod.response.status, 404, `${method} must not fall through to the site HTML`);
        assert.equal(unsupportedMethod.body.error, 'API endpoint not found.');
      }
      const malformedBody = await request('/api/contact', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{'
      });
      assert.equal(malformedBody.response.status, 400);
      assert.deepEqual(malformedBody.body, { error: 'Invalid JSON request body.' });
      assert.equal((await jsonRequest('/api/contact', [])).response.status, 400);
      const oversizedBody = await request('/api/contact', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: 'x'.repeat(21000) })
      });
      assert.equal(oversizedBody.response.status, 413);
      assert.deepEqual(oversizedBody.body, { error: 'Request body is too large.' });
      assert.equal((await jsonRequest('/api/contact', {
        name: 'Test User', email: 'user@example.test', message: 'Hello from the isolated API test.'
      })).response.status, 503);
    });

    await t.test('registration validation, duplicate prevention, and pending access', async () => {
      assert.equal((await jsonRequest('/api/register/client', null)).response.status, 400);
      assert.equal((await jsonRequest('/api/register/client', { email: 'invalid', password: 'long-enough-password' })).response.status, 400);
      assert.equal((await jsonRequest('/api/register/client', { email: 'a@example.test', password: 'short' })).response.status, 400);
      assert.equal((await jsonRequest('/api/register/client', {
        email: 'long@example.test', password: 'é'.repeat(37)
      })).response.status, 400);

      const registration = await jsonRequest('/api/register/client', {
        email: 'client@example.test', password: 'safe-client-password-123'
      });
      assert.equal(registration.response.status, 201);
      assert.match(registration.body.clientReference, /^OAK-[A-F0-9]{8}$/);
      assert.equal(JSON.stringify(registration.body).includes('passwordHash'), false);
      assert.equal((await jsonRequest('/api/register/client', {
        email: 'CLIENT@example.test', password: 'safe-client-password-123'
      })).response.status, 409);

      const pendingLogin = await jsonRequest('/api/login/client', {
        email: 'client@example.test', password: 'safe-client-password-123'
      });
      assert.equal(pendingLogin.response.status, 401);
    });

    await t.test('role protection and client-only endpoints', async () => {
      assert.equal((await request('/api/session')).body.user, null);
      assert.equal((await jsonRequest('/api/staff/clients/client%40example.test/link-account', { accountReference: 'OAK-EC7752D7', identityChecked: true })).response.status, 401, 'link route requires staff authentication');
      assert.equal((await jsonRequest('/api/staff/clients/client%40example.test/create-account', { accountReference: 'OAK-NEW1001', accountId: 'ACCT-2002', identityChecked: true })).response.status, 401, 'create-account route requires staff authentication');
      assert.equal((await jsonRequest('/api/staff/clients/client%40example.test/investments', { accountReference: 'OAK-NEW1001', amount: 5000, investmentDate: '2026-11-01', expectedReturnAmount: 6000, expectedReturnDate: '2027-11-01', dataChecked: true })).response.status, 401, 'investment records require staff authentication');
      assert.equal((await jsonRequest('/api/staff/requests/REQ-TEST1001/approve-settled', { settlementReference: 'CUST-TEST1001', custodianCleared: true })).response.status, 401, 'settlement approval requires staff authentication');
      for (const pathname of [
        '/api/staff/overview',
        '/api/staff/support/threads',
        '/api/client/portfolio',
        '/api/client/support/messages',
        '/api/client/requests'
      ]) {
        assert.equal((await request(pathname)).response.status, 401, `${pathname} must require authentication`);
      }
      for (const pathname of ['/api/client/support/messages', '/api/client/requests']) {
        const protectedPost = await jsonRequest(pathname, { message: 'Unauthorized request', type: 'withdraw', amount: 1 });
        assert.equal(protectedPost.response.status, 401, `POST ${pathname} must require client authentication`);
      }
      assert.equal((await jsonRequest('/api/login/unknown', {})).response.status, 404);
      assert.equal((await jsonRequest('/api/login/staff', null)).response.status, 400);
      assert.equal((await jsonRequest('/api/login/staff', {
        email: staffEmail, password: 'incorrect-password'
      })).response.status, 401);
      assert.equal((await jsonRequest('/api/login/staff', {
        email: staffEmail, password: 'x'.repeat(73)
      })).response.status, 400);

      const login = await jsonRequest('/api/login/staff', { email: staffEmail, password: staffPassword });
      assert.equal(login.response.status, 200);
      assert.equal(login.body.user.role, 'staff');
      assert.equal(JSON.stringify(login.body).includes('passwordHash'), false);
      assert.ok(cookie.includes('oakstone.sid='));
      assert.match(latestSetCookie, /HttpOnly/i);
      assert.match(latestSetCookie, /SameSite=Lax/i);
      const expiresHeader = latestSetCookie.match(/Expires=([^;]+)/i);
      assert.ok(expiresHeader, 'session cookie should have an expiry');
      const remainingSessionTime = new Date(expiresHeader[1]).getTime() - Date.now();
      assert.ok(remainingSessionTime > 7 * 60 * 60 * 1000);
      assert.ok(remainingSessionTime <= 8 * 60 * 60 * 1000 + 60000);
      assert.equal((await request('/api/session')).body.user.email, staffEmail);
      assert.equal((await request('/api/client/portfolio')).response.status, 401);
    });

    await t.test('staff identity approval and separate account linking', async () => {
      assert.equal((await jsonRequest('/api/login/staff', { email: staffEmail, password: staffPassword })).response.status, 200);
      const overview = await request('/api/staff/overview');
      assert.equal(overview.response.status, 200);
      assert.ok(Array.isArray(overview.body.metrics));
      assert.ok(Array.isArray(overview.body.pendingAccess));
      assert.equal(overview.body.pendingAccess.length, 1);
      assert.equal(overview.body.pendingAccess[0].accountReady, false);
      assert.match(overview.body.pendingAccess[0].userId, /^[a-f\d]{24}$/i);
      assert.equal(overview.body.pendingAccess[0].accountId, null);
      assert.equal((await jsonRequest('/api/staff/clients/client%40example.test/portfolio-data', { accountReference: 'OAK-EC7752D7', nav: 10000, cash: 2000, sourceReference: 'statement-2026-11-04', dataChecked: true })).response.status, 404, 'staff cannot record balances for an account that is not active and verified');

      const threads = await request('/api/staff/support/threads');
      assert.equal(threads.response.status, 200);
      assert.deepEqual(threads.body.threads, []);
      assert.equal((await request('/api/staff/support/client%40example.test/messages')).response.status, 404);
      assert.equal((await jsonRequest('/api/staff/support/client%40example.test/messages', {
        message: 'This client is not active.'
      })).response.status, 404);
      assert.equal((await jsonRequest('/api/staff/clients/client%40example.test/approve', {})).response.status, 400, 'approval requires explicit identity attestation');
      const approval = await jsonRequest('/api/staff/clients/client%40example.test/approve', { identityChecked: true });
      assert.equal(approval.response.status, 200, 'staff can approve login before portfolio linking');
      assert.equal(approval.body.identityVerified, true);
      await jsonRequest('/api/logout', {});
      const unlinkedClientLogin = await jsonRequest('/api/login/client', { email: 'client@example.test', password: 'safe-client-password-123' });
      assert.equal(unlinkedClientLogin.response.status, 200);
      const unlinkedPortfolio = await request('/api/client/portfolio');
      assert.equal(unlinkedPortfolio.response.status, 200);
      assert.equal(unlinkedPortfolio.body.accountLinked, false, 'unlinked clients can sign in without seeing portfolio data');
      assert.equal((await jsonRequest('/api/client/requests', { type: 'deposit', amount: 100 })).response.status, 409, 'deposits require a verified linked account');
      await jsonRequest('/api/logout', {});
      assert.equal((await jsonRequest('/api/login/staff', { email: staffEmail, password: staffPassword })).response.status, 200);
      const setupRegistration = await jsonRequest('/api/register/client', { email: 'setup-client@example.test', password: 'safe-setup-password-456' });
      assert.equal(setupRegistration.response.status, 201);
      assert.equal((await jsonRequest('/api/staff/clients/setup-client%40example.test/create-account', { accountReference: 'OAK-SETUP1001', accountId: 'ACCT-2002', currency: 'USD', identityChecked: false })).response.status, 400, 'account creation requires explicit identity attestation');
      const createdAccount = await jsonRequest('/api/staff/clients/setup-client%40example.test/create-account', { accountReference: 'OAK-SETUP1001', currency: 'USD', identityChecked: true });
      assert.equal(createdAccount.response.status, 201, 'staff can create and link an account for a registered client');
      assert.match(createdAccount.body.accountId, /^OAK-ACC-[A-F0-9]{16}$/);
      assert.equal(createdAccount.body.accountIdType, 'internal');
      const setupOverview = await request('/api/staff/overview');
      const setupAccess = setupOverview.body.pendingAccess.find((client) => client.email === 'setup-client@example.test');
      assert.equal(setupAccess.accountId, createdAccount.body.accountId, 'access requests include the generated account ID');
      const missingDataAttestation = await jsonRequest('/api/staff/clients/setup-client%40example.test/portfolio-data', { accountReference: 'OAK-SETUP1001', nav: 15000, cash: 3500, sourceReference: 'statement-2026-11-04', dataChecked: false });
      assert.equal(missingDataAttestation.response.status, 400, 'balance updates require staff source attestation');
      const savedPortfolioData = await jsonRequest('/api/staff/clients/setup-client%40example.test/portfolio-data', { accountReference: 'OAK-SETUP1001', nav: 15000.75, cash: 6500.25, sourceReference: 'statement-2026-11-04', dataChecked: true });
      assert.equal(savedPortfolioData.response.status, 200);
      assert.equal(savedPortfolioData.body.nav, 15000.75);
      assert.equal(savedPortfolioData.body.cash, 6500.25);
      const duplicateAccount = await jsonRequest('/api/staff/clients/setup-client%40example.test/create-account', { accountReference: 'OAK-SETUP1001', currency: 'USD', identityChecked: true });
      assert.equal(duplicateAccount.response.status, 409, 'duplicate account identifiers are rejected');
      const setupApproval = await jsonRequest('/api/staff/clients/setup-client%40example.test/approve', { identityChecked: true });
      assert.equal(setupApproval.response.status, 200);
      await jsonRequest('/api/logout', {});
      const setupClientLogin = await jsonRequest('/api/login/client', { email: 'setup-client@example.test', password: 'safe-setup-password-456' });
      assert.equal(setupClientLogin.response.status, 200);
      const setupPortfolio = await request('/api/client/portfolio');
      assert.equal(setupPortfolio.response.status, 200);
      assert.equal(setupPortfolio.body.accountLinked, true);
      assert.equal(setupPortfolio.body.nav, 15000.75, 'staff-recorded NAV appears in the client portfolio');
      assert.equal(setupPortfolio.body.cash, 6500.25, 'staff-recorded cash appears in the client portfolio');
      assert.equal((await jsonRequest('/api/client/requests', { type: 'withdraw', amount: 1 })).response.status, 201, 'withdrawal requests use the recorded cash balance');
      const depositRequest = await jsonRequest('/api/client/requests', { type: 'deposit', amount: 125.75, note: 'Custodian deposit test' });
      assert.equal(depositRequest.response.status, 201);
      assert.equal(depositRequest.body.request.status, 'Pending review');
      assert.equal((await request('/api/client/portfolio')).body.cash, 6500.25, 'request submission does not change balances');
      await jsonRequest('/api/logout', {});
      assert.equal((await jsonRequest('/api/login/staff', { email: staffEmail, password: staffPassword })).response.status, 200);
      const pendingDepositOverview = await request('/api/staff/overview');
      const pendingDepositEvent = pendingDepositOverview.body.audit.find((event) => event.reference === depositRequest.body.request.reference);
      assert.equal(pendingDepositEvent.type, 'deposit');
      assert.equal(pendingDepositEvent.status, 'Pending review');
      assert.equal(pendingDepositEvent.email, 'setup-client@example.test');
      const missingSettlementRef = await jsonRequest(`/api/staff/requests/${depositRequest.body.request.reference}/approve-settled`, { custodianCleared: true });
      assert.equal(missingSettlementRef.response.status, 400, 'approval requires a custodian settlement reference');
      const missingCustodianConfirmation = await jsonRequest(`/api/staff/requests/${depositRequest.body.request.reference}/approve-settled`, { settlementReference: 'CUST-SETTLE-1001', custodianCleared: false });
      assert.equal(missingCustodianConfirmation.response.status, 400, 'approval requires staff confirmation of custodian clearance');
      const depositApproval = await jsonRequest(`/api/staff/requests/${depositRequest.body.request.reference}/approve-settled`, { settlementReference: 'CUST-SETTLE-1001', custodianCleared: true });
      assert.equal(depositApproval.response.status, 200);
      assert.equal(depositApproval.body.nav, 15126.5);
      assert.equal(depositApproval.body.cash, 6626);
      const duplicateDepositApproval = await jsonRequest(`/api/staff/requests/${depositRequest.body.request.reference}/approve-settled`, { settlementReference: 'CUST-SETTLE-1001', custodianCleared: true });
      assert.equal(duplicateDepositApproval.response.status, 409, 'a deposit can only be credited once');
      const approvedDepositOverview = await request('/api/staff/overview');
      const approvedDepositEvent = approvedDepositOverview.body.audit.find((event) => event.reference === depositRequest.body.request.reference);
      assert.equal(approvedDepositEvent.status, 'Paid');
      await jsonRequest('/api/logout', {});
      assert.equal((await jsonRequest('/api/login/client', { email: 'setup-client@example.test', password: 'safe-setup-password-456' })).response.status, 200);
      const afterDeposit = await request('/api/client/portfolio');
      assert.equal(afterDeposit.body.nav, 15126.5);
      assert.equal(afterDeposit.body.cash, 6626);
      const afterDepositRequests = await request('/api/client/requests');
      assert.equal(afterDepositRequests.body.requests.find((item) => item.reference === depositRequest.body.request.reference).status, 'Paid');
      assert.equal((await jsonRequest('/api/client/requests', { type: 'invest', amount: 7000, tier: 'bronze' })).response.status, 400, 'investment requests cannot exceed available cash');
      const settledWithdrawal = await jsonRequest('/api/client/requests', { type: 'withdraw', amount: 1000 });
      assert.equal(settledWithdrawal.response.status, 201);
      const settledInvestment = await jsonRequest('/api/client/requests', { type: 'invest', amount: 5000, tier: 'bronze' });
      assert.equal(settledInvestment.response.status, 201);
      await jsonRequest('/api/logout', {});
      assert.equal((await jsonRequest('/api/login/staff', { email: staffEmail, password: staffPassword })).response.status, 200);
      const withdrawalSettlement = await jsonRequest(`/api/staff/requests/${settledWithdrawal.body.request.reference}/approve-settled`, { settlementReference: 'CUST-WITHDRAW-1001', custodianCleared: true });
      assert.equal(withdrawalSettlement.response.status, 200);
      assert.equal(withdrawalSettlement.body.nav, 14126.5);
      assert.equal(withdrawalSettlement.body.cash, 5626);
      const investmentSettlement = await jsonRequest(`/api/staff/requests/${settledInvestment.body.request.reference}/approve-settled`, { settlementReference: 'CUST-INVEST-1001', custodianCleared: true });
      assert.equal(investmentSettlement.response.status, 200);
      assert.equal(investmentSettlement.body.nav, 14126.5, 'investment settlement preserves NAV as cash converts to holdings');
      assert.equal(investmentSettlement.body.cash, 626);
      assert.equal((await jsonRequest(`/api/staff/requests/${settledInvestment.body.request.reference}/approve-settled`, { settlementReference: 'CUST-INVEST-1001', custodianCleared: true })).response.status, 409, 'settled investments cannot be credited twice');
      const investmentDate = new Date().toISOString().slice(0, 10);
      const expectedReturnDate = new Date(Date.now() + 86400000).toISOString().slice(0, 10);
      const investmentDetails = { accountReference: 'OAK-SETUP1001', amount: 5000, investmentDate, expectedReturnAmount: 6000, expectedReturnDate, dataChecked: true };
      assert.equal((await jsonRequest('/api/staff/clients/setup-client%40example.test/investments', { ...investmentDetails, investmentDate: '2026-02-31' })).response.status, 400, 'invalid calendar dates are rejected');
      assert.equal((await jsonRequest('/api/staff/clients/setup-client%40example.test/investments', { ...investmentDetails, dataChecked: false })).response.status, 400, 'staff must attest to the investment details');
      const recordedInvestment = await jsonRequest('/api/staff/clients/setup-client%40example.test/investments', investmentDetails);
      assert.equal(recordedInvestment.response.status, 201, 'staff can record verified client investment details');
      assert.equal(recordedInvestment.body.investment.amount, 5000);
      assert.equal(recordedInvestment.body.investment.expectedReturnAmount, 6000);
      assert.equal(recordedInvestment.body.investment.expectedReturnDate, expectedReturnDate);
      await jsonRequest('/api/logout', {});
      assert.equal((await jsonRequest('/api/login/client', { email: 'setup-client@example.test', password: 'safe-setup-password-456' })).response.status, 200);
      const afterInvestment = await request('/api/client/portfolio');
      assert.equal(afterInvestment.body.nav, 14126.5);
      assert.equal(afterInvestment.body.cash, 626);
      assert.equal(afterInvestment.body.investments.length, 2, 'settled and staff-recorded investments appear in the client portfolio');
      assert.ok(afterInvestment.body.investments.some((record) => record.reference === settledInvestment.body.request.reference && record.status === 'Paid'), 'settled investment requests appear as paid investment activity');
      assert.ok(afterInvestment.body.investments.some((record) => record.reference === recordedInvestment.body.investment.reference && record.investmentDate === investmentDate), 'staff-recorded investment details appear in the client portfolio');
      const afterInvestmentRequests = await request('/api/client/requests');
      assert.equal(afterInvestmentRequests.body.requests.find((item) => item.reference === settledInvestment.body.request.reference).status, 'Paid');
      assert.equal(afterInvestmentRequests.body.requests.find((item) => item.reference === settledWithdrawal.body.request.reference).status, 'Completed');
      assert.equal((await jsonRequest('/api/staff/clients/setup-client%40example.test/investments', investmentDetails)).response.status, 401, 'clients cannot create staff investment records');
      await jsonRequest('/api/logout', {});
      assert.equal((await jsonRequest('/api/login/staff', { email: staffEmail, password: staffPassword })).response.status, 200);
      assert.equal((await jsonRequest('/api/staff/clients/client%40example.test/link-account', { accountReference: 'OAK-EC7752D7', identityChecked: false })).response.status, 400, 'explicit staff attestation is required');
      assert.equal((await jsonRequest('/api/staff/clients/client%40example.test/link-account', { accountReference: 'wrong-reference', identityChecked: true })).response.status, 404, 'account reference must exactly match');
      assert.equal((await jsonRequest('/api/staff/clients/other%40example.test/link-account', { accountReference: 'OAK-EC7752D7', identityChecked: true })).response.status, 404, 'owner email must match exactly');
      const linked = await jsonRequest('/api/staff/clients/client%40example.test/link-account', { accountReference: 'OAK-EC7752D7', identityChecked: true });
      assert.equal(linked.response.status, 200);
      assert.equal(linked.body.verificationMethod, 'staff_attestation');
      assert.ok(linked.body.verifiedAt);
      await jsonRequest('/api/logout', {});
      const clientSession = await jsonRequest('/api/login/client', { email: 'client@example.test', password: 'safe-client-password-123' });
      assert.equal(clientSession.response.status, 200);
      const linkedPortfolio = await request('/api/client/portfolio');
      assert.equal(linkedPortfolio.response.status, 200);
      assert.equal(linkedPortfolio.body.accountLinked, true, 'verified account is available after approval');
      assert.equal(linkedPortfolio.body.accountId, 'ACCT-1001');
      assert.equal(linkedPortfolio.body.nav, 12345, 'linking preserves unrelated account data');
      assert.equal((await jsonRequest('/api/staff/clients/client%40example.test/link-account', { accountReference: 'OAK-EC7752D7', identityChecked: true })).response.status, 401, 'clients cannot invoke staff linking route');
      await jsonRequest('/api/logout', {});
      assert.equal((await jsonRequest('/api/login/staff', { email: staffEmail, password: staffPassword })).response.status, 200);
      assert.equal((await jsonRequest('/api/staff/support/client%40example.test/messages', {
        message: ''
      })).response.status, 400);
    });

    await t.test('logout invalidates the session', async () => {
      const logout = await jsonRequest('/api/logout', {});
      assert.equal(logout.response.status, 200);
      assert.equal(logout.body.ok, true);
      assert.equal((await request('/api/session')).body.user, null);
      assert.equal((await jsonRequest('/api/staff/clients/client%40example.test/link-account', { accountReference: 'OAK-EC7752D7', identityChecked: true })).response.status, 401, 'link route requires staff authentication');
      assert.equal((await request('/api/staff/overview')).response.status, 401);
    });
  } finally {
    if (child && child.exitCode === null) {
      child.kill();
      await Promise.race([
        new Promise((resolve) => child.once('exit', resolve)),
        delay(3000)
      ]);
    }
  }
});
