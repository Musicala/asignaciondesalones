// auth.js — Musicala Horario (Firebase Auth) — PRO
// - NO reinicializa Firebase (eso lo hace firebase.js)
// - Garantiza sesión anónima (idempotente)
// - Espera estado de auth listo (evita race conditions)
// - Helpers útiles para debug y futuro control de roles

import { auth } from "./firebase.js";
import {
  onAuthStateChanged,
  signInAnonymously,
  signOut
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";

/* =========================
   Utils
========================= */
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

function normalizeAuthError(err){
  const code = err?.code || '';
  const msg  = err?.message || 'Error de autenticación';

  // Mensajes un poquito más humanos, sin sermones
  if (code === 'auth/operation-not-allowed'){
    return new Error(
      "En Firebase Console, habilita 'Anonymous' en Authentication → Sign-in method."
    );
  }
  if (code === 'auth/network-request-failed'){
    return new Error("Falló la red. Revisa internet o bloqueos del navegador.");
  }
  if (code === 'auth/too-many-requests'){
    return new Error("Demasiados intentos seguidos. Espera un toque y vuelve a intentar.");
  }
  return new Error(msg);
}

/* =========================
   State gate: wait auth ready
========================= */
let _authReadyPromise = null;

export function waitAuthReady(){
  if (_authReadyPromise) return _authReadyPromise;

  _authReadyPromise = new Promise((resolve) => {
    const unsub = onAuthStateChanged(auth, () => {
      unsub();
      resolve(true);
    });
  });

  return _authReadyPromise;
}

/* =========================
   Ensure anonymous session
========================= */
let _ensurePromise = null;

export async function ensureAnon({ force = false, retries = 2 } = {}){
  // Asegura que auth ya resolvió el estado inicial
  await waitAuthReady();

  // Si ya hay usuario y no forzamos, listo
  if (!force && auth.currentUser) return auth.currentUser;

  // Evitar múltiples signIn simultáneos
  if (_ensurePromise) return _ensurePromise;

  _ensurePromise = (async () => {
    let lastErr = null;

    for (let i=0; i<=retries; i++){
      try{
        // Si en un retry ya hay user, no insistimos
        if (auth.currentUser && !force) return auth.currentUser;

        const cred = await signInAnonymously(auth);
        return cred.user;
      }catch(err){
        lastErr = err;

        // backoff simple
        await sleep(350 + i*450);
      }
    }

    throw normalizeAuthError(lastErr);
  })();

  try{
    return await _ensurePromise;
  }finally{
    _ensurePromise = null;
  }
}

/* =========================
   Helpers
========================= */
export function getUid(){
  return auth.currentUser?.uid || null;
}

export async function signOutNow(){
  await signOut(auth);
}
