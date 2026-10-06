import {auth} from './firebase-config.js';
import {requireAuth} from './auth.js';
import {EmailAuthProvider,reauthenticateWithCredential,updatePassword} from 'https://www.gstatic.com/firebasejs/10.13.0/firebase-auth.js';
import {initThemeToggle} from './theme.js';
initThemeToggle();
requireAuth().then(profile=>{
  document.getElementById('backLink').href=({student:'student-dashboard.html',subject_faculty:'approver-dashboard.html',mentor:'mentor-dashboard.html',hod:'hod-dashboard.html',office:'office-dashboard.html',admin:'admin-dashboard.html'})[profile.role] || 'approver-dashboard.html';
  document.getElementById('passwordForm').onsubmit=async event=>{
    event.preventDefault();const status=document.getElementById('passwordStatus'),button=event.target.querySelector('button');
    const next=document.getElementById('newPassword').value;
    if(next!==document.getElementById('confirmPassword').value) {status.textContent='New passwords do not match.';return;}
    button.disabled=true;
    try {
      await reauthenticateWithCredential(auth.currentUser,EmailAuthProvider.credential(auth.currentUser.email,document.getElementById('currentPassword').value));
      await updatePassword(auth.currentUser,next);
      event.target.reset();status.textContent='Password changed. Use your new password next time you log in.';
    } catch(error) {
      status.textContent=['auth/invalid-credential','auth/wrong-password'].includes(error.code)?'Current password is incorrect.':error.code==='auth/requires-recent-login'?'Sign out, log in again, then retry changing your password.':error.code==='auth/weak-password'?'Choose a stronger password that meets your college password policy.':'Could not change the password. Check your connection and try again.';
    } finally {button.disabled=false;}
  };
}).catch(error=>{document.getElementById('passwordStatus').textContent=error.message;});
