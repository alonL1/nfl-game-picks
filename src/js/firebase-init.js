// src/js/firebase-init.js
// Minimal dynamic-init that uses Firestore LITE (no realtime Listen streams).
// Exports a Firestore instance + the usual helpers we need (getDocs, addDoc, collection, query, where, serverTimestamp).
// Also exports onSnapshot as a no-op for any code that still imports it.

import { firebaseConfig } from './firebase-config.js';

let db = null;
let serverTimestamp = null;
let addDoc = null;
let collection = null;
let query = null;
let where = null;
let getDocs = null;

// Promise that resolves when firebase is ready (true if initialized or false if disabled)
export const firebaseReady = (async () => {
  if (!firebaseConfig || !firebaseConfig.apiKey) {
    console.warn('Firebase config missing — Firestore disabled.');
    return false;
  }

  try {
    // Use the *lite* Firestore build — it does not include realtime Listen support
    const [{ initializeApp }, { getFirestore }, { serverTimestamp: ts, addDoc: add, collection: coll, query: q, where: w, getDocs: gd } ] = await Promise.all([
      import('https://www.gstatic.com/firebasejs/10.12.3/firebase-app.js'),
      import('https://www.gstatic.com/firebasejs/10.12.3/firebase-firestore-lite.js'),
      // Note: some helpers (serverTimestamp/addDoc/collection/query/getDocs) are exported from the lite bundle path too,
      // but we import them by loading the same lite file; import signatures vary in CDN bundles, so we safe-guard below.
      import('https://www.gstatic.com/firebasejs/10.12.3/firebase-firestore-lite.js')
    ]);

    const app = initializeApp(firebaseConfig);
    db = getFirestore(app);

    // Wiring: try to pull the helpers from the lite module import above (fallbacks in case shape differs)
    serverTimestamp = ts || (() => ({ __ts: 'server' }));
    addDoc = add || (() => { throw new Error('addDoc not available'); });
    collection = coll || (() => { throw new Error('collection not available'); });
    query = q || (() => { throw new Error('query not available'); });
    where = w || (() => { throw new Error('where not available'); });
    getDocs = gd || (() => { throw new Error('getDocs not available'); });

    console.log('Firebase (CDN) initialized — Firestore Lite ready.');
    return true;
  } catch (err) {
    console.error('Failed to load Firebase CDN modules:', err);
    db = null;
    return false;
  }
})();

// Export a no-op onSnapshot so old code that expects it won't break
export const onSnapshot = (..._args) => {
  // warn once per call so you can find accidental onSnapshot usage in code
  console.warn('onSnapshot() called but realtime is disabled (Firestore Lite). Ignored.');
  return () => {}; // unsubscribe no-op
};

// Exports
export { db, serverTimestamp, addDoc, collection, query, where, getDocs };
