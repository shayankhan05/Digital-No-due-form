// Use local API during localhost development; otherwise use the deployed Render backend.
export const API_BASE_URL =
  globalThis.DIGITAL_NO_DUE_CONFIG?.API_BASE_URL ||
  (['localhost', '127.0.0.1'].includes(location.hostname)
    ? 'http://127.0.0.1:3000'
    : 'https://digital-no-due-form.onrender.com');