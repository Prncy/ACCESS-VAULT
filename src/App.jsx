import { Navigate, Route, Routes } from 'react-router-dom';
import { useAuth } from './context/AuthContext.jsx';
import LoginPage from './pages/LoginPage.jsx';
import RegisterPage from './pages/RegisterPage.jsx';
import UnlockPage from './pages/UnlockPage.jsx';
import NotFoundPage from './pages/NotFoundPage.jsx';
import VaultPlaceholderPage from './pages/VaultPlaceholderPage.jsx';
import ProtectedRoute from './components/ProtectedRoute.jsx';

function PublicOnly({ children }) {
  const { isAuthenticated, isLocked, isRestoring } = useAuth();
  if (isRestoring) return <div role="status" style={{ padding: '2rem', color: '#aebbd0' }}>Restoring your session…</div>;
  if (isLocked) return <Navigate to="/unlock" replace />;
  return isAuthenticated ? <Navigate to="/vault" replace /> : children;
}

function UnlockRoute() {
  const { isAuthenticated, isLocked, isRestoring } = useAuth();
  if (isRestoring) return <div role="status" style={{ padding: '2rem', color: '#aebbd0' }}>Restoring your session…</div>;
  if (isAuthenticated) return <Navigate to="/vault" replace />;
  if (!isLocked) return <Navigate to="/login" replace />;
  return <UnlockPage />;
}

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<Navigate to="/vault" replace />} />
      <Route path="/login" element={<PublicOnly><LoginPage /></PublicOnly>} />
      <Route path="/register" element={<PublicOnly><RegisterPage /></PublicOnly>} />
      <Route path="/unlock" element={<UnlockRoute />} />
      <Route path="/vault" element={<ProtectedRoute><VaultPlaceholderPage /></ProtectedRoute>} />
      <Route path="*" element={<NotFoundPage />} />
    </Routes>
  );
}
