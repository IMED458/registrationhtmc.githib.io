import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './AuthContext';
import Layout from './components/Layout';
import LoginPage from './pages/LoginPage';
import Dashboard from './pages/Dashboard';
import NewRequestPage from './pages/NewRequestPage';
import RequestDetailsPage from './pages/RequestDetailsPage';
import PrintPage from './pages/PrintPage';
import AdminSettingsPage from './pages/AdminSettingsPage';
import FirebaseSetupPage from './pages/FirebaseSetupPage';
import { isFirebaseConfigured } from './firebase';

function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth();
  
  if (loading) return <div className="min-h-screen flex items-center justify-center bg-slate-50">იტვირთება...</div>;
  if (!user) return <Navigate to="/login" />;
  
  return <Layout>{children}</Layout>;
}

function LoginRoute() {
  const { user, profile, loading } = useAuth();

  if (loading) {
    return <div className="min-h-screen flex items-center justify-center bg-slate-50">იტვირთება...</div>;
  }

  if (user && profile) {
    return <Navigate to="/" replace />;
  }

  return <LoginPage />;
}

export default function App() {
  if (!isFirebaseConfigured) {
    return <FirebaseSetupPage />;
  }

  return (
    <AuthProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/login" element={<LoginRoute />} />
          
          <Route path="/" element={
            <ProtectedRoute>
              <Dashboard />
            </ProtectedRoute>
          } />
          
          <Route path="/new-request" element={
            <ProtectedRoute>
              <NewRequestPage />
            </ProtectedRoute>
          } />
          
          <Route path="/request/:id" element={
            <ProtectedRoute>
              <RequestDetailsPage />
            </ProtectedRoute>
          } />
          
          <Route path="/print/:id" element={
            <ProtectedRoute>
              <PrintPage />
            </ProtectedRoute>
          } />
          
          <Route path="/settings" element={
            <ProtectedRoute>
              <AdminSettingsPage />
            </ProtectedRoute>
          } />

          <Route path="*" element={<Navigate to="/" />} />
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  );
}
