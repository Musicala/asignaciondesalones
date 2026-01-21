// firebase.js — Musicala Horario (Firebase v10.7.1) — PRO init
// - Singleton safe (no dup init si se importa varias veces)
// - Firestore cache persistente (multi-tab) cuando se puede
// - Toggle de emuladores (Auth/Firestore) para dev

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

// Dev toggles (sin pelear con tu app.js)
const USE_EMULATORS =
  // 1) si lo defines desde el HTML: window.USE_FIREBASE_EMULATORS = true;
  Boolean(window.USE_FIREBASE_EMULATORS) ||
  // 2) o si estás en local
  ["localhost", "127.0.0.1"].includes(location.hostname);

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
// Si ya existiera una instancia por cualquier razón, usamos getFirestore.
// Si no, intentamos inicializar con persistent cache (multi-tab).
let _db;

try {
  // initializeFirestore SOLO debe llamarse una vez por app.
  // Esta versión habilita cache persistente (mejor experiencia offline / latencia)
  _db = initializeFirestore(app, {
    localCache: persistentLocalCache({
      tabManager: persistentMultipleTabManager()
    })
  });
} catch (err) {
  // Si falla (Safari raro, o ya se inicializó), caemos a getFirestore sin drama
  _db = getFirestore(app);
}

export const db = _db;

/* =========================
   EMULATORS (opcional)
========================= */
if (USE_EMULATORS) {
  // Importante: conectarlos solo una vez. Evitamos doble conexión.
  // Auth emulator
  try {
    connectAuthEmulator(auth, "http://localhost:9099", { disableWarnings: true });
  } catch (_) {}

  // Firestore emulator
  try {
    connectFirestoreEmulator(db, "localhost", 8080);
  } catch (_) {}
}
