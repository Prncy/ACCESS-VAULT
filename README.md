# Access Vault

**Share documents the server can't read.**

Access Vault is an end-to-end encrypted document-sharing web application built with React, Vite and Supabase. It is designed so that files and folder names are encrypted in the browser before they are stored. The server handles authentication, encrypted data storage and access control, but is not intended to read users' document contents.

This repository contains the Version 1 application, its database migrations and supporting documentation.

## Version 1 features

- **Account registration and sign-in** using a browser-side key derivation flow.
- **Encrypted personal vault** with nested folder creation, renaming and deletion.
- **Encrypted file uploads and downloads**, including chunked file handling and integrity verification during download.
- **Folder sharing** with another registered user and a separate **Shared with me** view. Shared access is read-only in the current interface.
- **Security fingerprints** that users can reveal and compare with each other through an independent trusted channel.
- **Activity history** for account and vault events.
- **Session protection**, including memory-only session state, manual sign-out confirmation and automatic sign-out after inactivity.
- **Responsive interface** for desktop and smaller screens.

## How the security model works

Access Vault performs its encryption work in the browser.

- The user's typed password is used locally to derive authentication and cryptographic material. The typed password itself is not sent to the application backend or stored by the app.
- File contents and folder names are encrypted before upload.
- File encryption uses per-file keys and chunked processing. Downloads are verified and decrypted in the browser.
- Private key material is protected using the account's password-derived key material. Decrypted session keys are held in memory rather than browser local storage.
- Supabase stores encrypted application data and enforces access through database policies and authenticated requests.
- The application uses a Supabase publishable key in the frontend. A Supabase service-role key must never be placed in frontend code, a `VITE_` variable, or this repository.

**Important:** End-to-end encryption reduces what the storage service can see, but it does not make an application automatically secure. The security of a deployment also depends on correct database policies, storage policies, key handling, account security, browser/device security and careful operation. Treat this as a Version 1 academic/portfolio project, not a security-audited production service.

### Fingerprint verification

A fingerprint is a representation of a user's public key. Before trusting a newly shared connection, users should compare the fingerprint shown for the other account with that account holder through a separate trusted channel (for example, in person or over a channel they have independently verified). Do not rely only on a name or email address.

### Session behaviour

The authenticated application session and decrypted keys are held in memory. Refreshing the page or closing the tab ends the in-memory session, so the user must sign in again. The app also signs the user out after a period of inactivity.

## Technology

- React 18
- Vite
- React Router
- Supabase Auth
- Supabase Postgres and Storage
- Web Crypto-based client-side cryptographic operations
- Vitest and Testing Library

## Run locally

### Requirements

- Node.js 22 or later
- npm
- A Supabase project configured with the database migrations

### 1. Clone the repository

```bash
git clone https://github.com/Prncy/ACCESS-VAULT.git
cd ACCESS-VAULT
npm install
```

### 2. Configure environment variables

Copy the example file:

```bash
cp .env.example .env.local
```

Open `.env.local` and replace the placeholders with your Supabase project URL and publishable key:

```env
VITE_USE_MOCK=false
VITE_SUPABASE_URL=https://your-project-ref.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=your-supabase-publishable-key
```

Then start the development server:

```bash
npm run dev
```

Vite prints the local development URL in the terminal (normally `http://localhost:5173`).

### 3. Supabase database setup

The SQL migrations are in `supabase/migrations/`. Apply the migrations to your Supabase project in numerical order, from `001` through `008`, using the Supabase SQL Editor or your normal migration workflow.

Before using a database for real users:

1. Review the setup notes in [docs/SUPABASE_SETUP.md](docs/SUPABASE_SETUP.md).
2. Configure the project-specific authentication settings and secrets described there.
3. Confirm that all migrations have completed successfully.
4. Verify the Row Level Security (RLS) and Storage policies for the tables and bucket used by the app.
5. Test registration, sign-in, folder and file operations, sharing, access revocation and activity logging with separate test accounts.

Do not assume that creating the frontend environment file also configures Supabase. The database, authentication provider and storage policies must be configured separately.

## Tests and production build

Run the available project checks:

```bash
npm test
npm run test:flow
npm run test:crypto
npm run build
```

- `npm test` runs the Vitest test suite.
- `npm run test:flow` runs the authentication-flow test script.
- `npm run test:crypto` runs the cryptography test script.
- `npm run build` creates the production build in `dist/`.

## Deployment

The repository includes a GitHub Actions workflow at [`.github/workflows/deploy.yml`](.github/workflows/deploy.yml) for deploying the Vite application to GitHub Pages when changes are pushed to `main`.

In the GitHub repository, configure these **Actions repository variables** under **Settings → Secrets and variables → Actions → Variables**:

- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_PUBLISHABLE_KEY`

The workflow injects these values during the build and checks that both are present. It also creates the GitHub Pages single-page-app fallback so direct visits and refreshes on application routes can be handled by the client router.

The Supabase URL and publishable key are frontend configuration values and will be visible to users in the built application. This is expected. Database security must come from correct RLS and Storage policies. **Never add a service-role key, database password, or other privileged secret to these repository variables or to any `VITE_` variable.**

## Environment-file safety

- `.env.local` and other local environment files are ignored by Git.
- `.env.example` is the safe template committed to the repository; it contains placeholders only.
- Create your own `.env.local` from that template and do not commit it.
- If a privileged secret was ever committed, deleting it in a later commit is not enough: rotate the exposed secret and consider cleaning it from Git history.

## Project structure

```text
src/
  components/
    audit/          Activity history UI
    explorer/       Folder explorer, sharing and shared-with-me UI
    auth/           Authentication-related components
  context/          Authentication and in-memory session state
  crypto/           Cryptographic primitives and key operations
  pages/            Login, registration and vault workspace pages
  services/         Authentication, encryption flows, Supabase APIs,
                    file/folder operations, sharing and audit services
  styles/           Global styles and theme
  utils/            Shared utility functions
supabase/
  migrations/       Ordered database migrations (001–008)
docs/               Setup, handoff and project notes
.github/
  workflows/        GitHub Actions deployment workflow
```

## Current scope and limitations

Access Vault Version 1 is a working project prototype, not a formal security product. It has not been represented as independently security-audited or penetration-tested. Before relying on it for sensitive or irreplaceable documents, review the implementation and deployment configuration, test recovery and sharing workflows, and obtain an independent security review.

The project is actively documented as implemented. Features not present in the current application should not be assumed to be available.

## License

No open-source license has been added yet. Unless a license is added to this repository, standard copyright rules apply and reuse is not automatically granted.
