import { useAuth } from '../context/AuthContext.jsx';
import NotFoundPage from '../pages/NotFoundPage.jsx';

export default function ProtectedRoute({ children }) {
  const { isAuthenticated } = useAuth();
  return isAuthenticated ? children : <NotFoundPage />;
}
