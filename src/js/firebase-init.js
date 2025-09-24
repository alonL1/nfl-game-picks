// Initialize Firebase app and export Firestore (db). Handles missing config gracefully.
import { firebaseConfig } from './firebase-config.js';

// We'll use Firebase v9 modular CDN imports via dynamic import so we don't require bundling.
// Exports: db (Firestore instance or null), serverTimestamp, addDoc, collection, query, where, onSnapshot

let db = null;
let serverTimestamp = null;
let addDoc = null;
let collection = null;
let query = null;
let where = null;
let onSnapshot = null;

if (firebaseConfig) {
  try {
    const [{ initializeApp }, { getFirestore, serverTimestamp: ts, addDoc: add, collection: coll, query: q, where: w, onSnapshot: sub } ] = await Promise.all([
      import('https://www.gstatic.com/firebasejs/10.12.3/firebase-app.js'),
      import('https://www.gstatic.com/firebasejs/10.12.3/firebase-firestore.js')
    ]);
    const app = initializeApp(firebaseConfig);
    db = getFirestore(app);
    serverTimestamp = ts;
    addDoc = add;
    collection = coll;
    query = q;
    where = w;
    onSnapshot = sub;
  } catch (err) {
    console.error('Failed to load Firebase SDK:', err);
    db = null;
  }
}

export { db, serverTimestamp, addDoc, collection, query, where, onSnapshot };


