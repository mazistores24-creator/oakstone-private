document.querySelectorAll('[data-brand]').forEach((el) => { if (window.OAKSTONE_BRAND) el.textContent = window.OAKSTONE_BRAND.name; });
const escapeClientText = (value) => String(value ?? '').replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
const clientRequestDialog = document.getElementById('client-request-dialog');
const clientRequestForm = document.getElementById('client-request-form');
const clientRequestList = document.getElementById('request-list');
let selectedRequestType = 'withdraw';
let requestCurrency = 'USD';
let supportRequestPending = false;
let requestIsEligible = true;
const clientSupportToggle = document.getElementById('client-support-toggle');
const clientSupportPanel = document.getElementById('support');
const investmentTiers = {
  root: { label: 'OakStone Root', min: 5000 },
  power: { label: 'OakStone Power', min: 35000 },
  legacy: { label: 'OakStone Legacy', min: 200000 },
  mastermind: { label: 'Mastermind', min: 150000 }
};

function showClientToast(text) {
  const toast = document.getElementById('client-toast');
  toast.textContent = text;
  toast.classList.add('show');
  clearTimeout(showClientToast.timer);
  showClientToast.timer = setTimeout(() => toast.classList.remove('show'), 3000);
}
function setClientSupportOpen(open) {
  clientSupportPanel.hidden = !open;
  clientSupportToggle.setAttribute('aria-expanded', String(open));
  clientSupportToggle.setAttribute('aria-label', `${open ? 'Close' : 'Open'} contact support`);
}
clientSupportToggle.addEventListener('click', () => {
  setClientSupportOpen(clientSupportToggle.getAttribute('aria-expanded') !== 'true');
});
document.querySelectorAll('a[href="#support"]').forEach((link) => {
  link.addEventListener('click', (event) => {
    event.preventDefault();
    setClientSupportOpen(true);
  });
});
document.getElementById('client-support-close').addEventListener('click', () => setClientSupportOpen(false));
document.querySelectorAll('.client-action-toggle').forEach((button) => {
  button.addEventListener('click', () => {
    const expanded = button.getAttribute('aria-expanded') !== 'true';
    document.querySelectorAll('.client-action-toggle').forEach((actionButton) => {
      const isExpanded = actionButton === button && expanded;
      actionButton.setAttribute('aria-expanded', String(isExpanded));
      document.getElementById(actionButton.getAttribute('aria-controls')).hidden = !isExpanded;
    });
  });
});
document.querySelectorAll('.plans-toggle').forEach((button) => {
  button.addEventListener('click', () => {
    const expanded = button.getAttribute('aria-expanded') !== 'true';
    button.setAttribute('aria-expanded', String(expanded));
    document.getElementById(button.getAttribute('aria-controls')).hidden = !expanded;
  });
});
document.querySelectorAll('[data-copy-wallet]').forEach((button) => {
  button.addEventListener('click', async () => {
    const address = button.closest('.wallet-payment-information').querySelector('.wallet-address').textContent.trim();
    try {
      await navigator.clipboard.writeText(address);
      showClientToast('Ethereum address copied.');
    } catch (error) {
      console.error('Wallet address could not be copied:', error);
      showClientToast('Could not copy the address. Select and copy it manually.');
    }
  });
});
function renderRequests(requests) {
  if (!requests.length) {
    clientRequestList.innerHTML = '<p class="request-empty">No requests yet. New requests will appear here for your reference.</p>';
    return;
  }
  clientRequestList.innerHTML = requests.map((request) => {
    const date = new Date(request.createdAt);
    const formattedDate = Number.isNaN(date.getTime()) ? '' : date.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
    const kinds = { withdraw: 'Withdrawal', deposit: 'Deposit', invest: 'Investment' };
    const icons = { withdraw: '↓', deposit: '＋', invest: '↗' };
    const kind = kinds[request.type] || 'Account';
    const amountText = new Intl.NumberFormat(undefined, { style: 'currency', currency: request.currency || 'USD' }).format(Number(request.amount));
    const tierLabel = request.tier && Object.hasOwn(investmentTiers, request.tier) ? ` · ${investmentTiers[request.tier].label} plan` : '';
    return `<article class="client-request-row"><span class="client-request-icon ${escapeClientText(request.type)}">${icons[request.type] || '•'}</span><span class="client-request-main"><strong>${kind} request</strong><small>${escapeClientText(request.reference)} · ${escapeClientText(request.accountId || request.clientReference || request.account || 'Account setup pending')}${tierLabel ? escapeClientText(tierLabel) : ''}${formattedDate ? ` · ${escapeClientText(formattedDate)}` : ''}</small>${request.note ? `<small class="client-request-note">${escapeClientText(request.note)}</small>` : ''}</span><strong class="client-request-amount">${escapeClientText(amountText)}</strong><span class="client-request-status">${escapeClientText(request.status)}</span></article>`;
  }).join('');
}
function renderInvestmentRecords(records, currency) {
  const list = document.getElementById('investment-record-list');
  if (!records.length) {
    list.innerHTML = '<p class="request-empty">No investment records yet.</p>';
    return;
  }
  const formatMoney = (value) => new Intl.NumberFormat(undefined, { style: 'currency', currency, maximumFractionDigits: 2 }).format(Number(value));
  const formatDate = (value) => {
    const date = new Date(`${value}T00:00:00`);
    return Number.isNaN(date.getTime()) ? '' : date.toLocaleDateString(undefined, { dateStyle: 'medium' });
  };
  list.innerHTML = records.map((record) => `<article class="client-investment-record"><div><span class="eyebrow muted">AMOUNT INVESTED</span><strong>${escapeClientText(formatMoney(record.amount))}</strong><small>Investment date: ${escapeClientText(formatDate(record.investmentDate))}</small></div>${record.status ? `<div><span class="eyebrow muted">SETTLEMENT STATUS</span><strong>${escapeClientText(record.status)}</strong><small>Reference: ${escapeClientText(record.settlementReference || record.reference)}</small></div>` : `<div><span class="eyebrow muted">ESTIMATED RETURN · NOT GUARANTEED</span><strong>${escapeClientText(formatMoney(record.expectedReturnAmount))}</strong><small>Expected date: ${escapeClientText(formatDate(record.expectedReturnDate))}</small></div>`}</article>`).join('');
}
async function loadRequests() {
  const response = await fetch('/api/client/requests');
  if (!response.ok) return;
  const data = await response.json();
  renderRequests(data.requests || []);
}
async function loadSupportMessages(quiet = false) {
  const response = await fetch('/api/client/support/messages');
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || 'Your support conversation could not be loaded.');
  const list = document.getElementById('client-support-messages');
  if (!data.messages.length) {
    list.innerHTML = '<p class="request-empty">No messages yet. Send a message to start a conversation.</p>';
    return;
  }
  list.innerHTML = data.messages.map((message) => {
    const date = new Date(message.createdAt);
    const when = Number.isNaN(date.getTime()) ? '' : date.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
    const sender = message.senderRole === 'client' ? 'You' : 'Relationship team';
    return `<article class="support-message ${message.senderRole === 'client' ? 'from-client' : 'from-staff'}"><div><strong>${sender}</strong><time>${escapeClientText(when)}</time></div><p>${escapeClientText(message.text)}</p></article>`;
  }).join('');
  if (!quiet) list.scrollTop = list.scrollHeight;
}
function openRequest(type) {
  selectedRequestType = type;
  const isWithdrawal = type === 'withdraw';
  const isDeposit = type === 'deposit';
  const isInvestment = type === 'invest';
  const tierField = document.getElementById('investment-tier-field');
  const tierSelect = clientRequestForm.elements.tier;
  document.getElementById('investment-wallet-payment').hidden = true;
  const requestButton = document.querySelector(`[data-request="${type}"]`);
  requestIsEligible = requestButton ? !requestButton.disabled : true;
  tierField.hidden = !isInvestment;
  tierSelect.required = isInvestment;
  tierSelect.value = '';
  const availability = document.getElementById('client-request-availability');
  const availabilityStatus = document.getElementById(`${type}-availability`);
  availability.textContent = availabilityStatus && !availabilityStatus.hidden ? availabilityStatus.textContent : '';
  availability.hidden = !availability.textContent;
  document.getElementById('client-request-submit-button').disabled = !requestIsEligible;
  document.getElementById('request-currency').textContent = requestCurrency;
  document.getElementById('client-request-title').textContent = isWithdrawal ? 'Request a withdrawal' : isDeposit ? 'Request a deposit' : 'Request an investment';
  document.getElementById('client-request-copy').textContent = isWithdrawal
    ? 'Your relationship team will verify the linked account and available balance before processing.'
    : isDeposit
      ? 'This request stays pending until staff confirms that the custodian cleared the Fund.'
      : 'Your relationship team will review the account instructions and required approvals before processing.';
  document.getElementById('client-request-submit').textContent = isWithdrawal ? 'Send withdrawal request' : isDeposit ? 'Send deposit request' : 'Send investment request';
  const amount = clientRequestForm.elements.amount;
  amount.removeAttribute('max');
  amount.min = isInvestment ? '5000' : '1';
  amount.value = '';
  amount.step = '0.01';
  amount.placeholder = isInvestment ? 'Choose a tier first' : '0.00';
  clientRequestForm.elements.note.value = '';
  clientRequestDialog.showModal();
}

document.querySelectorAll('[data-request]').forEach((button) => button.addEventListener('click', () => openRequest(button.dataset.request)));
document.querySelectorAll('[data-investment-tier]').forEach((button) => {
  button.addEventListener('click', () => {
    openRequest('invest');
    const tierSelect = clientRequestForm.elements.tier;
    tierSelect.value = button.dataset.investmentTier;
    tierSelect.dispatchEvent(new Event('change'));
  });
});
document.querySelector('[data-close-request]').addEventListener('click', () => clientRequestDialog.close());
clientRequestForm.elements.tier.addEventListener('change', (event) => {
  const tier = investmentTiers[event.target.value];
  const payment = document.getElementById('investment-wallet-payment');
  payment.hidden = !tier;
  if (tier) document.getElementById('payment-plan-name').textContent = `${tier.label} Plan`;
  const amount = clientRequestForm.elements.amount;
  if (!tier) {
    amount.min = '5000';
    amount.removeAttribute('max');
    amount.placeholder = 'Choose a tier first';
    return;
  }
  amount.min = String(tier.min);
  amount.removeAttribute('max');
  amount.placeholder = `$${tier.min.toLocaleString('en-US')} minimum`;
  amount.value = '';
});
clientRequestForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  const submitButton = clientRequestForm.querySelector('button[type="submit"]');
  submitButton.disabled = true;
  document.getElementById('client-request-submit').textContent = 'Sending…';
  try {
    const response = await fetch('/api/client/requests', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        type: selectedRequestType,
        amount: clientRequestForm.elements.amount.value,
        tier: selectedRequestType === 'invest' ? clientRequestForm.elements.tier.value : undefined,
        note: clientRequestForm.elements.note.value
      })
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || 'Your request could not be submitted.');
    clientRequestDialog.close();
    await loadRequests();
    showClientToast('Request received. Processing requires operational approval.');
  } catch (error) {
    showClientToast(error.message);
  } finally {
    submitButton.disabled = !requestIsEligible;
    document.getElementById('client-request-submit').textContent = selectedRequestType === 'withdraw' ? 'Send withdrawal request' : selectedRequestType === 'deposit' ? 'Send deposit request' : 'Send investment request';
  }
});

async function loadPortfolio() {
  const session = await fetch('/api/session').then((r) => r.json());
  if (!session.user || session.user.role !== 'client') return location.replace('/client');
  const response = await fetch('/api/client/portfolio');
  if (response.status === 401) return location.replace('/client');
  const data = await response.json();
  document.getElementById('client-name').textContent = data.name;
  document.getElementById('client-greeting').textContent = data.name.split(' ')[0];
  document.querySelectorAll('.small-avatar').forEach((el) => { el.textContent = data.name.split(' ').map((part) => part[0]).join('').slice(0, 2).toUpperCase(); });
  document.querySelector('.profile-mini .avatar').textContent = data.name.split(' ').map((part) => part[0]).join('').slice(0, 2).toUpperCase();
  document.getElementById('portfolio-nav').textContent = data.nav ?? 'Not available';
  document.getElementById('portfolio-performance').textContent = data.performance ?? '—';
  document.getElementById('cash-value').textContent = data.cash ?? 'Not available';
  document.getElementById('account-name').textContent = data.account;
  document.getElementById('account-status').textContent = data.accountLinked ? 'Linked' : 'Pending link';
  document.getElementById('account-id').textContent = data.accountId;
  requestCurrency = data.currency || 'USD';
  const hasAvailableCash = data.cash !== null && data.cash !== undefined && Number.isFinite(Number(data.cash));
  const hasPositiveCashBalance = data.cash !== null && data.cash !== undefined && Number.isFinite(Number(data.cash)) && Number(data.cash) > 0;
  const hasInvestmentCash = hasAvailableCash && Number(data.cash) >= 5000;
  const withdrawalUnavailable = !data.accountLinked
    ? 'Link and verify an account before requesting a withdrawal.'
    : !hasAvailableCash
      ? 'A verified available cash balance must be recorded before requesting a withdrawal.'
      : !hasPositiveCashBalance
        ? 'A positive available cash balance is required to request a withdrawal.'
        : '';
  const depositUnavailable = data.accountLinked ? '' : 'Link and verify an account before requesting a deposit.';
  const investmentUnavailable = !data.accountLinked
    ? 'Link and verify an account before requesting an investment.'
    : requestCurrency !== 'USD'
      ? 'Investment plans are available only for USD-linked accounts.'
      : !hasAvailableCash
        ? 'A verified available cash balance of at least $5,000 is required.'
        : !hasInvestmentCash
          ? 'At least $5,000 in available cash is required to request an investment.'
          : '';
  [
    ['request-withdraw', 'withdraw-availability', withdrawalUnavailable],
    ['request-deposit', 'deposit-availability', depositUnavailable],
    ['request-invest', 'invest-availability', investmentUnavailable]
  ].forEach(([buttonId, statusId, unavailableReason]) => {
    const button = document.getElementById(buttonId);
    const status = document.getElementById(statusId);
    button.disabled = Boolean(unavailableReason);
    status.textContent = unavailableReason;
    status.hidden = !unavailableReason;
  });
  document.getElementById('holding-rows').innerHTML = data.holdings.length ? data.holdings.map((h) => `<tr><td><strong>${escapeClientText(h.name)}</strong></td><td>${escapeClientText(h.type)}</td><td>${escapeClientText(h.weight)}</td><td class="amount-cell">${escapeClientText(h.value)}</td></tr>`).join('') : '<tr><td colspan="4" class="ops-empty-cell">Your linked account holdings will appear here.</td></tr>';
  renderInvestmentRecords(data.investments || [], data.currency || 'USD');
  document.getElementById('year').textContent = new Date().getFullYear();
  await Promise.all([
    loadRequests(),
    loadSupportMessages().catch((error) => {
      document.getElementById('client-support-messages').textContent = error.message;
      showClientToast(error.message);
    })
  ]);
}
document.getElementById('client-support-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  if (supportRequestPending) return;
  const form = event.currentTarget;
  const button = form.querySelector('button[type="submit"]');
  const message = form.elements.message.value.trim();
  if (!message) return;
  supportRequestPending = true;
  button.disabled = true;
  try {
    const response = await fetch('/api/client/support/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message })
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || 'Your message could not be sent.');
    form.reset();
    await loadSupportMessages();
    showClientToast('Message sent to your relationship team.');
  } catch (error) {
    showClientToast(error.message);
  } finally {
    supportRequestPending = false;
    button.disabled = false;
  }
});
document.getElementById('logout').addEventListener('click', async () => { await fetch('/api/logout', { method: 'POST' }); location.replace('/client'); });
loadPortfolio().catch(() => location.replace('/client'));
setInterval(() => {
  if (document.visibilityState === 'visible') loadSupportMessages(true).catch((error) => {
    document.getElementById('client-support-messages').textContent = error.message;
  });
}, 6000);
