import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { authApi, USING_MOCK } from '../services/authApi.js';
import * as authFlow from '../services/authFlow.js';

authFlow.configure({ backend: authApi });

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [session, setSession] = useState(null);
  const [pendingUnlock, setPendingUnlock] = useState(null);
  const [isRestoring, setIsRestoring] = useState(!USING_MOCK);
  const [notice, setNotice] = useState(null);

  // Restore the Supabase identity only. Encryption keys are never restored from storage.
  useEffect(() => {
    let active = true;
    authApi.getCurrentSession()
      .then((restored) => {
        if (active && restored) setPendingUnlock({ userId: restored.userId, email: restored.email });
      })
      .catch((error) => console.error('[auth] Could not restore the sign-in session', error))
      .finally(() => { if (active) setIsRestoring(false); });
    return () => { active = false; };
  }, []);

  const register = useCallback(async ({ displayName, email, password }) => {
    const cleanEmail = email.trim();
    const cleanName = displayName.trim();
    const { userId } = await authFlow.register(cleanEmail, cleanName, password);
    setNotice(null);
    setPendingUnlock(null);
    setSession({ userId, email: cleanEmail, displayName: cleanName, justRegistered: true });
  }, []);

  const login = useCallback(async ({ email, password }) => {
    const cleanEmail = email.trim();
    const { userId, displayName } = await authFlow.login(cleanEmail, password);
    setNotice(null);
    setPendingUnlock(null);
    setSession({ userId, email: cleanEmail, displayName: displayName ?? null });
  }, []);

  const unlock = useCallback(async ({ password }) => {
    if (!pendingUnlock?.email) throw new Error('Please sign in again.');
    const { userId, displayName } = await authFlow.login(pendingUnlock.email, password);
    setNotice(null);
    setPendingUnlock(null);
    setSession({ userId, email: pendingUnlock.email, displayName: displayName ?? null });
  }, [pendingUnlock]);

  const logout = useCallback(async () => {
    await authFlow.logout();
    setSession(null);
    setPendingUnlock(null);
    setNotice('signed_out');
  }, []);

  const value = useMemo(() => ({
    session, pendingUnlock, isRestoring, notice,
    isAuthenticated: session !== null,
    isLocked: pendingUnlock !== null,
    register, login, unlock, logout,
  }), [session, pendingUnlock, isRestoring, notice, register, login, unlock, logout]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>');
  return ctx;
}
