// Drafts are local UI state. Polling may update data, but cannot replace an open editor.
export function createRejectionEditor(root) {
  const drafts = new Map();
  let pendingRender;
  const isEditing = () => [...drafts.values()].some(d => d.open && d.row?.isConnected && root.contains(d.row));
  function resume() { const render = pendingRender; pendingRender = null; if (render) render(); }
  function bind(selector, keyFor, submit) {
    root.querySelectorAll(selector).forEach(row => {
      const button = row.querySelector('.reject-btn');
      if (!button) return;
      const key = keyFor(row);
      let draft = drafts.get(key);
      const show = () => {
        draft ||= {open: true, reason: '', busy: false};
        draft.open = true; draft.row = row; drafts.set(key, draft);
        let fields = row.querySelector('.reject-fields');
        if (!fields) { fields = document.createElement('div'); fields.className = 'reject-fields'; row.append(fields); }
        fields.classList.remove('hidden'); fields.style.width = '100%';
        let input = fields.querySelector('textarea');
        if (!input) { input = document.createElement('textarea'); fields.append(input); }
        input.setAttribute('aria-label', 'Reason for rejection'); input.maxLength = 2000;
        input.placeholder = 'Enter reason for rejection'; input.value = draft.reason;
        input.oninput = () => { draft.reason = input.value; };
        const status = document.createElement('p'); status.className = 'rejection-status'; status.setAttribute('role', 'status');
        fields.querySelector('.rejection-status')?.remove(); fields.append(status);
        let cancel = row.querySelector('.cancel-rejection');
        if (!cancel) { cancel = document.createElement('button'); cancel.type = 'button'; cancel.className = 'btn-sm cancel-rejection'; cancel.textContent = 'Cancel'; fields.append(cancel); }
        button.textContent = 'Confirm Reject'; row.querySelector('.approve-btn')?.setAttribute('disabled', '');
        cancel.onclick = () => { if (draft.busy) return; drafts.delete(key); draft = null; fields.classList.add('hidden'); input.value = ''; button.textContent = 'Reject'; row.querySelector('.approve-btn')?.removeAttribute('disabled'); resume(); };
        input.focus();
      };
      button.onclick = async () => {
        if (!draft?.open) { show(); return; }
        if (draft.busy) return;
        const reason = draft.reason.trim(), status = row.querySelector('.rejection-status');
        if (!reason) { status.textContent = 'Please enter a reason for rejection.'; return; }
        draft.busy = true; button.disabled = true; row.querySelector('.cancel-rejection').disabled = true;
        try { await submit(row, reason); draft.open = false; drafts.delete(key); row.remove(); pendingRender = null; }
        catch (error) { status.textContent = 'Could not reject request: ' + error.message; }
        finally { draft.busy = false; button.disabled = false; const cancel = row.querySelector('.cancel-rejection'); if (cancel) cancel.disabled = false; }
      };
      if (draft?.open) show();
    });
  }
  return {bind, isEditing, preserveError() {
    if (!isEditing()) return false;
    for (const draft of drafts.values()) if (draft.open && draft.row?.isConnected) {
      const status = draft.row.querySelector('.rejection-status');
      if (status) status.textContent = 'Could not refresh requests. Your draft is preserved; you can continue typing.';
    }
    return true;
  }, defer(render) { if (!isEditing()) return false; pendingRender = render; return true; }};
}
