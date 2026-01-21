// firebase.js — Musicala Horario (Firebase v10.7.1) — PRO init (SAFE)
// - Singleton safe (no dup init si se importa varias veces)
// - Firestore cache persistente (multi-tab) cuando se puede
// - Emuladores SOLO en localhost (evita sabotaje en GitHub Pages)

import { initializeApp, getApp, getApps } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js";
import { getAuth, connectAuthEmulator } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";
import {
  getFirestore,
  initializeFirestore,
  connectFirestoreEmulator,
  persistentLocalCache,
  persistentMultipleTabManager
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

/* =========================
   CONFIG
========================= */
const firebaseConfig = {
  apiKey: "AIzaSyDAZ4WtHkfIWEF1rlINDXj-PNConcp8yUs",
  authDomain: "asignacion-de-salones-musicala.firebaseapp.com",
  projectId: "asignacion-de-salones-musicala",
  storageBucket: "asignacion-de-salones-musicala.firebasestorage.app",
  messagingSenderId: "892083581283",
  appId: "1:892083581283:web:85d0d323aad439c8352356"
};

/* =========================
   ENV: Emuladores SOLO local
   (GitHub Pages jamás debería intentar pegarle a localhost)
========================= */
const IS_LOCALHOST = ["localhost", "127.0.0.1"].includes(location.hostname);
const USE_EMULATORS = IS_LOCALHOST;

/* =========================
   APP singleton
========================= */
export const app = getApps().length ? getApp() : initializeApp(firebaseConfig);

/* =========================
   AUTH
========================= */
export const auth = getAuth(app);

/* =========================
   FIRESTORE (cache pro)
========================= */
let _db;

try {
  // initializeFirestore SOLO debe llamarse una vez por app.
  // Cache persistente multi-tab (mejor experiencia offline/latencia).
  _db = initializeFirestore(app, {
    localCache: persistentLocalCache({
      tabManager: persistentMultipleTabManager()
    })
  });
} catch (err) {
  // Si falla (Safari raro / ya inicializado), caemos a getFirestore sin drama
  _db = getFirestore(app);
}

export const db = _db;

/* =========================
   EMULATORS (opcional, local only)
========================= */
if (USE_EMULATORS) {
  // Evitar doble conexión si hot-reload o imports múltiples
  if (!window.__FIREBASE_EMULATORS_CONNECTED__) {
    window.__FIREBASE_EMULATORS_CONNECTED__ = true;

    // Auth emulator
    try {
      connectAuthEmulator(auth, "http://localhost:9099", { disableWarnings: true });
    } catch (_) {}

    // Firestore emulator
    try {
      connectFirestoreEmulator(db, "localhost", 8080);
    } catch (_) {}
  }
}
