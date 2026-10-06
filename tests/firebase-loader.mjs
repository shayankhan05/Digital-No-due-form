// Test only: run the production browser modules against the emulator SDK.
export async function resolve(specifier, context, next) {
  if (specifier.endsWith('/firebase-config.js') || specifier === './firebase-config.js') return {url: new URL('./runtime.mjs', import.meta.url).href, shortCircuit:true};
  if (specifier.startsWith('https://www.gstatic.com/firebasejs/')) {
    const module = specifier.endsWith('firebase-auth.js') ? 'firebase/auth' : specifier.endsWith('firebase-app.js') ? 'firebase/app' : 'firebase/firestore';
    return next(module, {...context,parentURL:import.meta.url});
  }
  return next(specifier, context);
}
