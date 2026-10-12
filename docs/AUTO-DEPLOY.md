# Automatic production deployment

Push to `main` to publish changes. A successful push starts deployments; wait for each deployment to succeed before checking the live application.

## Render backend

`render.yaml` declares `branch: main` and `autoDeployTrigger: commit`. For the existing production service, confirm Settings → Build & Deploy → Branch is `main` and Auto-Deploy is **On Commit**. If managed by a Blueprint, sync this configuration with that existing Blueprint. Do not create a second service.

The existing service is https://dashboard.render.com/web/srv-db5m85qd0e5s73fuvsb0/settings. The YAML alone does not prove that an existing manually configured service has applied these settings. Render's `server` root directory means frontend-only changes do not require a backend deployment.

## Firebase Hosting frontend

`.github/workflows/firebase-hosting.yml` deploys the live Hosting site on pushes to `main`. It can also be started manually from GitHub Actions. It deploys Hosting only, using the existing `firebase.json` exclusions; it does not deploy Functions, rules, Auth or database data.

The repository Actions secret `FIREBASE_SERVICE_ACCOUNT_DIGITAL_NO_DUE_SHAYAN` is configured with the dedicated `github-hosting-deploy` service account in project `digital-no-due-shayan`. It has only Firebase Hosting Admin and Service Usage Consumer roles. The key is stored as an encrypted Actions secret, not in the repository. Do not replace it with the application's broad Firebase Admin credential or commit the JSON key.

Repository secrets: https://github.com/shayankhan05/Digital-No-due-form/settings/secrets/actions

Verify a green **Deploy frontend to Firebase Hosting** run at https://github.com/shayankhan05/Digital-No-due-form/actions and check https://digital-no-due-shayan.web.app.

## Normal use

```powershell
git add .
git commit -m "Describe the change"
git push origin main
```

Automatic deployment does not eliminate deployment time or the Render free plan's idle startup delay. No account provisioning, emulator reset or database migration is part of these workflows.
