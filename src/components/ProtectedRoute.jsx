import { Navigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.jsx';

export default function ProtectedRoute({ children }) {
  const { isAuthenticated, isLocked, isRestoring } = useAuth();
  if (isRestoring) return <div role="status" style={{ padding: '2rem', color: '#aebbd0' }}>Restoring your session…</div>;
  if (isLocked) return <Navigate to="/unlock" replace />;
  return isAuthenticated ? children : <Navigate to="/login" replace />;
}
