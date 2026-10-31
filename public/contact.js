document.querySelectorAll('[data-brand]').forEach((el) => { if (window.OAKSTONE_BRAND) el.textContent = window.OAKSTONE_BRAND.name; });

const form = document.getElementById('contact-form');
const status = document.getElementById('contact-status');
form.addEventListener('submit', async (event) => {
  event.preventDefault();
  const button = form.querySelector('button[type="submit"]');
  button.disabled = true;
  status.textContent = 'Sending…';
  status.className = 'contact-status';
  try {
    const response = await fetch('/api/contact', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(Object.fromEntries(new FormData(form)))
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || 'Your message could not be sent.');
    form.reset();
    status.textContent = 'Thank you. Your message has been sent to our team.';
    status.classList.add('success');
  } catch (error) {
    status.textContent = error.message;
    status.classList.add('error');
  } finally {
    button.disabled = false;
  }
});
