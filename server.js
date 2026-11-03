const express = require('express');
const session = require('express-session');
const bcrypt = require('bcryptjs');
const { MongoClient } = require('mongodb');
const MongoStore = require('connect-mongo');
const nodemailer = require('nodemailer');
const { randomBytes } = require('crypto');
const brand = require('./brand');
const path = require('path');

const app = express();
const PORT = Number(process.env.PORT || 3000);
const SESSION_SECRET = process.env.SESSION_SECRET || randomBytes(32).toString('hex');
const isProduction = process.env.NODE_ENV === 'production';
const investmentTiers = {
  bronze: { label: 'Bronze', min: 5000, max: 34999 },
  silver: { label: 'Silver', min: 35000, max: 149999 },
  gold: { label: 'Gold', min: 150000, max: 499999 },
  diamond: { label: 'Diamond', min: 500000, max: 1000000 }
};
if (isProduction && !process.env.SESSION_SECRET) throw new Error('SESSION_SECRET must be configured in production.');
if (isProduction && !process.env.MONGODB_URI) throw new Error('MONGODB_URI must be configured in production.');
if (Boolean(process.env.STAFF_EMAIL) !== Boolean(process.env.STAFF_PASSWORD)) throw new Error('Set both STAFF_EMAIL and STAFF_PASSWORD to provision an operations user.');
if (process.env.STAFF_PASSWORD && process.env.STAFF_PASSWORD.length < 12) throw new Error('STAFF_PASSWORD must contain at least 12 characters.');
if (process.env.STAFF_PASSWORD && Buffer.byteLength(process.env.STAFF_PASSWORD, 'utf8') > 72) throw new Error('STAFF_PASSWORD must not exceed 72 UTF-8 bytes.');
if (process.env.STAFF_EMAIL && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(process.env.STAFF_EMAIL)) throw new Error('STAFF_EMAIL must be a valid email address.');
if (isProduction) app.set('trust proxy', 1);
app.disable('x-powered-by');
app.use(express.json({ limit: '20kb' }));
app.use(express.urlencoded({ extended: false }));
app.use((req, _res, next) => {
  if (!req.body || typeof req.body !== 'object' || Array.isArray(req.body)) req.body = {};
  next();
});

const staffSeed = process.env.STAFF_EMAIL && process.env.STAFF_PASSWORD ? { email: process.env.STAFF_EMAIL.toLowerCase(), password: process.env.STAFF_PASSWORD, role: 'staff', name: process.env.STAFF_NAME || 'Operations user' } : null;
const memoryUsers = new Map();
const memoryClientRequests = [];
const memorySupportMessages = [];
const publicContactAttempts = new Map();
const supportMessageStore = {
  create: async (message) => { memorySupportMessages.push(message); return message; },
  byEmail: async (email) => memorySupportMessages.filter((message) => message.email === email).slice(-200),
  listThreads: async () => {
    const threads = new Map();
    for (const message of memorySupportMessages) {
      const current = threads.get(message.email);
      if (!current || current.createdAt < message.createdAt) threads.set(message.email, message);
    }
    return [...threads.values()].sort((a, b) => b.createdAt - a.createdAt).slice(0, 100).map((latest) => ({
      email: latest.email, name: latest.clientName, latestMessage: latest.text, latestAt: latest.createdAt
    }));
  }
};
let clientRequestStore = {
  create: async (request) => { memoryClientRequests.unshift(request); return request; },
  byEmail: async (email) => memoryClientRequests.filter((request) => request.email === email).slice(0, 20),
  latest: async () => memoryClientRequests.slice(0, 6),
  countPending: async () => memoryClientRequests.filter((request) => request.status === 'Pending review').length
};
const memoryClientAccounts = process.env.NODE_ENV === 'test' && process.env.TEST_CLIENT_ACCOUNTS ? JSON.parse(process.env.TEST_CLIENT_ACCOUNTS) : [];
const memoryAccountLinkAudit = [];
let clientAccountStore = { findByEmail: async () => null, listActive: async () => [], findActiveForLink: async () => null, linkVerifiedAccount: async () => false };
let accountLinkAuditStore = { record: async (event) => { memoryAccountLinkAudit.push(event); } };
let houseBookStore = { list: async () => [] };
let priceStore = { list: async () => [] };
let userStore = {
  find: async (email) => memoryUsers.get(email.toLowerCase()) || null,
  create: async (user) => {
    if (memoryUsers.has(user.email)) return false;
    memoryUsers.set(user.email, user);
    return true;
  },
  listPending: async () => [...memoryUsers.values()].filter((user) => user.role === 'client' && user.status === 'pending'),
  approve: async (email) => {
    const user = memoryUsers.get(email.toLowerCase());
    if (!user || user.role !== 'client' || user.status !== 'pending') return false;
    user.status = 'active';
    memoryUsers.set(user.email, user);
    return true;
  }
};
let mongoClient;
let storeMode = 'memory';

async function initializeUsers() {
  const seeds = staffSeed ? [staffSeed] : [];
  if (process.env.MONGODB_URI) {
    try {
      mongoClient = new MongoClient(process.env.MONGODB_URI, { maxPoolSize: 10, serverSelectionTimeoutMS: 10000 });
      await mongoClient.connect();
      const database = mongoClient.db(process.env.MONGODB_DB || 'oakstone_portal');
      const collection = database.collection('users');
      await collection.createIndex({ email: 1 }, { unique: true });
      for (const seed of seeds) {
        const email = seed.email.toLowerCase();
        const exists = await collection.findOne({ email });
        if (!exists) await collection.insertOne({ email, role: seed.role, name: seed.name, clientReference: seed.role === 'client' ? 'OAK-CLIENT-0001' : undefined, passwordHash: await bcrypt.hash(seed.password, 12), createdAt: new Date() });
      }
      userStore = {
        find: async (email) => collection.findOne({ email: email.toLowerCase() }),
        create: async (user) => {
          try { await collection.insertOne(user); return true; }
          catch (error) { if (error.code === 11000) return false; throw error; }
        },
        listPending: async () => collection.find({ role: 'client', status: 'pending' }, { projection: { email: 1, name: 1, clientReference: 1, createdAt: 1 } }).sort({ createdAt: -1 }).limit(100).toArray(),
        approve: async (email) => {
          const result = await collection.updateOne({ email: email.toLowerCase(), role: 'client', status: 'pending' }, { $set: { status: 'active', approvedAt: new Date() } });
          return result.modifiedCount === 1;
        }
      };
      const requests = database.collection('client_requests');
      await requests.createIndex({ email: 1, createdAt: -1 });
      await requests.createIndex({ createdAt: -1 });
      clientRequestStore = {
        create: async (request) => { await requests.insertOne(request); return request; },
        byEmail: async (email) => requests.find({ email }).sort({ createdAt: -1 }).limit(20).toArray(),
        latest: async () => requests.find({}).sort({ createdAt: -1 }).limit(6).toArray(),
        countPending: async () => requests.countDocuments({ status: 'Pending review' })
      };
      const supportMessages = database.collection('support_messages');
      await supportMessages.createIndex({ email: 1, createdAt: 1 });
      supportMessageStore.create = async (message) => {
        await supportMessages.insertOne(message);
        return message;
      };
      supportMessageStore.byEmail = async (email) => (await supportMessages.find({ email }).sort({ createdAt: -1 }).limit(200).toArray()).reverse();
      supportMessageStore.listThreads = async () => supportMessages.aggregate([
        { $sort: { createdAt: -1 } },
        { $group: { _id: '$email', latest: { $first: '$$ROOT' } } },
        { $sort: { 'latest.createdAt': -1 } },
        { $limit: 100 },
        { $project: { _id: 0, email: '$_id', name: '$latest.clientName', latestMessage: '$latest.text', latestAt: '$latest.createdAt' } }
      ]).toArray();
      const accounts = database.collection('client_accounts');
      clientAccountStore = {
        findByEmail: async (email) => accounts.findOne({ ownerEmail: email, status: 'active', identityVerified: true }),
        listActive: async () => accounts.find({ status: 'active', identityVerified: true }).toArray(),
        findActiveForLink: async (email, accountReference) => accounts.find({ ownerEmail: email, accountId: accountReference, status: 'active' }).limit(2).toArray(),
        linkVerifiedAccount: async ({ email, accountReference, verifier, verifiedAt }) => {
          const result = await accounts.updateOne(
            { ownerEmail: email, accountId: accountReference, status: 'active' },
            { $set: { status: 'active', identityVerified: true, identityVerifiedBy: verifier.email, identityVerifiedByName: verifier.name, identityVerifiedAt: verifiedAt } }
          );
          return result.matchedCount === 1;
        }
      };
      const accountLinkAudit = database.collection('account_link_audit');
      await accountLinkAudit.createIndex({ targetEmail: 1, createdAt: -1 });
      accountLinkAuditStore = { record: async (event) => { await accountLinkAudit.insertOne(event); } };
      const houseBook = database.collection('house_book');
      houseBookStore = { list: async () => houseBook.find({}).sort({ createdAt: -1 }).limit(100).toArray() };
      const prices = database.collection('market_prices');
      priceStore = { list: async () => prices.find({ status: 'approved' }).sort({ symbol: 1 }).limit(100).toArray() };
      storeMode = 'mongodb';
    } catch (error) {
      console.warn('MongoDB unavailable; using in-memory storage:', error.message);
      if (mongoClient) await mongoClient.close().catch(() => {});
      mongoClient = undefined;
      if (isProduction) throw error;
    }
  }
  if (storeMode === 'memory') {
    for (const seed of seeds) memoryUsers.set(seed.email, { email: seed.email, role: seed.role, name: seed.name, clientReference: seed.role === 'client' ? 'OAK-CLIENT-0001' : undefined, passwordHash: await bcrypt.hash(seed.password, 12) });
    clientAccountStore = {
      findByEmail: async (email) => memoryClientAccounts.find((account) => account.ownerEmail === email && account.status === 'active' && account.identityVerified === true) || null,
      listActive: async () => memoryClientAccounts.filter((account) => account.status === 'active' && account.identityVerified === true),
      findActiveForLink: async (email, accountReference) => memoryClientAccounts.filter((account) => account.ownerEmail === email && account.accountId === accountReference && account.status === 'active').slice(0, 2),
      linkVerifiedAccount: async ({ email, accountReference, verifier, verifiedAt }) => {
        const account = memoryClientAccounts.find((item) => item.ownerEmail === email && item.accountId === accountReference);
        if (!account) return false;
        Object.assign(account, { status: 'active', identityVerified: true, identityVerifiedBy: verifier.email, identityVerifiedByName: verifier.name, identityVerifiedAt: verifiedAt });
        return true;
      }
    };
  }
}

const sessionOptions = {
  name: 'oakstone.sid',
  secret: SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  cookie: { httpOnly: true, sameSite: 'lax', secure: isProduction, maxAge: 8 * 60 * 60 * 1000 }
};
if (process.env.MONGODB_URI) sessionOptions.store = MongoStore.create({
  mongoUrl: process.env.MONGODB_URI,
  dbName: process.env.MONGODB_DB || 'oakstone_portal',
  collectionName: 'sessions',
  ttl: 8 * 60 * 60,
  mongoOptions: { maxPoolSize: 10, serverSelectionTimeoutMS: 10000 }
});
app.use(session(sessionOptions));

const requireRole = (role) => (req, res, next) => {
  if (!req.session.user || req.session.user.role !== role) return res.status(401).json({ error: 'Please sign in to continue.' });
  next();
};

app.get('/api/health', async (_req, res) => {
  if (storeMode === 'mongodb') {
    try {
      await mongoClient.db(process.env.MONGODB_DB || 'oakstone_portal').command({ ping: 1 });
    } catch (error) {
      console.error('MongoDB health check failed:', error.message);
      return res.status(503).json({ ok: false, brand: brand.name, userStore: 'unavailable' });
    }
  }
  res.json({ ok: true, brand: brand.name, userStore: storeMode });
});
app.get('/api/session', (req, res) => res.json({ user: req.session.user || null }));
app.post('/api/contact', async (req, res) => {
  const name = String(req.body.name || '').trim().replace(/[\r\n]/g, ' ').slice(0, 100);
  const email = String(req.body.email || '').trim().toLowerCase();
  const message = String(req.body.message || '').trim().slice(0, 4000);
  const honeypot = String(req.body.website || '').trim();
  if (honeypot) return res.status(400).json({ error: 'Your message could not be sent.' });
  if (!name || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || message.length < 5) {
    return res.status(400).json({ error: 'Enter your name, a valid email address, and a message of at least 5 characters.' });
  }
  const now = Date.now();
  for (const [ip, attempt] of publicContactAttempts) if (now - attempt.startedAt > 15 * 60 * 1000) publicContactAttempts.delete(ip);
  const ip = req.ip || req.socket.remoteAddress || 'unknown';
  const attempt = publicContactAttempts.get(ip);
  if (attempt && now - attempt.startedAt < 15 * 60 * 1000 && attempt.count >= 5) return res.status(429).json({ error: 'Too many messages. Please try again later.' });
  if (!attempt || now - attempt.startedAt >= 15 * 60 * 1000) publicContactAttempts.set(ip, { startedAt: now, count: 1 });
  else attempt.count += 1;
  const { SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, SMTP_FROM, SUPPORT_EMAIL } = process.env;
  const smtpPort = Number(SMTP_PORT);
  if (!SMTP_HOST || !Number.isInteger(smtpPort) || smtpPort < 1 || smtpPort > 65535 || !SMTP_USER || !SMTP_PASS || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(SUPPORT_EMAIL || '')) {
    return res.status(503).json({ error: 'Email contact is not configured yet. Please try again later.' });
  }
  try {
    const transporter = nodemailer.createTransport({
      host: SMTP_HOST,
      port: smtpPort,
      secure: smtpPort === 465,
      auth: { user: SMTP_USER, pass: SMTP_PASS }
    });
    await transporter.sendMail({
      from: SMTP_FROM || SMTP_USER,
      to: SUPPORT_EMAIL,
      replyTo: email,
      subject: `Website contact from ${name}`,
      text: `Name: ${name}\nEmail: ${email}\n\n${message}`
    });
    res.status(202).json({ ok: true });
  } catch (error) {
    console.error('Public contact email failed:', error.message);
    res.status(502).json({ error: 'Your message could not be delivered. Please try again later.' });
  }
});
app.post('/api/login/:audience', async (req, res) => {
  const role = req.params.audience === 'client' ? 'client' : req.params.audience === 'staff' ? 'staff' : null;
  if (!role) return res.status(404).json({ error: 'Unknown sign-in area.' });
  const email = String(req.body.email || '').trim().toLowerCase();
  const password = String(req.body.password || '');
  if (!email || !password) return res.status(400).json({ error: 'Enter your email and password.' });
  if (Buffer.byteLength(password, 'utf8') > 72) return res.status(400).json({ error: 'Password must not exceed 72 UTF-8 bytes.' });
  try {
    const user = await userStore.find(email);
      if (!user || user.role !== role || user.status === 'pending' || (role === 'client' && user.status !== 'active') || !(await bcrypt.compare(password, user.passwordHash))) return res.status(401).json({ error: 'Email or password did not match.' });
    await new Promise((resolve, reject) => req.session.regenerate((err) => err ? reject(err) : resolve()));
    req.session.user = { email: user.email, role: user.role, name: user.name, clientReference: user.clientReference || null };
    await new Promise((resolve, reject) => req.session.save((err) => err ? reject(err) : resolve()));
    res.json({ user: req.session.user });
  } catch (error) {
    console.error('Login failed:', error.message);
    res.status(500).json({ error: 'Sign-in could not be completed.' });
  }
});
app.post('/api/register/client', async (req, res) => {
  const email = String(req.body.email || '').trim().toLowerCase();
  const password = String(req.body.password || '');
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return res.status(400).json({ error: 'Enter a valid email address.' });
  if (password.length < 12) return res.status(400).json({ error: 'Use a password with at least 12 characters.' });
  if (Buffer.byteLength(password, 'utf8') > 72) return res.status(400).json({ error: 'Password must not exceed 72 UTF-8 bytes.' });
  try {
    if (await userStore.find(email)) return res.status(409).json({ error: 'An account with this email already exists.' });
    const user = { email, role: 'client', name: email.split('@')[0], clientReference: `OAK-${randomBytes(4).toString('hex').toUpperCase()}`, status: 'pending', passwordHash: await bcrypt.hash(password, 12), createdAt: new Date() };
    if (!(await userStore.create(user))) return res.status(409).json({ error: 'An account with this email already exists.' });
    res.status(201).json({ ok: true, clientReference: user.clientReference });
  } catch (error) {
    console.error('Client registration failed:', error.message);
    res.status(500).json({ error: 'Account access could not be created.' });
  }
});
app.post('/api/logout', (req, res) => {
  req.session.destroy((error) => {
    if (error) return res.status(500).json({ error: 'Could not sign out.' });
    res.clearCookie('oakstone.sid', { httpOnly: true, sameSite: 'lax', secure: isProduction });
    res.json({ ok: true });
  });
});
app.get('/api/staff/overview', requireRole('staff'), async (_req, res) => {
  try {
    const [accounts, ledgerEntries, prices, recentRequests, openRequestCount] = await Promise.all([
      clientAccountStore.listActive(), houseBookStore.list(), priceStore.list(), clientRequestStore.latest(), clientRequestStore.countPending()
    ]);
    const totalNav = accounts.every((account) => account.nav !== null && account.nav !== undefined && Number.isFinite(Number(account.nav)))
      ? accounts.reduce((total, account) => total + Number(account.nav), 0)
      : null;
    const currencies = new Set(accounts.map((account) => account.currency || 'USD'));
    const currency = currencies.size === 1 ? [...currencies][0] : 'USD';
    const formatMoney = (value, currencyCode = currency) => value !== null && value !== undefined && Number.isFinite(Number(value)) ? new Intl.NumberFormat('en-US', { style: 'currency', currency: currencyCode, maximumFractionDigits: 0 }).format(Number(value)) : '—';
    const pendingUsers = await userStore.listPending();
    const pendingAccess = await Promise.all(pendingUsers.map(async (user) => ({
      email: user.email, name: user.name, clientReference: user.clientReference,
      createdAt: user.createdAt, accountReady: (await clientAccountStore.findByEmail(user.email))?.identityVerified === true
    })));
    const clients = accounts.map((account) => ({
      name: account.name || account.clientReference || 'Client account',
      code: String(account.name || account.clientReference || 'CA').split(/\s+/).map((part) => part[0]).slice(0, 2).join('').toUpperCase(),
      type: account.mandate || account.type || 'Mandate not set',
      value: formatMoney(account.nav, account.currency || currency), status: account.reviewStatus || 'Active',
      reviewed: account.lastReviewedAt ? new Date(account.lastReviewedAt).toLocaleDateString('en-US', { month: 'short', day: '2-digit', year: 'numeric' }) : '—'
    }));
    const allocations = accounts.filter((account) => account.allocation).map((account) => ({
      client: account.name || account.clientReference || 'Client account', initials: clients.find((client) => client.name === (account.name || account.clientReference))?.code || 'CA',
      mix: account.mandate || account.type || 'Mandate', equity: Number(account.allocation.equity || 0), fixed: Number(account.allocation.fixedIncome || 0),
      cash: Number(account.allocation.cash || 0), value: formatMoney(account.nav, account.currency || currency)
    }));
    return res.json({
      metrics: [
        { label: 'Net asset value', value: totalNav === null || currencies.size > 1 ? '—' : formatMoney(totalNav), change: `${accounts.length} linked account${accounts.length === 1 ? '' : 's'}`, icon: '◈' },
        { label: 'Active client accounts', value: String(accounts.length), change: 'Verified account links', icon: '◎' },
        { label: 'Cash available', value: accounts.length && currencies.size === 1 && accounts.every((account) => account.cash !== null && account.cash !== undefined && Number.isFinite(Number(account.cash))) ? formatMoney(accounts.reduce((total, account) => total + Number(account.cash), 0)) : '—', change: 'Account feed', icon: '◌' },
        { label: 'Open requests', value: String(openRequestCount), change: 'Awaiting review', icon: '⌁' }
      ],
      clients,
      pendingAccess,
      ledger: ledgerEntries.map((entry) => ({ date: entry.createdAt ? new Date(entry.createdAt).toLocaleDateString('en-US', { month: 'short', day: '2-digit', year: 'numeric' }) : '—', ref: entry.reference || entry.ref || '—', account: entry.accountName || entry.clientReference || '—', description: entry.description || entry.type || '—', amount: formatMoney(entry.amount, entry.currency || currency), status: entry.status || 'Recorded' })),
      allocations,
      pricing: prices.map((price) => ({ ticker: price.symbol, name: price.name || price.description || '', price: String(price.price ?? '—'), move: String(price.change ?? '—'), up: Number(price.change) >= 0 })),
      audit: recentRequests.map((request) => ({ reference: request.reference, createdAt: request.createdAt, status: request.status, initials: request.type === 'withdraw' ? 'WD' : 'IN', person: request.email, action: `submitted a ${request.type === 'withdraw' ? 'withdrawal' : 'investment'} request`, context: `${request.accountId || request.clientReference || 'Account reference pending'} · ${formatMoney(request.amount, request.currency || currency)}${request.tier && investmentTiers[request.tier] ? ` · ${investmentTiers[request.tier].label}` : ''}`, time: new Date(request.createdAt).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' }) }))
    });
  } catch (error) {
    console.error('Staff overview failed:', error.message);
    res.status(500).json({ error: 'Operations data could not be loaded.' });
  }
});
app.post('/api/staff/clients/:email/approve', requireRole('staff'), async (req, res) => {
  const email = String(req.params.email || '').toLowerCase();
  try {
    const user = await userStore.find(email);
    if (!user || user.role !== 'client' || user.status !== 'pending') return res.status(404).json({ error: 'Pending client access was not found.' });
    const account = await clientAccountStore.findByEmail(email);
    if (!account || account.identityVerified !== true) return res.status(409).json({ error: 'Link and verify the client account before approving access.' });
    if (!(await userStore.approve(email))) return res.status(409).json({ error: 'Client access could not be approved.' });
    res.json({ ok: true });
  } catch (error) {
    console.error('Client access approval failed:', error.message);
    res.status(500).json({ error: 'Client access could not be approved.' });
  }
});
app.post('/api/staff/clients/:email/link-account', requireRole('staff'), async (req, res) => {
  const emailInput = String(req.params.email || '').trim();
  const email = emailInput.toLowerCase();
  const accountReference = typeof req.body.accountReference === 'string' ? req.body.accountReference.trim() : '';
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailInput) || !accountReference || accountReference.length > 120 || /[\r\n]/.test(accountReference)) return res.status(400).json({ error: 'Enter a valid client email and account reference.' });
  if (req.body.identityChecked !== true) return res.status(400).json({ error: 'Confirm that staff checked the client identity before linking.' });
  try {
    const user = await userStore.find(email);
    if (!user || user.role !== 'client' || user.status !== 'pending') return res.status(404).json({ error: 'Pending client access was not found.' });
    const matchingAccounts = await clientAccountStore.findActiveForLink(email, accountReference);
    if (matchingAccounts.length !== 1) return res.status(404).json({ error: 'No unique active account matches this exact email and account reference.' });
    const verifiedAt = new Date();
    const verifier = { email: req.session.user.email, name: req.session.user.name || req.session.user.email };
    if (!(await clientAccountStore.linkVerifiedAccount({ email, accountReference, verifier, verifiedAt }))) return res.status(409).json({ error: 'The matching account could not be updated.' });
    await accountLinkAuditStore.record({ action: 'client_account_identity_attested', targetEmail: email, accountReference, verifierEmail: verifier.email, verifierName: verifier.name, identityChecked: true, verificationMethod: 'staff_attestation', createdAt: verifiedAt });
    return res.json({ ok: true, identityVerified: true, verificationMethod: 'staff_attestation', verifiedAt });
  } catch (error) {
    console.error('Client account link failed:', error.message);
    return res.status(500).json({ error: 'Client account could not be linked.' });
  }
});
app.get('/api/staff/support/threads', requireRole('staff'), async (_req, res) => {
  try { res.json({ threads: await supportMessageStore.listThreads() }); }
  catch (error) { console.error('Support inbox lookup failed:', error.message); res.status(500).json({ error: 'Support conversations could not be loaded.' }); }
});
app.get('/api/staff/support/:email/messages', requireRole('staff'), async (req, res) => {
  const email = String(req.params.email || '').trim().toLowerCase();
  try {
    const user = await userStore.find(email);
    if (!user || user.role !== 'client' || user.status !== 'active') return res.status(404).json({ error: 'Active client was not found.' });
    res.json({ messages: await supportMessageStore.byEmail(email) });
  } catch (error) {
    console.error('Support conversation lookup failed:', error.message);
    res.status(500).json({ error: 'Support conversation could not be loaded.' });
  }
});
app.post('/api/staff/support/:email/messages', requireRole('staff'), async (req, res) => {
  const email = String(req.params.email || '').trim().toLowerCase();
  const text = String(req.body.message || '').trim();
  if (!text || text.length > 2000) return res.status(400).json({ error: 'Enter a message of 1 to 2000 characters.' });
  try {
    const user = await userStore.find(email);
    if (!user || user.role !== 'client' || user.status !== 'active') return res.status(404).json({ error: 'Active client was not found.' });
    const message = { email, clientName: user.name || email, senderRole: 'staff', senderName: req.session.user.name || 'Support team', text, createdAt: new Date() };
    await supportMessageStore.create(message);
    res.status(201).json({ message });
  } catch (error) {
    console.error('Support reply could not be saved:', error.message);
    res.status(500).json({ error: 'Your reply could not be sent.' });
  }
});
app.get('/api/client/portfolio', requireRole('client'), async (req, res) => {
  try {
    const account = await clientAccountStore.findByEmail(req.session.user.email);
    if (!account) return res.json({ name: req.session.user.name, account: 'Account setup pending', accountId: req.session.user.clientReference || 'Pending', accountLinked: false, currency: null, nav: null, performance: null, cash: null, holdings: [] });
    res.json({ name: req.session.user.name, account: account.name || 'Investment account', accountId: account.accountId || req.session.user.clientReference, accountLinked: true, currency: account.currency || 'USD', nav: account.nav ?? null, performance: account.performance ?? null, cash: account.cash ?? null, holdings: account.holdings || [] });
  } catch (error) {
    console.error('Portfolio lookup failed:', error.message);
    res.status(500).json({ error: 'Portfolio information could not be loaded.' });
  }
});
app.get('/api/client/support/messages', requireRole('client'), async (req, res) => {
  try { res.json({ messages: await supportMessageStore.byEmail(req.session.user.email) }); }
  catch (error) { console.error('Client support lookup failed:', error.message); res.status(500).json({ error: 'Your support conversation could not be loaded.' }); }
});
app.post('/api/client/support/messages', requireRole('client'), async (req, res) => {
  const text = String(req.body.message || '').trim();
  if (!text || text.length > 2000) return res.status(400).json({ error: 'Enter a message of 1 to 2000 characters.' });
  try {
    const message = { email: req.session.user.email, clientName: req.session.user.name || req.session.user.email, senderRole: 'client', senderName: req.session.user.name || 'Client', text, createdAt: new Date() };
    await supportMessageStore.create(message);
    res.status(201).json({ message });
  } catch (error) {
    console.error('Client support message could not be saved:', error.message);
    res.status(500).json({ error: 'Your message could not be sent.' });
  }
});
app.get('/api/client/requests', requireRole('client'), async (req, res) => {
  try { res.json({ requests: await clientRequestStore.byEmail(req.session.user.email) }); }
  catch (error) { console.error('Client request lookup failed:', error.message); res.status(500).json({ error: 'Request history could not be loaded.' }); }
});
app.post('/api/client/requests', requireRole('client'), async (req, res) => {
  const type = req.body.type === 'withdraw' || req.body.type === 'invest' ? req.body.type : null;
  const amount = Number(req.body.amount);
  const tierId = type === 'invest' ? String(req.body.tier || '').toLowerCase() : null;
  const tier = tierId && Object.hasOwn(investmentTiers, tierId) ? investmentTiers[tierId] : null;
  const note = String(req.body.note || '').trim().slice(0, 240);
  if (!type) return res.status(400).json({ error: 'Choose a withdrawal or investment request.' });
  if (!Number.isFinite(amount) || amount <= 0 || amount > Number.MAX_SAFE_INTEGER) return res.status(400).json({ error: 'Enter a valid positive amount.' });
  if (type === 'invest' && !tier) return res.status(400).json({ error: 'Choose a valid investment tier.' });
  if (type === 'invest' && (amount < tier.min || amount > tier.max)) return res.status(400).json({ error: `The amount must be between $${tier.min.toLocaleString('en-US')} and $${tier.max.toLocaleString('en-US')} for the ${tier.label} tier.` });
  const createdAt = new Date();
  try {
    const account = await clientAccountStore.findByEmail(req.session.user.email);
    if (!account) return res.status(409).json({ error: 'Link and verify an account before submitting a transaction request.' });
    if (type === 'invest' && (account.currency || 'USD') !== 'USD') return res.status(409).json({ error: 'Investment tiers are denominated in USD and are available only for USD-linked accounts.' });
    if (type === 'withdraw' && Number.isFinite(Number(account.cash)) && amount > Number(account.cash)) return res.status(400).json({ error: 'The request exceeds the available account cash.' });
    const request = { reference: `REQ-${randomBytes(4).toString('hex').toUpperCase()}`, email: req.session.user.email, name: req.session.user.name, clientReference: req.session.user.clientReference || null, accountId: account.accountId || req.session.user.clientReference || null, accountName: account.name || 'Investment account', currency: account.currency || 'USD', type, ...(tier ? { tier: tierId } : {}), amount: amount.toFixed(2), note, status: 'Pending review', createdAt };
    await clientRequestStore.create(request);
    res.status(201).json({ request: { reference: request.reference, account: request.accountName, accountId: request.accountId, currency: request.currency, type: request.type, tier: request.tier || null, amount: request.amount, note: request.note, status: request.status, createdAt: request.createdAt.toISOString() } });
  } catch (error) {
    console.error('Client request could not be saved:', error.message);
    res.status(500).json({ error: 'Your request could not be saved. Please try again.' });
  }
});
app.use('/api', (_req, res) => res.status(404).json({ error: 'API endpoint not found.' }));
app.use((error, _req, res, next) => {
  if (res.headersSent) return next(error);
  if (error.type === 'entity.parse.failed') return res.status(400).json({ error: 'Invalid JSON request body.' });
  if (error.type === 'entity.too.large') return res.status(413).json({ error: 'Request body is too large.' });
  console.error('Request failed:', error.message);
  res.status(500).json({ error: 'Request could not be completed.' });
});
app.get('/vendor/bootstrap.min.css', (_req, res) => res.sendFile(path.join(__dirname, 'node_modules', 'bootstrap', 'dist', 'css', 'bootstrap.min.css')));
app.get('/vendor/bootstrap.bundle.min.js', (_req, res) => res.sendFile(path.join(__dirname, 'node_modules', 'bootstrap', 'dist', 'js', 'bootstrap.bundle.min.js')));
app.get('/brand.js', (_req, res) => res.sendFile(path.join(__dirname, 'brand.js')));
app.use(express.static(path.join(__dirname, 'public'), { index: false }));
app.get('/dashboard', (req, res) => {
  if (!req.session.user || req.session.user.role !== 'staff') return res.redirect('/');
  res.sendFile(path.join(__dirname, 'public', 'dashboard.html'));
});
app.get('/client/register', (_req, res) => res.sendFile(path.join(__dirname, 'public', 'client-register.html')));
app.get('/client', (_req, res) => res.sendFile(path.join(__dirname, 'public', 'client-login.html')));
app.get('/client/portfolio', (req, res) => {
  if (!req.session.user || req.session.user.role !== 'client') return res.redirect('/client');
  res.sendFile(path.join(__dirname, 'public', 'client.html'));
});
app.get('*', (_req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

initializeUsers().then(() => app.listen(PORT, () => console.log(`${brand.name} private operations portal listening on port ${PORT} (${storeMode} user store)`))).catch((error) => { console.error('Startup failed:', error); process.exit(1); });
process.on('SIGTERM', async () => { if (mongoClient) await mongoClient.close(); process.exit(0); });
