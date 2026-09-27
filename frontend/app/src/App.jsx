import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { useEffect, useState } from "react";
import AppShell from "./components/layout/AppShell.jsx";
import AuthPage from "./components/layout/AuthPage.jsx";
import Landing from "./components/landing/Landing.jsx";
import Privacy from "./components/legal/Privacy.jsx";
import Terms from "./components/legal/Terms.jsx";
import { getMe, hasSession, logoutUser, LOGOUT_EVENT } from "./api/authentication.js";

function App() {
  // The signed-in user, from login/register or /me on boot. null = signed out.
  const [user, setUser] = useState(null);
  const [checking, setChecking] = useState(hasSession);

  // Fired by the api layer when a refresh is rejected — the session is gone.
  useEffect(() => {
    const handleLogout = () => setUser(null);
    window.addEventListener(LOGOUT_EVENT, handleLogout);
    return () => window.removeEventListener(LOGOUT_EVENT, handleLogout);
  }, []);

  useEffect(() => {
    if (!hasSession()) return undefined;

    let active = true;

    getMe()
      .then((me) => {
        if (active) setUser(me);
      })
      // A rejected /me just means no session to restore: `checking` clears in
      // finally and the routes below send the user to /auth.
      .catch(() => {})
      .finally(() => {
        if (active) setChecking(false);
      });

    return () => {
      active = false;
    };
  }, []);

  const logOut = async () => {
    try {
      await logoutUser();
    } catch {
      // The local session is dropped either way: a failed server-side logout
      // still signs the user out of this tab.
    } finally {
      setUser(null);
    }
  };

  const isAuth = Boolean(user);

  // While the session is being restored we know tokens were present, so the
  // landing page can show the signed-in call to action straight away instead
  // of waiting on /me. The authenticated routes still wait for the real answer.
  const hasLikelySession = isAuth || checking;

  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Landing isAuth={hasLikelySession} />} />

        {/* Public either way: readable before signing up and after signing in. */}
        <Route path="/privacy" element={<Privacy />} />
        <Route path="/terms" element={<Terms />} />

        <Route
          path="/auth"
          element={
            checking
              ? null
              : isAuth
                ? <Navigate to="/app" replace />
                : <AuthPage onLogin={setUser} />
          }
        />

        <Route
          path="/app/*"
          element={
            checking
              ? null
              : isAuth
                ? <AppShell user={user} onLogout={logOut} />
                : <Navigate to="/auth" replace />
          }
        />

        <Route
          path="*"
          element={<Navigate to={hasLikelySession ? "/app" : "/"} replace />}
        />
      </Routes>
    </BrowserRouter>
  );
}

export default App;
