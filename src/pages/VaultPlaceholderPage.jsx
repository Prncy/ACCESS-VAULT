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
        <div className="vault__main">
          <div className="vault-workspace-switcher-row">
            <details className="vault-workspace-switcher">
              <summary aria-label="Switch workspace">
                <span className="vault-workspace-switcher__icon" aria-hidden="true">{view === 'mine' ? '▦' : '♧'}</span>
                <span>{view === 'mine' ? 'My vault' : 'Shared with me'}</span>
                <span className="vault-workspace-switcher__chevron" aria-hidden="true">⌄</span>
              </summary>
              <div className="vault-workspace-switcher__menu">
                <button type="button" className={view === 'mine' ? 'is-active' : ''} onClick={(event) => { setView('mine'); event.currentTarget.closest('details')?.removeAttribute('open'); }}>
                  <span aria-hidden="true">▦</span> My vault {view === 'mine' && <span className="vault-workspace-switcher__check">✓</span>}
                </button>
                <button type="button" className={view === 'shared' ? 'is-active' : ''} onClick={(event) => { setView('shared'); event.currentTarget.closest('details')?.removeAttribute('open'); }}>
                  <span aria-hidden="true">♧</span> Shared with me {view === 'shared' && <span className="vault-workspace-switcher__check">✓</span>}
                </button>
              </div>
            </details>
          </div>
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
