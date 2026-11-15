import { useState } from 'react';
import { useAuth } from '../context/AuthContext.jsx';
import { USING_MOCK } from '../services/authApi.js';
import FolderExplorer from '../components/explorer/FolderExplorer.jsx';
import SharedWithMe from '../components/explorer/SharedWithMe.jsx';
import Logo from '../components/Logo.jsx';
import Alert from '../components/Alert.jsx';
import Button from '../components/Button.jsx';

export default function VaultPlaceholderPage() {
  const { session, logout } = useAuth();
  const [view, setView] = useState('mine');

  return (
    <div className="vault vault--workspace">
      <header className="vault__bar">
        <div className="vault__brand"><Logo /></div>
        <div className="vault__topbar-right">
          <span className="vault__security"><span aria-hidden="true">🔒</span> Private workspace</span>
          <div className="vault__user">
            <span className="vault__avatar" aria-hidden="true">{(session.displayName ?? session.email ?? 'U').slice(0, 1).toUpperCase()}</span>
            <span className="vault__identity"><strong>{session.displayName ?? 'Your account'}</strong><small>{session.email}</small></span>
            <Button variant="ghost" onClick={logout}>Sign out</Button>
          </div>
        </div>
      </header>

      <main className="vault__workspace">
        <aside className="vault-nav" aria-label="Main navigation">
          <p className="vault-nav__label">WORKSPACE</p>
          <button type="button" className={view === 'mine' ? 'is-active' : ''} onClick={() => setView('mine')}><span aria-hidden="true">▦</span> My vault</button>
          <button type="button" className={view === 'shared' ? 'is-active' : ''} onClick={() => setView('shared')}><span aria-hidden="true">♧</span> Shared with me</button>
          <div className="vault-nav__bottom"><span aria-hidden="true">🛡️</span><strong>Zero-knowledge storage</strong><small>Your files are encrypted before upload. The server never sees their contents or names.</small></div>
        </aside>

        <div className="vault__main">
          {session.justRegistered && <Alert variant="success">Your account is ready. You're signed in.</Alert>}
          {USING_MOCK && (
            <Alert variant="info" title="Mock mode">
              You are signed in against the built-in mock, not the real backend. Set VITE_USE_MOCK=false in .env.local to use Supabase.
            </Alert>
          )}
          {view === 'mine' ? <FolderExplorer /> : <SharedWithMe />}
        </div>
      </main>
    </div>
  );
}
