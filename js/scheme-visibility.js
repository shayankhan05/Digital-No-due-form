// Keep historical test data addressable by ID, but never offer it for new setup.
export const isVisibleScheme=s=>s.hiddenFromUI!==true&&!/^teacher-browser-/i.test(String(s.code||''));
