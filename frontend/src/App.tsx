import { useEffect } from "react";
import { Routes, Route, Navigate, useLocation } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { useAuthStore } from "./lib/store";
import { getUser } from "./api/client";
import { LoginPage } from "./pages/Login";
import { DashboardPage } from "./pages/Dashboard";
import { CapturePage } from "./pages/Capture";
import { AdminPage } from "./pages/Admin";

export function App() {
  const { t } = useTranslation();
  const { user, loading, setUser, setLoading } = useAuthStore();
  const location = useLocation();

  // One-shot session probe on mount. While loading, render a neutral state
  // instead of redirecting to /login — otherwise an authenticated reload of
  // a deep link (/captures/<id>) bounces to /login before the cookie probe
  // resolves.
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    getUser()
      .then((u) => {
        if (!cancelled) setUser(u);
      })
      .catch(() => {
        if (!cancelled) {
          setUser(null);
          setLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center bg-panel-bg">
        <div className="text-sm text-panel-muted">{t("common.loading")}</div>
      </div>
    );
  }

  return (
    <Routes location={location}>
      <Route
        path="/login"
        element={user ? <Navigate to="/" replace /> : <LoginPage />}
      />
      <Route
        path="/"
        element={
          user ? (
            <DashboardPage />
          ) : (
            <Navigate to="/login" replace state={{ from: location }} />
          )
        }
      />
      <Route
        path="/captures/:id"
        element={
          user ? (
            <CapturePage />
          ) : (
            <Navigate to="/login" replace state={{ from: location }} />
          )
        }
      />
      <Route
        path="/admin"
        element={
          user?.role === "super_admin" ? (
            <AdminPage />
          ) : user ? (
            <Navigate to="/" replace />
          ) : (
            <Navigate to="/login" replace state={{ from: location }} />
          )
        }
      />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
