/**
 * Small framework-neutral controller so the shell can mount the same accessible
 * sign-in behavior in React without duplicating session error handling.
 */
export function mountSignInForm(root: HTMLElement, onAuthenticated: () => void): void {
  root.innerHTML = `<form aria-labelledby="sign-in-title" novalidate>
    <h1 id="sign-in-title">Sign in to Northstar CRM</h1>
    <p id="sign-in-feedback" role="status" aria-live="polite"></p>
    <label>Email <input name="email" type="email" autocomplete="username" required></label>
    <label>Password <input name="password" type="password" autocomplete="current-password" required minlength="12"></label>
    <button type="submit">Sign in</button>
  </form>`;
  const form = root.querySelector('form')!;
  const feedback = root.querySelector('#sign-in-feedback')!;
  const button = root.querySelector('button')!;
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (!form.reportValidity()) return;
    button.disabled = true;
    feedback.textContent = 'Signing in…';
    try {
      const response = await fetch('/api/auth/sign-in', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(Object.fromEntries(new FormData(form))),
      });
      const data = (await response.json()) as { error?: string };
      if (!response.ok)
        throw new Error(data.error ?? 'We could not sign you in. Please try again.');
      onAuthenticated();
    } catch (error) {
      feedback.textContent =
        error instanceof Error ? error.message : 'We could not sign you in. Please try again.';
    } finally {
      button.disabled = false;
    }
  });
}
