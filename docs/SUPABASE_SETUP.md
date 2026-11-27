# Supabase setup

This guide explains how to connect the Access Vault frontend to a Supabase project. It covers a **new Supabase project** and the environment configuration used by local development and GitHub Pages deployment.

> **Important:** If your Supabase project is already connected and working, do not rerun the migrations just because this guide was updated. This is setup documentation, not a request to reset or recreate the database.

## 1. What Supabase is responsible for

Access Vault uses Supabase for:

- Authentication.
- Database records for users, folders, files, shares, key envelopes and audit activity.
- Row Level Security (RLS) to restrict which records an authenticated user can access.
- Storage of encrypted file data.

File contents are encrypted in the browser before they are uploaded. The application is designed so that the server stores encrypted content rather than readable document contents. This does not remove the need for correct database, storage and authentication policies.

## 2. Apply the database migrations

1. Create or open your Supabase project.
2. Open **SQL Editor** in the Supabase dashboard.
3. Open the SQL files in `supabase/migrations/` in the repository.
4. Apply the numbered migration files in ascending order, following the filenames.
5. Review each query and confirm it completes successfully before moving to the next one.

The migrations define and update the database schema, authentication integration, access policies and security hardening. Keep the migration files in the repository as the record of the database changes.

### Before applying the authentication integration migration

The migration `001_auth_integration.sql` defines the `get_auth_params` function. Before applying it to a new project:

- Inspect the existing triggers on `auth.users` so that an old sign-up trigger does not create duplicate user rows.
- Replace the example `v_pepper` value in the migration with a long, randomly generated value of your own.
- Do not publish or commit a real pepper or other private operational values.

To inspect existing triggers, run:

```sql
select tgname, pg_get_triggerdef(oid)
from pg_trigger
where tgrelid = 'auth.users'::regclass
  and not tgisinternal;
```

If an existing trigger performs the same user-row insertion, handle it before creating the new trigger. Do not blindly drop triggers without checking what they do.

**Do not run optional destructive cleanup SQL** from an old test setup unless you intentionally want to delete the listed test data. The cleanup block in the authentication migration can remove user and application records.

## 3. Configure Supabase Authentication

In the Supabase dashboard, open **Authentication → Sign In / Providers → Email**.

Choose the email-confirmation setting that suits your environment:

- For a controlled local demo, email confirmation may be disabled to simplify registration.
- For a real deployment, configure email delivery and keep confirmation enabled where appropriate.

The application uses a password-derived authentication secret. The user's typed password is used in the browser to derive the value supplied to Supabase Auth; the typed password itself should not be sent as the Supabase Auth password.

## 4. Configure the frontend locally

The repository includes a safe template named `.env.example`. Copy it to `.env.local`:

```bash
cp .env.example .env.local
```

On Windows PowerShell, you can use:

```powershell
Copy-Item .env.example .env.local
```

Set the values in `.env.local`:

```env
VITE_USE_MOCK=false
VITE_SUPABASE_URL=https://your-project-ref.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=your-supabase-publishable-key
```

Find the project URL and publishable key in your Supabase project settings.

Then install dependencies and start the development server:

```bash
npm ci
npm run dev
```

If you change environment values while the development server is running, stop and restart it.

## 5. GitHub Pages deployment

The GitHub Actions workflow builds the frontend using repository-level Actions variables.

In GitHub, open:

**Repository → Settings → Secrets and variables → Actions → Variables**

Create these repository variables with the exact names:

- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_PUBLISHABLE_KEY`

The workflow checks that both values exist before building. It uses Node.js 22, runs `npm ci` and `npm run build`, then deploys the generated site to GitHub Pages.

The workflow also creates a `404.html` copy of the app entry point so client-side routes can be handled when users open or refresh a route directly.

## 6. Environment-variable and key safety

- `.env.local` and other local environment files are ignored by Git.
- `.env.example` contains placeholders only and is safe to commit.
- The Supabase URL and **publishable** key are frontend configuration. Values prefixed with `VITE_` are included in the browser build and are not secret.
- Never put a Supabase `service_role` key, database password, private API key or other privileged credential in a `VITE_` variable, frontend source code or a public repository.
- The publishable key is safe to use in the browser only when database and storage access are correctly protected by RLS and the relevant policies.
- Removing a credential from the latest Git commit does not remove it from earlier Git history. If a privileged credential was ever committed or exposed, rotate it in the provider dashboard.

## 7. How authentication and key setup work

### Registration

1. The browser derives the authentication secret and cryptographic key material from the user's password.
2. The frontend calls Supabase Auth to create the account.
3. The registration metadata includes the cryptographic fields required by the application.
4. The database trigger creates the corresponding `public.users` row.

### Login

1. The frontend calls `get_auth_params` to obtain the user's KDF salt and iteration count.
2. The browser derives the authentication secret.
3. Supabase Auth verifies the derived secret.
4. The application retrieves the signed-in user's own profile and wrapped private-key data, then unlocks the private key in the browser.

The Supabase client is configured with `persistSession: false`. The authenticated session and unlocked key material are held in memory; refreshing the page signs the user out and requires another login.

## 8. Security checks after setup

Run these checks using test accounts and non-sensitive test files:

| Check | Expected result |
|---|---|
| Register a new account | Account is created and its application user row contains the required cryptographic metadata |
| Sign in with the correct password | User reaches their vault |
| Sign in with an incorrect password | Login fails with a generic authentication error |
| Open another user's private folders | Access is denied |
| Try to read another user's private user record | RLS prevents access |
| Upload and download a test file | The owner can retrieve and decrypt their file |
| Share a test item with another account | The recipient can access only what the share permits |
| Refresh while signed in | The in-memory session is cleared and login is required |
| Inspect frontend configuration | No service-role key or database password is present |

Also review the Supabase dashboard's RLS and Storage policies. A successful frontend build does not prove that backend access policies are correct.

## 9. Important implementation notes

- The frontend uses the Supabase publishable key; the service-role key must remain private.
- RLS is a core access-control boundary. Do not disable it to make a frontend operation work.
- The application restricts users from changing protected profile fields such as roles and cryptographic key data through ordinary profile updates.
- Audit records should be written through the database mechanisms configured by the migrations, not by allowing clients unrestricted direct writes.
- Fingerprint comparison is an out-of-band verification step. Users should compare fingerprints through a trusted independent channel; displaying a fingerprint alone does not guarantee that a recipient is authentic.
- This guide describes the current academic Version 1 implementation. Review the actual policies and deployment configuration before using real or sensitive data.
