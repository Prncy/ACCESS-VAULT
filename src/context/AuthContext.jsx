import { createContext, useCallback, useContext, useMemo, useState } from 'react';
import { authApi } from '../services/authApi.js';
import { logAuditEvent } from '../services/auditService.js';
import * as authFlow from '../services/authFlow.js';

authFlow.configure({ backend: authApi });

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [session, setSession] = useState(null);
  const [notice, setNotice] = useState(null);

  const register = useCallback(async ({ displayName, email, password }) => {
    const cleanEmail = email.trim();
    const cleanName = displayName.trim();
    const { userId } = await authFlow.register(cleanEmail, cleanName, password);
    setNotice(null);
    setSession({ userId, email: cleanEmail, displayName: cleanName, justRegistered: true });
  }, []);

  const login = useCallback(async ({ email, password }) => {
    const cleanEmail = email.trim();
    const { userId, displayName } = await authFlow.login(cleanEmail, password);
    // Authentication and key-unwrapping have both succeeded. Audit failure must
    // never turn a valid sign-in into a failed sign-in.
    try {
      await logAuditEvent('LOGIN');
    } catch (err) {
      console.warn('[audit] LOGIN event could not be recorded', err);
    }
    setNotice(null);
    setSession({ userId, email: cleanEmail, displayName: displayName ?? null });
  }, []);

  const logout = useCallback(async () => {
    await authFlow.logout();
    setSession(null);
    setNotice('signed_out');
  }, []);

  const value = useMemo(
    () => ({ session, notice, isAuthenticated: session !== null, register, login, logout }),
    [session, notice, register, login, logout],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>');
  return ctx;
}
