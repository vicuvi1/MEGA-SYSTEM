# Signing the Windows app

Unsigned, Windows SmartScreen warns "unknown publisher" when you install, and
an update can't prove where it came from. The release workflow signs the app
by itself once these GitHub repository secrets exist (Settings → Secrets and
variables → Actions). Without them it keeps building unsigned.

1. In Azure, create a **Trusted Signing** account and a certificate profile
   (Public Trust; identity validation takes a few days). It costs about
   $10 a month.
2. Create an app registration (service principal) and give it the role
   **Trusted Signing Certificate Profile Signer** on the account.
3. Add these secrets:

| Secret | What |
| --- | --- |
| `AZURE_SIGN_ENDPOINT` | e.g. `https://weu.codesigning.azure.net` |
| `AZURE_SIGN_ACCOUNT` | the Trusted Signing account name |
| `AZURE_SIGN_PROFILE` | the certificate profile name |
| `AZURE_SIGN_PUBLISHER` | the publisher name on the certificate |
| `AZURE_TENANT_ID`, `AZURE_CLIENT_ID`, `AZURE_CLIENT_SECRET` | the app registration |

The next push to `main` builds a signed installer and signed updates.

## Turning it on, step by step

1. Azure portal → create a resource → **Trusted Signing Account** (pick a
   region; its endpoint looks like `https://<region>.codesigning.azure.net`).
2. In the account → **Identity validations** → New (Public, Organization or
   Individual). Wait until it says Completed.
3. **Certificate profiles** → Create → Public Trust, using that validation.
4. Microsoft Entra ID → App registrations → New registration. Under
   Certificates & secrets make a client secret. Note the tenant id, the
   client id and the secret.
5. In the Trusted Signing account → Access control (IAM) → add the role
   **Trusted Signing Certificate Profile Signer** for that app registration.
6. GitHub → the repo → Settings → Secrets and variables → Actions → add the
   seven secrets above.
7. Push anything under `src/` (or run the Release workflow by hand). The log
   says "Signing with Azure Trusted Signing"; without the secrets it says
   "No signing secrets: unsigned build" and still publishes, as before.

Updates come from the public GitHub Releases of this repository
(`publish.private: false` in package.json, and the same in the
`app-update.yml` the workflow writes), so installed apps need no token.

