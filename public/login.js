document.querySelectorAll('[data-brand]').forEach((element) => {
  if (window.OAKSTONE_BRAND) element.textContent = window.OAKSTONE_BRAND.name;
});

const form = document.querySelector('#login-form, #client-login-form');
if (form) {
  const audience = form.id === 'client-login-form' ? 'client' : 'staff';
  const message = document.getElementById('form-message');
  const togglePassword = document.getElementById('toggle-password');
  if (togglePassword) {
    togglePassword.addEventListener('click', (event) => {
      const input = document.getElementById('password');
      input.type = input.type === 'password' ? 'text' : 'password';
      event.currentTarget.textContent = input.type === 'password' ? 'Show' : 'Hide';
    });
  }
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    message.textContent = '';
    message.className = 'form-message';
    const button = form.querySelector('button[type="submit"]');
    button.disabled = true;
    button.querySelector('span:first-child').textContent = 'Signing in…';
    try {
      const response = await fetch(`/api/login/${audience}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: document.getElementById('email').value, password: document.getElementById('password').value })
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Could not sign in.');
      location.href = audience === 'client' ? '/client/portfolio' : '/dashboard';
    } catch (error) {
      message.textContent = error.message;
      message.classList.add('error');
      button.disabled = false;
      button.querySelector('span:first-child').textContent = audience === 'client' ? 'Open account' : 'Enter operations';
    }
  });
}
