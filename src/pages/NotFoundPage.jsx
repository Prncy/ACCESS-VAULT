import { Link } from 'react-router-dom';
import Logo from '../components/Logo.jsx';

export default function NotFoundPage() {
  return (
    <main className="not-found">
      <header className="not-found__header">
        <Link to="/vault" aria-label="Access Vault home">
          <Logo />
        </Link>
      </header>

      <section className="not-found__content" aria-labelledby="not-found-title">
        <div className="not-found__art" aria-hidden="true">
          <span className="not-found__orbit not-found__orbit--one" />
          <span className="not-found__orbit not-found__orbit--two" />
          <span className="not-found__lock">⌑</span>
          <span className="not-found__code">404</span>
        </div>
        <p className="not-found__eyebrow">PAGE NOT FOUND</p>
        <h1 id="not-found-title">Looks like this file is missing.</h1>
        <p className="not-found__description">
          The page you’re looking for may have moved, been renamed, or never existed.
          Your files are safe — this address just doesn’t lead anywhere.
        </p>
        <div className="not-found__actions">
          <Link className="btn btn--primary" to="/vault">Return to my vault</Link>
          <button className="btn btn--ghost" type="button" onClick={() => window.history.back()}>
            Go back
          </button>
        </div>
        <p className="not-found__footnote">ACCESS VAULT <span>·</span> YOUR FILES. YOUR KEYS. YOUR CONTROL.</p>
      </section>
    </main>
  );
}
