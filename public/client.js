document.querySelectorAll('[data-brand]').forEach((el) => { if (window.OAKSTONE_BRAND) el.textContent = window.OAKSTONE_BRAND.name; });
const escapeClientText = (value) => String(value ?? '').replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
const clientRequestDialog = document.getElementById('client-request-dialog');
const clientRequestForm = document.getElementById('client-request-form');
const clientRequestList = document.getElementById('request-list');
let selectedRequestType = 'withdraw';
let requestCurrency = 'USD';
let supportRequestPending = false;
const investmentTiers = {
  bronze: { label: 'Bronze', min: 5000, max: 34999 },
  silver: { label: 'Silver', min: 35000, max: 149999 },
  gold: { label: 'Gold', min: 150000, max: 499999 },
  diamond: { label: 'Diamond', min: 500000, max: 1000000 }
};

function showClientToast(text) {
  const toast = document.getElementById('client-toast');
  toast.textContent = text;
  toast.classList.add('show');
  clearTimeout(showClientToast.timer);
  showClientToast.timer = setTimeout(() => toast.classList.remove('show'), 3000);
}
function renderRequests(requests) {
  if (!requests.length) {
    clientRequestList.innerHTML = '<p class="request-empty">No requests yet. New requests will appear here for your reference.</p>';
    return;
  }
  clientRequestList.innerHTML = requests.map((request) => {
    const date = new Date(request.createdAt);
    const formattedDate = Number.isNaN(date.getTime()) ? '' : date.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
    const kind = request.type === 'withdraw' ? 'Withdrawal' : 'Investment';
    const amountText = new Intl.NumberFormat(undefined, { style: 'currency', currency: request.currency || 'USD' }).format(Number(request.amount));
    const tierLabel = request.tier && Object.hasOwn(investmentTiers, request.tier) ? ` · ${investmentTiers[request.tier].label} tier` : '';
    return `<article class="client-request-row"><span class="client-request-icon ${request.type}">${request.type === 'withdraw' ? '↓' : '↗'}</span><span class="client-request-main"><strong>${kind} request</strong><small>${escapeClientText(request.reference)} · ${escapeClientText(request.accountId || request.clientReference || request.account || 'Account setup pending')}${tierLabel ? escapeClientText(tierLabel) : ''}${formattedDate ? ` · ${escapeClientText(formattedDate)}` : ''}</small>${request.note ? `<small class="client-request-note">${escapeClientText(request.note)}</small>` : ''}</span><strong class="client-request-amount">${escapeClientText(amountText)}</strong><span class="client-request-status">${escapeClientText(request.status)}</span></article>`;
  }).join('');
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
  const tierField = document.getElementById('investment-tier-field');
  const tierSelect = clientRequestForm.elements.tier;
  tierField.hidden = isWithdrawal;
  tierSelect.required = !isWithdrawal;
  tierSelect.value = '';
  document.getElementById('request-currency').textContent = requestCurrency;
  document.getElementById('client-request-title').textContent = isWithdrawal ? 'Request a withdrawal' : 'Request an investment';
  document.getElementById('client-request-copy').textContent = isWithdrawal
    ? 'Your relationship team will verify the linked account and available balance before processing.'
    : 'Your relationship team will review the account instructions and required approvals before processing.';
  document.getElementById('client-request-submit').textContent = isWithdrawal ? 'Send withdrawal request' : 'Send investment request';
  const amount = clientRequestForm.elements.amount;
  amount.removeAttribute('max');
  amount.min = isWithdrawal ? '1' : '5000';
  amount.value = '';
  amount.step = '0.01';
  amount.placeholder = isWithdrawal ? '0.00' : 'Choose a tier first';
  clientRequestForm.elements.note.value = '';
  clientRequestDialog.showModal();
}

document.querySelectorAll('[data-request]').forEach((button) => button.addEventListener('click', () => openRequest(button.dataset.request)));
document.querySelector('[data-close-request]').addEventListener('click', () => clientRequestDialog.close());
clientRequestForm.elements.tier.addEventListener('change', (event) => {
  const tier = investmentTiers[event.target.value];
  const amount = clientRequestForm.elements.amount;
  if (!tier) {
    amount.min = '5000';
    amount.removeAttribute('max');
    amount.placeholder = 'Choose a tier first';
    return;
  }
  amount.min = String(tier.min);
  amount.max = String(tier.max);
  amount.placeholder = `${tier.min}–${tier.max}`;
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
    submitButton.disabled = false;
    document.getElementById('client-request-submit').textContent = selectedRequestType === 'withdraw' ? 'Send withdrawal request' : 'Send investment request';
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
  document.getElementById('request-withdraw').disabled = !data.accountLinked;
  document.getElementById('request-invest').disabled = !data.accountLinked || requestCurrency !== 'USD';
  document.getElementById('investment-currency-note').hidden = requestCurrency === 'USD';
  document.getElementById('holding-rows').innerHTML = data.holdings.length ? data.holdings.map((h) => `<tr><td><strong>${escapeClientText(h.name)}</strong></td><td>${escapeClientText(h.type)}</td><td>${escapeClientText(h.weight)}</td><td class="amount-cell">${escapeClientText(h.value)}</td></tr>`).join('') : '<tr><td colspan="4" class="ops-empty-cell">Your linked account holdings will appear here.</td></tr>';
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
