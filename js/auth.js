import { auth, db } from "./firebase-config.js";
import {
  signInWithEmailAndPassword,
  signOut,
  onAuthStateChanged,
} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-auth.js";
import { doc, getDoc } from "https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js";

// Maps a user's role to the dashboard they land on after login.
const ROLE_HOME = {
  student: "student-dashboard.html",
  subject_faculty: "approver-dashboard.html",
  library: "approver-dashboard.html",
  physics_lab: "approver-dashboard.html",
  chemistry_lab: "approver-dashboard.html",
  accounts: "approver-dashboard.html",
  mentor: "mentor-dashboard.html",
  hod: "hod-dashboard.html",
  office: "office-dashboard.html",
};

/** Reads the signed-in user's profile document from /users/{uid}. */
export async function getCurrentUserProfile() {
  if (!auth.currentUser) return null;
  const snap = await getDoc(doc(db, "users", auth.currentUser.uid));
  return snap.exists() ? { uid: auth.currentUser.uid, ...snap.data() } : null;
}

/**
 * Call this at the top of every page except login.html.
 * Redirects to login if signed out. Resolves with the user's profile once ready.
 */
export function requireAuth() {
  return new Promise((resolve) => {
    onAuthStateChanged(auth, async (user) => {
      if (!user) {
        window.location.href = "login.html";
        return;
      }
      const profile = await getCurrentUserProfile();
      if (!profile) {
        alert("No profile found for this account. Ask your admin to set one up in Firestore under /users.");
        await signOut(auth);
        window.location.href = "login.html";
        return;
      }
      resolve(profile);
    });
  });
}

/** Wires up any element with id="logoutBtn" on the page. */
export function wireLogout() {
  const btn = document.getElementById("logoutBtn");
  if (btn) {
    btn.addEventListener("click", async () => {
      await signOut(auth);
      window.location.href = "login.html";
    });
  }
}

/** Wires up the login form (id="loginForm") if present on the page. */
export function wireLoginForm() {
  const form = document.getElementById("loginForm");
  if (!form) return;

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const email = document.getElementById("email").value.trim();
    const password = document.getElementById("password").value;
    const errorEl = document.getElementById("loginError");
    const submitBtn = form.querySelector("button[type=submit]");

    errorEl.classList.add("hidden");
    submitBtn.disabled = true;
    submitBtn.textContent = "Logging in...";

    try {
      await signInWithEmailAndPassword(auth, email, password);
      const profile = await getCurrentUserProfile();
      const home = ROLE_HOME[profile?.role] || "student-dashboard.html";
      window.location.href = home;
    } catch (err) {
      errorEl.textContent = friendlyAuthError(err.code);
      errorEl.classList.remove("hidden");
      submitBtn.disabled = false;
      submitBtn.textContent = "Log in";
    }
  });
}

function friendlyAuthError(code) {
  switch (code) {
    case "auth/invalid-email": return "That email address doesn't look right.";
    case "auth/user-not-found":
    case "auth/wrong-password":
    case "auth/invalid-credential": return "USN/email or password is incorrect.";
    case "auth/too-many-requests": return "Too many attempts. Wait a bit and try again.";
    default: return "Couldn't log in. Check your connection and try again.";
  }
}
