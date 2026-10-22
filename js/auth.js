import {hasRole,isMentor,isFaculty} from './capabilities.js';
import {mountDepartmentContext} from './department-management.js';
import { auth, db } from "./firebase-config.js";
import {
  signInWithEmailAndPassword,
  signOut,
  onAuthStateChanged,
  sendPasswordResetEmail,
} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-auth.js";
import { doc, getDoc } from "./api-store.js";
import {publicPost,post,apiFetch} from './api.js';
import './password-visibility.js';
import './responsive-layout.js';
import {showPasswordReminder,reminderKey} from './password-reminder.js';

// Maps a user's role to the dashboard they land on after login.
const ROLE_HOME = {
  student: "student-dashboard.html",
  subject_faculty: "approver-dashboard.html",
  library: "approver-dashboard.html",
  physics_lab: "approver-dashboard.html",
  chemistry_lab: "approver-dashboard.html",
  accounts: "approver-dashboard.html",
  sports: "approver-dashboard.html",
  mentor: "mentor-dashboard.html",
  hod: "hod-dashboard.html",
  office: "office-dashboard.html",
  admin: "admin-dashboard.html",
  super_admin: "super-admin-dashboard.html",
};
const PROFILE_ERROR = "Your account exists but your institutional profile is not yet configured. Contact administrator.";
document.getElementById('logoutBtn')?.parentElement.classList.add('top-actions');
let intentionalSignOut = false;
let passwordChangeInProgress = false;
export const setPasswordChangeInProgress = value => {passwordChangeInProgress=!!value;};

/** Reads the signed-in user's profile document from /users/{uid}. */
export async function getCurrentUserProfile() {
  if (!auth.currentUser) return null;
  return apiFetch('/api/auth/profile');
}

/**
 * Call this at the top of every page except login.html.
 * Redirects to login if signed out. Resolves with the user's profile once ready.
 */
export function requireAuth(roles = null,{allowPasswordChange=false}={}) {
  return new Promise((resolve, reject) => {
    let generation=0,initial=null,settled=false,redirecting=false;
    const clear=()=>{document.getElementById('content')?.replaceChildren();document.querySelectorAll('dialog').forEach(d=>d.remove());};
    const redirect=profile=>{redirecting=true;clear();window.location.replace(profile&&ROLE_HOME[profile.role]||'login.html');};
    const validate=async user=>{
      const run=++generation;
      if(passwordChangeInProgress&&initial&&user?.uid===initial.uid)return;
      if(!user){if(!intentionalSignOut)redirect();return;}
      if(initial&&user.uid!==initial.uid){clear();}
      try {
      const profile = await getCurrentUserProfile();
      if(run!==generation||auth.currentUser?.uid!==user.uid)return;
      if (!profile || !ROLE_HOME[profile.role]) {
        redirect();
        return;
      }
      if (roles && !hasRole(profile,roles)) {
        redirect(profile);
        return;
      }
      if(initial&&(initial.uid!==profile.uid||initial.role!==profile.role)){redirect(profile);return;}
      if(settled)return;
      initial={uid:profile.uid,role:profile.role};settled=true;
      await mountDepartmentContext(profile).catch(()=>{});if(redirecting||auth.currentUser?.uid!==profile.uid)return;if(isMentor(profile)&&!document.getElementById('mentorCapabilityLink')){const a=document.createElement('a');a.id='mentorCapabilityLink';a.className='btn-sm';a.href='mentor-dashboard.html';a.textContent='My mentees';document.getElementById('logoutBtn')?.parentNode.append(a);}if(isFaculty(profile)&&!location.pathname.endsWith('/approver-dashboard.html')&&!document.getElementById('subjectCapabilityLink')){const a=document.createElement('a');a.id='subjectCapabilityLink';a.className='btn-sm';a.href='approver-dashboard.html#requests';a.textContent='Approval Desk';document.getElementById('logoutBtn')?.parentNode.append(a);}if(profile.role==='hod'&&!document.getElementById('hodCapabilityLink')){const a=document.createElement('a');a.id='hodCapabilityLink';a.className='btn-sm';a.href='hod-dashboard.html#requests';a.textContent='HOD final approvals';document.getElementById('logoutBtn')?.parentNode.append(a);}document.body.classList.remove('auth-pending');document.getElementById('dashboardAuthLoading')?.remove();resolve(profile);
      if (!allowPasswordChange) showPasswordReminder(profile);
      } catch (error) {
        if(run!==generation||intentionalSignOut||passwordChangeInProgress)return;
        if(['unauthenticated','account/inactive','department/inactive','account/leadership-revoked','institution/profile-missing'].includes(error.code)){redirect();return;}
        if(!settled){const loading=document.getElementById('dashboardAuthLoading');if(loading)loading.textContent='Unable to load dashboard. Please reload or sign in again.';reject(error);}
      }
    };
    const unsubscribe = onAuthStateChanged(auth, validate);
    const focus=()=>{if(document.visibilityState==='visible')validate(auth.currentUser);};
    window.addEventListener('focus',focus);document.addEventListener('visibilitychange',focus);
    window.addEventListener('pagehide',()=>{generation++;unsubscribe();window.removeEventListener('focus',focus);document.removeEventListener('visibilitychange',focus);},{once:true});
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
      await signOutAndClear();
      window.location.href = "login.html";
    });
  }
}

/** Wires up the login form (id="loginForm") if present on the page. */
export function wireLoginForm() {
  const form = document.getElementById("loginForm");
  if (!form) return;
  const blocked=sessionStorage.getItem('departmentInactiveNotice');if(blocked){sessionStorage.removeItem('departmentInactiveNotice');const el=document.getElementById('loginError');el.textContent=blocked;el.classList.remove('hidden');}
  const notice=sessionStorage.getItem('passwordChangedNotice');
  if(notice){sessionStorage.removeItem('passwordChangedNotice');const banner=document.createElement('p');banner.className='banner';banner.id='passwordChangedNotice';banner.setAttribute('role','status');banner.textContent=notice;form.before(banner);}

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
    const resolved=await publicPost('/api/auth/login',{identifier:email,password});
    await signInWithEmailAndPassword(auth, resolved.email, password);

let profile = await getCurrentUserProfile();
if(profile?.mustChangePassword){try{await post('/api/auth/password-complete',{});profile=await getCurrentUserProfile();}catch{/* Firebase proof is required; otherwise retain the reminder flag. */}}

if (!profile) {
  const error = new Error(PROFILE_ERROR); error.code = "institution/profile-missing"; throw error;
}



const home = ROLE_HOME[profile.role];

if (!home) {
  const error = new Error(PROFILE_ERROR); error.code = "institution/profile-missing"; throw error;
}

sessionStorage.removeItem(reminderKey(profile.uid));
window.location.href = home;
    } catch (err) {
      if (err.code === "institution/profile-missing") await signOut(auth);
      errorEl.textContent = err.code === "institution/profile-missing" ? PROFILE_ERROR : ['unauthenticated','too-many-requests','account/inactive','account/exited','account/not-found','department/inactive'].includes(err.code)?err.message:friendlyAuthError(err.code);
      errorEl.classList.remove("hidden");
      submitBtn.disabled = false;
      submitBtn.textContent = "Log in";
    }
  });
}

export function wireForgotPassword() {
  const button = document.getElementById("forgotPasswordBtn"), form = document.getElementById("resetForm");
  if (!button || !form) return;
  button.onclick = () => { form.hidden = false; const value=document.getElementById("email").value.trim();document.getElementById("resetEmail").value = value.includes('@')?value:''; document.getElementById("resetEmail").focus(); };
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

export async function signOutAndClear(){
  intentionalSignOut = true;
  try { await signOut(auth); } catch(error) { intentionalSignOut = false; throw error; }
  for(const key of Object.keys(sessionStorage))if(key.startsWith('temporary-password-reminder:')||key.startsWith('noDueSubmitKey:')||key.startsWith('department-context:'))sessionStorage.removeItem(key);
}

let departmentRedirecting=false;window.addEventListener('auth:department-inactive',async event=>{if(departmentRedirecting||document.getElementById('loginForm'))return;departmentRedirecting=true;document.getElementById('content')?.replaceChildren();document.querySelectorAll('dialog').forEach(d=>d.remove());sessionStorage.setItem('departmentInactiveNotice',event.detail);try{await signOutAndClear();}finally{location.replace('login.html');}});
