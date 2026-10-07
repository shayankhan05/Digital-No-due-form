import { auth, db } from "./firebase-config.js";
import {
  signInWithEmailAndPassword,
  signOut,
  onAuthStateChanged,
  sendPasswordResetEmail,
} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-auth.js";
import { doc, getDoc } from "./api-store.js";

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
  admin: "admin-dashboard.html",
};
const PROFILE_ERROR = "Your account exists but your institutional profile is not yet configured. Contact administrator.";

/** Reads the signed-in user's profile document from /users/{uid}. */
export async function getCurrentUserProfile() {
  if (!auth.currentUser) return null;
  const snap = await getDoc(doc(db, "users", auth.currentUser.uid));
  return snap.exists() ? { ...snap.data(), uid: auth.currentUser.uid } : null;
}

/**
 * Call this at the top of every page except login.html.
 * Redirects to login if signed out. Resolves with the user's profile once ready.
 */
export function requireAuth(roles = null) {
  return new Promise((resolve, reject) => {
    const unsubscribe = onAuthStateChanged(auth, async (user) => {
      unsubscribe();
      try {
      if (!user) {
        window.location.href = "login.html";
        return;
      }
      const profile = await getCurrentUserProfile();
      if (!profile || !ROLE_HOME[profile.role]) {
        alert(PROFILE_ERROR);
        await signOut(auth);
        window.location.href = "login.html";
        return;
      }
      if (roles && !roles.includes(profile.role)) {
        window.location.href = ROLE_HOME[profile.role] || "login.html";
        return;
      }
      resolve(profile);
      } catch (error) { reject(error); }
    });
  });
}

/** Wires up any element with id="logoutBtn" on the page. */
export function wireLogout() {
  if (!document.getElementById("passwordSettingsLink")) {
    const link = document.createElement("a"); link.id = "passwordSettingsLink";
    link.href = "password-settings.html"; link.textContent = "Change password";
    link.className = "btn-sm";
    const logout = document.getElementById("logoutBtn");
    if (logout) logout.parentNode.insertBefore(link, logout);
  }
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

if (!profile) {
  const error = new Error(PROFILE_ERROR); error.code = "institution/profile-missing"; throw error;
}

const home = ROLE_HOME[profile.role];

if (!home) {
  const error = new Error(PROFILE_ERROR); error.code = "institution/profile-missing"; throw error;
}

window.location.href = home;
    } catch (err) {
      if (err.code === "institution/profile-missing") await signOut(auth);
      errorEl.textContent = err.code === "institution/profile-missing" ? PROFILE_ERROR : friendlyAuthError(err.code);
      errorEl.classList.remove("hidden");
      submitBtn.disabled = false;
      submitBtn.textContent = "Log in";
    }
  });
}

export function wireForgotPassword() {
  const button = document.getElementById("forgotPasswordBtn"), form = document.getElementById("resetForm");
  if (!button || !form) return;
  button.onclick = () => { form.hidden = false; document.getElementById("resetEmail").value = document.getElementById("email").value.trim(); document.getElementById("resetEmail").focus(); };
  form.onsubmit = async event => {
    event.preventDefault(); const submit = form.querySelector("button[type=submit]"), status = document.getElementById("resetStatus");
    submit.disabled = true;
    try {
      await sendPasswordResetEmail(auth, document.getElementById("resetEmail").value.trim());
      status.textContent = "If an account exists for this email, a password reset link has been sent.";
    } catch (error) {
      status.textContent = ["auth/user-not-found", "auth/invalid-credential"].includes(error.code)
        ? "If an account exists for this email, a password reset link has been sent."
        : error.code === "auth/invalid-email" ? "Enter a valid email address." : error.code === "auth/too-many-requests" ? "Too many attempts. Wait a bit and try again." : "Unable to send the request. Check your connection and try again.";
    } finally { submit.disabled = false; }
  };
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
