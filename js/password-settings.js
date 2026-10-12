import {auth} from './firebase-config.js';
import {requireAuth,wireLogout,signOutAndClear} from './auth.js';
import {post} from './api.js';
import {EmailAuthProvider,reauthenticateWithCredential,updatePassword} from 'https://www.gstatic.com/firebasejs/10.13.0/firebase-auth.js';
import {initThemeToggle} from './theme.js';
initThemeToggle();
const logout=document.createElement('button');logout.id='logoutBtn';logout.type='button';logout.className='btn-sm';logout.textContent='Log out';document.getElementById('passwordForm').after(logout);wireLogout();
requireAuth(null,{allowPasswordChange:true}).then(profile=>{
  if(profile.mustChangePassword){const banner=document.createElement('p');banner.className='banner';banner.id='passwordRequirement';banner.textContent='You are currently using the default temporary password. Please change your password to secure your account.';document.getElementById('passwordForm').before(banner);}
  document.getElementById('backLink').href=({student:'student-dashboard.html',subject_faculty:'approver-dashboard.html',mentor:'mentor-dashboard.html',hod:'hod-dashboard.html',office:'office-dashboard.html',admin:'admin-dashboard.html',super_admin:'super-admin-dashboard.html'})[profile.role] || 'approver-dashboard.html';
  document.getElementById('passwordForm').onsubmit=async event=>{
    event.preventDefault();const status=document.getElementById('passwordStatus'),button=event.target.querySelector('button[type="submit"]');
    const next=document.getElementById('newPassword').value;
    if(next!==document.getElementById('confirmPassword').value) {status.textContent='New passwords do not match.';return;}
    if(next==='DemoPassword123!'){status.textContent='Choose a password different from the temporary password.';return;}
    button.disabled=true;
    try {
      await reauthenticateWithCredential(auth.currentUser,EmailAuthProvider.credential(auth.currentUser.email,document.getElementById('currentPassword').value));
      await updatePassword(auth.currentUser,next);
      // Password success must end this session even if metadata sync is offline.
      // Login also verifies Firebase password metadata before clearing a reminder.
      try{await auth.currentUser.getIdToken(true);await post('/api/auth/password-complete',{});}catch{/* Retry verified reminder completion on the next login. */}
      const message='Password changed successfully. Please log in again using your new password.';
      status.textContent=message;event.target.reset();
      await signOutAndClear();sessionStorage.setItem('passwordChangedNotice',message);window.location.replace('login.html');
    } catch(error) {
      status.textContent=['auth/invalid-credential','auth/wrong-password'].includes(error.code)?'Current password is incorrect.':error.code==='auth/requires-recent-login'?'Sign out, log in again, then retry changing your password.':error.code==='auth/weak-password'?'Choose a stronger password that meets your college password policy.':'Could not change the password. Check your connection and try again.';
    } finally {button.disabled=false;}
  };
}).catch(error=>{document.getElementById('passwordStatus').textContent=error.message;});
