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

    await t.test('staff operations and verified-account approval guard', async () => {
      assert.equal((await jsonRequest('/api/login/staff', { email: staffEmail, password: staffPassword })).response.status, 200);
      const overview = await request('/api/staff/overview');
      assert.equal(overview.response.status, 200);
      assert.ok(Array.isArray(overview.body.metrics));
      assert.ok(Array.isArray(overview.body.pendingAccess));
      assert.equal(overview.body.pendingAccess.length, 1);
      assert.equal(overview.body.pendingAccess[0].accountReady, false);

      const threads = await request('/api/staff/support/threads');
      assert.equal(threads.response.status, 200);
      assert.deepEqual(threads.body.threads, []);
      assert.equal((await request('/api/staff/support/client%40example.test/messages')).response.status, 404);
      assert.equal((await jsonRequest('/api/staff/support/client%40example.test/messages', {
        message: 'This client is not active.'
      })).response.status, 404);
      assert.equal((await jsonRequest('/api/staff/clients/client%40example.test/approve', {})).response.status, 409);
      assert.equal((await jsonRequest('/api/staff/clients/client%40example.test/link-account', { accountReference: 'OAK-EC7752D7', identityChecked: false })).response.status, 400, 'explicit staff attestation is required');
      assert.equal((await jsonRequest('/api/staff/clients/client%40example.test/link-account', { accountReference: 'wrong-reference', identityChecked: true })).response.status, 404, 'account reference must exactly match');
      assert.equal((await jsonRequest('/api/staff/clients/other%40example.test/link-account', { accountReference: 'OAK-EC7752D7', identityChecked: true })).response.status, 404, 'owner email must match exactly');
      const linked = await jsonRequest('/api/staff/clients/client%40example.test/link-account', { accountReference: 'OAK-EC7752D7', identityChecked: true });
      assert.equal(linked.response.status, 200);
      assert.equal(linked.body.verificationMethod, 'staff_attestation');
      assert.ok(linked.body.verifiedAt);
      const approval = await jsonRequest('/api/staff/clients/client%40example.test/approve', {});
      assert.equal(approval.response.status, 200, 'existing approval flow succeeds after staff link and attestation');
      const clientLogin = await jsonRequest('/api/logout', {});
      assert.equal(clientLogin.response.status, 200);
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
