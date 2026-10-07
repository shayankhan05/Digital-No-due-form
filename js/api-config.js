// Set the production Render URL before publishing. Never put secrets here.
export const API_BASE_URL=globalThis.DIGITAL_NO_DUE_CONFIG?.API_BASE_URL || (['localhost','127.0.0.1'].includes(location.hostname)?'http://127.0.0.1:3000':'');
