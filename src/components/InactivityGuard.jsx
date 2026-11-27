import { useCallback, useEffect, useRef, useState } from 'react';

const INACTIVITY_LIMIT_MS = 15 * 60 * 1000;
const WARNING_PERIOD_MS = 60 * 1000;

export default function InactivityGuard({ onSignOut }) {
  const [secondsLeft, setSecondsLeft] = useState(null);
  const lastActivityRef = useRef(Date.now());
  const signingOutRef = useRef(false);
  const onSignOutRef = useRef(onSignOut);

  useEffect(() => {
    onSignOutRef.current = onSignOut;
  }, [onSignOut]);

  const staySignedIn = useCallback(() => {
    lastActivityRef.current = Date.now();
    setSecondsLeft(null);
    signingOutRef.current = false;
  }, []);

  useEffect(() => {
    const recordActivity = () => {
      if (signingOutRef.current) return;
      lastActivityRef.current = Date.now();
      setSecondsLeft(null);
    };

    const events = ['pointerdown', 'keydown', 'touchstart', 'wheel', 'scroll'];
    events.forEach((eventName) => window.addEventListener(eventName, recordActivity, { passive: true }));

    const intervalId = window.setInterval(() => {
      const elapsed = Date.now() - lastActivityRef.current;
      const remaining = INACTIVITY_LIMIT_MS - elapsed;

      if (remaining <= 0) {
        if (!signingOutRef.current) {
          signingOutRef.current = true;
          setSecondsLeft(0);
          onSignOutRef.current();
        }
        return;
      }

      if (remaining <= WARNING_PERIOD_MS) {
        setSecondsLeft(Math.ceil(remaining / 1000));
      } else {
        setSecondsLeft(null);
      }
    }, 250);

    return () => {
      window.clearInterval(intervalId);
      events.forEach((eventName) => window.removeEventListener(eventName, recordActivity));
    };
  }, []);

  if (secondsLeft === null) return null;

  return (
    <div className="inactivity-overlay" role="presentation">
      <section className="inactivity-dialog" role="alertdialog" aria-modal="true" aria-labelledby="inactivity-title" aria-describedby="inactivity-description">
        <div className="inactivity-dialog__lock" aria-hidden="true">🔒</div>
        <p className="inactivity-dialog__eyebrow">SESSION SECURITY</p>
        <h2 id="inactivity-title">Still there?</h2>
        <p id="inactivity-description">For your security, Access Vault will sign you out due to inactivity.</p>
        <div className="inactivity-countdown" aria-live="off">
          <span>{String(Math.floor(secondsLeft / 60)).padStart(2, '0')}:{String(secondsLeft % 60).padStart(2, '0')}</span>
        </div>
        <p className="inactivity-dialog__hint">Your encrypted files remain protected.</p>
        <button className="inactivity-dialog__button" type="button" onClick={staySignedIn}>Stay signed in</button>
        <button className="inactivity-dialog__signout" type="button" onClick={() => onSignOutRef.current()}>Sign out now</button>
      </section>
    </div>
  );
}
