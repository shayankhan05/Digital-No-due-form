// ---------------------------------------------------------------
// PASTE YOUR OWN CONFIG BELOW.
// Firebase console -> Project settings -> General -> "Your apps" -> SDK setup and config
// This file is safe to be public — it's an identifier, not a secret.
// Real security comes from firestore.rules, not from hiding this file.
// ---------------------------------------------------------------
// Import the functions you need from the SDKs you need
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.13.0/firebase-app.js";
import { getAuth, connectAuthEmulator } from "https://www.gstatic.com/firebasejs/10.13.0/firebase-auth.js";
import { getFirestore, connectFirestoreEmulator } from "https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js";
import { getFunctions, connectFunctionsEmulator } from "https://www.gstatic.com/firebasejs/10.13.0/firebase-functions.js";
// https://firebase.google.com/docs/web/setup#available-libraries

// Your web app's Firebase configuration
// For Firebase JS SDK v7.20.0 and later, measurementId is optional
const firebaseConfig = {
  apiKey: "AIzaSyAsNd6OyrdiqnQw36RgbbUc1Z0Ie8-UuJM",
  authDomain: "digital-no-due-shayan.firebaseapp.com",
  projectId: "digital-no-due-shayan",
  storageBucket: "digital-no-due-shayan.firebasestorage.app",
  messagingSenderId: "124948156708",
  appId: "1:124948156708:web:c9be9e733ff1f7008023b1",
  measurementId: "G-4SRWS9J371"
};
// Initialize Firebase
// The dedicated emulator Hosting port always selects the demo project, including new tabs.
// Other local servers can opt in explicitly with ?emulator=1.
const useEmulators = ["localhost", "127.0.0.1"].includes(location.hostname)
  && (location.port === "5050" || new URLSearchParams(location.search).get("emulator") === "1");
if (useEmulators) sessionStorage.setItem("digitalNoDueEmulator", "1");
const emulatorSession = ["localhost", "127.0.0.1"].includes(location.hostname)
  && sessionStorage.getItem("digitalNoDueEmulator") === "1";
const app = initializeApp(emulatorSession ? { apiKey: "fake-api-key", authDomain: "demo-digital-no-due.firebaseapp.com", projectId: "demo-digital-no-due", appId: "demo-digital-no-due-local" } : firebaseConfig);
export const auth = getAuth(app);
export const db = getFirestore(app);
export const functions = getFunctions(app, "us-central1");
export const isEmulator = emulatorSession;
if (emulatorSession) {
  connectAuthEmulator(auth, "http://127.0.0.1:9199", { disableWarnings: true });
  connectFirestoreEmulator(db, "127.0.0.1", 8180);
  connectFunctionsEmulator(functions, "127.0.0.1", 5001);
}
