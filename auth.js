// auth.js - Musicala Horario (Firebase Auth v10.7.1)
// Login opcional con Google. La lectura publica depende de Firestore Rules.

import { auth } from "./firebase.js";
import {
  GoogleAuthProvider,
  onAuthStateChanged,
  signInWithPopup,
  signOut
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";

export const ADMIN_EMAILS = [
  "imusicala@gmail.com",
  "adminmusicala@gmail.com",
  "musicalaasesor@gmail.com",
  "alekcaballeromusic@gmail.com",
  "catalina.medina.leal@gmail.com"
];

function normalizeEmail(email){
  return String(email || "").trim().toLowerCase();
}

function normalizeAuthError(err){
  const code = err?.code || "";
  if (code === "auth/popup-closed-by-user") return new Error("Inicio de sesion cancelado.");
  if (code === "auth/popup-blocked") return new Error("El navegador bloqueo la ventana de Google.");
  if (code === "auth/operation-not-allowed") return new Error("Habilita Google como proveedor en Firebase Authentication.");
  if (code === "auth/network-request-failed") return new Error("Fallo la red. Revisa internet o bloqueos del navegador.");
  return new Error(err?.message || "No se pudo iniciar sesion.");
}

export function isAdminEmail(email){
  return ADMIN_EMAILS.includes(normalizeEmail(email));
}

export function getCurrentUser(){
  return auth.currentUser || null;
}

export function onUserChanged(callback){
  return onAuthStateChanged(auth, (user) => {
    callback(user || null, {
      isAdmin: isAdminEmail(user?.email),
      email: normalizeEmail(user?.email)
    });
  });
}

export async function loginWithGoogle(){
  try{
    const provider = new GoogleAuthProvider();
    provider.setCustomParameters({ prompt: "select_account" });
    const cred = await signInWithPopup(auth, provider);
    return cred.user;
  }catch(err){
    throw normalizeAuthError(err);
  }
}

export async function logout(){
  await signOut(auth);
}
