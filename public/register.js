document.querySelectorAll('[data-brand]').forEach((el) => { if (window.OAKSTONE_BRAND) el.textContent = window.OAKSTONE_BRAND.name; });
const form = document.getElementById('client-register-form');
const message = document.getElementById('form-message');
document.querySelectorAll('[data-toggle-password]').forEach((button) => button.addEventListener('click', () => {
  const input = document.getElementById(button.dataset.togglePassword);
  input.type = input.type === 'password' ? 'text' : 'password';
  button.textContent = input.type === 'password' ? 'Show' : 'Hide';
}));
form.addEventListener('submit', async (event) => {
  event.preventDefault();
  message.textContent = '';
  message.className = 'form-message';
  const password = form.elements.password.value;
  const confirmPassword = form.elements['confirm-password'].value;
  if (password !== confirmPassword) {
    message.textContent = 'Your passwords do not match.';
    message.classList.add('error');
    return;
  }
  const button = form.querySelector('button[type="submit"]');
  button.disabled = true;
  button.querySelector('span:first-child').textContent = 'Creating access…';
  try {
    const response = await fetch('/api/register/client', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: form.elements.email.value, password })
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || 'Account access could not be created.');
    message.textContent = `Access request received. Reference ${result.clientReference}. Sign-in is enabled after your account is linked and reviewed.`;
    message.classList.add('success');
    form.reset();
    button.querySelector('span:first-child').textContent = 'Access created';
  } catch (error) {
    message.textContent = error.message;
    message.classList.add('error');
    button.disabled = false;
    button.querySelector('span:first-child').textContent = 'Create secure access';
  }
});
