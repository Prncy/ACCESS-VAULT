import { useState } from 'react';
import AuthLayout from '../components/AuthLayout.jsx';
import PasswordField from '../components/PasswordField.jsx';
import Button from '../components/Button.jsx';
import Alert from '../components/Alert.jsx';
import { useAuth } from '../context/AuthContext.jsx';
import { ERROR_CODES } from '../services/contract.js';

export default function UnlockPage() {
  const { pendingUnlock, unlock, logout } = useAuth();
  const [password, setPassword] = useState('');
  const [error, setError] = useState(null);
  const [submitting, setSubmitting] = useState(false);

  const onSubmit = async (event) => {
    event.preventDefault();
    setError(null);
    if (!password) {
      setError('Enter your password to unlock your vault.');
      return;
    }
    setSubmitting(true);
    try {
      await unlock({ password });
    } catch (err) {
      setError(err.code === ERROR_CODES.INVALID_CREDENTIALS
        ? 'Incorrect password. Please try again.'
        : (err.message || 'Could not unlock your vault. Please try again.'));
      setSubmitting(false);
    }
  };

  return (
    <AuthLayout
      title="Unlock your vault"
      subtitle="Your account is still signed in. Enter your password to decrypt your private vault on this device."
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: '.7rem', padding: '.75rem', marginBottom: '1rem', border: '1px solid #344760', borderRadius: '8px', background: '#172333' }}>
        <span aria-hidden="true">🔒</span>
        <span style={{ display: 'grid', minWidth: 0 }}>
          <small style={{ color: '#91a1b7' }}>Signed in as</small>
          <strong style={{ overflowWrap: 'anywhere', fontSize: '.88rem' }}>{pendingUnlock?.email}</strong>
        </span>
      </div>
      {error && <Alert variant="error">{error}</Alert>}
      <form onSubmit={onSubmit} noValidate>
        <PasswordField
          label="Password"
          name="password"
          autoComplete="current-password"
          autoFocus
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          hint="Your password is used locally to unlock your encryption keys."
        />
        <Button type="submit" loading={submitting}>
          {submitting ? 'Unlocking…' : 'Unlock vault'}
        </Button>
      </form>
      <div style={{ display: 'flex', justifyContent: 'center', marginTop: '1rem' }}>
        <Button variant="ghost" onClick={logout}>Not you? Sign out</Button>
      </div>
    </AuthLayout>
  );
}
