import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { useEffect, useState } from "react";
import AppShell from "./components/layout/AppShell.jsx";
import AuthPage from "./components/layout/AuthPage.jsx";
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
      .catch((error) => {
        console.error("Failed to restore session:", error);
      })
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
    } catch (error) {
      console.error("Failed to log out cleanly:", error);
    } finally {
      setUser(null);
    }
  };

  if (checking) {
    return null;
  }

  const isAuth = Boolean(user);

  return (
    <BrowserRouter>
      <Routes>
        <Route
          path="/auth"
          element={
            isAuth
              ? <Navigate to="/app" replace />
              : <AuthPage onLogin={setUser} />
          }
        />

        <Route
          path="/app/*"
          element={
            isAuth
              ? <AppShell user={user} onLogout={logOut} />
              : <Navigate to="/auth" replace />
          }
        />

        <Route
          path="*"
          element={<Navigate to={isAuth ? "/app" : "/auth"} replace />}
        />
      </Routes>
    </BrowserRouter>
  );
}

export default App;
