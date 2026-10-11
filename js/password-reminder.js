export const reminderKey = uid => `temporary-password-reminder:${uid}`;

export function showPasswordReminder(profile) {
  if (!profile.mustChangePassword || !location.pathname.endsWith('-dashboard.html')) return;
  const key = reminderKey(profile.uid);
  if (sessionStorage.getItem(key) || document.getElementById('passwordReminder')) return;
  setTimeout(() => {
    if (sessionStorage.getItem(key) || document.getElementById('passwordReminder')) return;
    const dialog = document.createElement('dialog');
    dialog.id = 'passwordReminder'; dialog.className = 'password-reminder card';
    dialog.setAttribute('aria-labelledby', 'passwordReminderTitle');
    dialog.setAttribute('aria-describedby', 'passwordReminderMessage');
    dialog.innerHTML = `<h2 id="passwordReminderTitle">Secure your account</h2>
      <p id="passwordReminderMessage">You are currently using the default temporary password.<br>Please change your password to secure your account.</p>
      <div class="password-reminder-actions"><button type="button" class="btn-primary" data-change>Change password</button><button type="button" class="btn-sm" data-later>Remind me later</button></div>`;
    const dismiss = () => { sessionStorage.setItem(key, 'dismissed'); dialog.close(); dialog.remove(); };
    dialog.querySelector('[data-later]').onclick = dismiss;
    dialog.querySelector('[data-change]').onclick = () => { dismiss(); location.href = 'password-settings.html'; };
    dialog.addEventListener('cancel', event => { event.preventDefault(); dismiss(); });
    document.body.append(dialog); dialog.showModal();
  }, 400);
}
