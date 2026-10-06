import { lazy, Suspense, useEffect } from 'react';
import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { useSelector } from 'react-redux';
import Layout from './components/Layout';
import { hasChosenLanguage } from './i18n';
import { watchNetwork } from './lib/network';
import { flushOutbox } from './lib/emergency';
import { flushHwQueue } from './lib/hwQueue';
import { ADMIN_ROLES, STAFF_ROLES } from './store';
import Language from './pages/Language';
import Login from './pages/Login';
import Home from './pages/Home';
import Book from './pages/Book';
import Appointment from './pages/Appointment';
import Records from './pages/Records';
import Emergency from './pages/Emergency';
import Assistant from './pages/Assistant';
import QuickBook from './pages/QuickBook';
import Profile from './pages/Profile';
import { Loading, StagingBanner } from './components/ui';

// Staff, doctor and video pages load only when opened, keeping the first load small on 2G.
const Console = lazy(() => import('./pages/Console'));
const Consult = lazy(() => import('./pages/Consult'));
const Doctor = lazy(() => import('./pages/Doctor'));
const Worker = lazy(() => import('./pages/Worker'));
const Admin = lazy(() => import('./pages/Admin'));

function RequireAuth({ children, staff = false, role = null, roles = null }) {
  const location = useLocation();
  const user = useSelector((s) => s.session.user);
  if (!hasChosenLanguage()) return <Navigate to="/welcome" replace />;
  if (!user) return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  if (staff && !STAFF_ROLES.includes(user.role)) return <Navigate to="/" replace />;
  if (role && user.role !== role) return <Navigate to="/" replace />;
  if (roles && !roles.includes(user.role)) return <Navigate to="/" replace />;
  return children;
}

export default function App() {
  // Retry any queued emergency alerts as soon as the connection is back.
  useEffect(() => watchNetwork(() => flushOutbox().then(() => flushHwQueue())), []);

  return (
    <Suspense fallback={<Loading />}>
    <StagingBanner />
    <Routes>
      <Route path="/welcome" element={<Language />} />
      <Route path="/login" element={<Login />} />
      {/* Emergency never requires sign-in. */}
      <Route path="/emergency" element={<Emergency />} />
      <Route
        path="/consult/:id"
        element={
          <RequireAuth>
            <Consult />
          </RequireAuth>
        }
      />
      <Route
        element={
          <RequireAuth>
            <Layout />
          </RequireAuth>
        }
      >
        <Route index element={<Home />} />
        <Route path="book" element={<Book />} />
        <Route path="quick-book" element={<QuickBook />} />
        <Route path="appointments/:id" element={<Appointment />} />
        <Route path="records" element={<Records />} />
        <Route path="assistant" element={<Assistant />} />
        <Route path="profile" element={<Profile />} />
        <Route
          path="worker"
          element={
            <RequireAuth role="health_worker">
              <Worker />
            </RequireAuth>
          }
        />
        <Route
          path="doctor"
          element={
            <RequireAuth role="doctor">
              <Doctor />
            </RequireAuth>
          }
        />
        <Route
          path="admin"
          element={
            <RequireAuth roles={ADMIN_ROLES}>
              <Admin />
            </RequireAuth>
          }
        />
        <Route
          path="console"
          element={
            <RequireAuth staff>
              <Console />
            </RequireAuth>
          }
        />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
    </Suspense>
  );
}
