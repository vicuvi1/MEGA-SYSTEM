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
