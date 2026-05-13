// firebase.js - Musicala Horario (Firebase v10.7.1)
// - Singleton safe: no duplica initializeApp si se importa varias veces.
// - Firestore con cache persistente multi-tab cuando el navegador lo permite.
// - Emuladores solo cuando se activan explicitamente con window.APP_CONFIG.useEmulators = true.

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
   ENV
========================= */
const appConfig = window.APP_CONFIG || {};
const IS_LOCALHOST = ["localhost", "127.0.0.1", "::1"].includes(location.hostname);
const USE_EMULATORS = appConfig.useEmulators === true;

export const FIREBASE_RUNTIME = Object.freeze({
  isLocalhost: IS_LOCALHOST,
  useEmulators: USE_EMULATORS,
  firestoreSource: USE_EMULATORS ? "emulator" : "real",
  authSource: USE_EMULATORS ? "emulator" : "real",
  projectId: firebaseConfig.projectId
});

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
  _db = initializeFirestore(app, {
    localCache: persistentLocalCache({
      tabManager: persistentMultipleTabManager()
    })
  });
} catch (err) {
  _db = getFirestore(app);
}

export const db = _db;

/* =========================
   EMULATORS (manual opt-in)
========================= */
if (USE_EMULATORS) {
  if (!IS_LOCALHOST) {
    console.warn("[Firebase] useEmulators=true fue ignorado porque no estas en localhost.");
  } else if (!window.__FIREBASE_EMULATORS_CONNECTED__) {
    window.__FIREBASE_EMULATORS_CONNECTED__ = true;

    try {
      connectAuthEmulator(auth, "http://localhost:9099", { disableWarnings: true });
      console.info("[Firebase] Auth conectado al emulador: localhost:9099");
    } catch (err) {
      console.warn("[Firebase] No se pudo conectar Auth al emulador.", err);
    }

    try {
      connectFirestoreEmulator(db, "localhost", 8080);
      console.info("[Firebase] Firestore conectado al emulador: localhost:8080");
    } catch (err) {
      console.warn("[Firebase] No se pudo conectar Firestore al emulador.", err);
    }
  }
} else {
  console.info(`[Firebase] Usando Firebase real (${firebaseConfig.projectId}). Localhost no activa emuladores automaticamente.`);
}
