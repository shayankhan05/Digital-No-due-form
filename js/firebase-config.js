// ---------------------------------------------------------------
// PASTE YOUR OWN CONFIG BELOW.
// Firebase console -> Project settings -> General -> "Your apps" -> SDK setup and config
// This file is safe to be public — it's an identifier, not a secret.
// Real security comes from firestore.rules, not from hiding this file.
// ---------------------------------------------------------------
// Import the functions you need from the SDKs you need
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.13.0/firebase-app.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/10.13.0/firebase-auth.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js";// TODO: Add SDKs for Firebase products that you want to use
// https://firebase.google.com/docs/web/setup#available-libraries

// Your web app's Firebase configuration
// For Firebase JS SDK v7.20.0 and later, measurementId is optional
const firebaseConfig = {
  apiKey: "AIzaSyBdjL-bRodq6jt_8ZtYnWF_8qe4dA167_g",
  authDomain: "no-due-app.firebaseapp.com",
  projectId: "no-due-app",
  storageBucket: "no-due-app.firebasestorage.app",
  messagingSenderId: "832622100735",
  appId: "1:832622100735:web:421dff1d6b740532d4ccca",
  measurementId: "G-683RV7HEPZ" 
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getFirestore(app);