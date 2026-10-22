import { createContext, useContext, useState } from "react";
import { getMe } from "../../api/authentication.js";

const ProfileOverlayContext = createContext();

/** `user` is the signed-in user App already has (from login or /me). */
export function ProfileOverlayProvider({ user, children }) {
  const [currentUser, setCurrentUser] = useState(user);
  const [profile, setProfile] = useState(null);
  const [loadingProfile, setLoadingProfile] = useState(false);
  const [previewUser, setPreviewUser] = useState(null);
  const [profileNavigation, setProfileNavigation] = useState({ tab: "friends", id: 0 });

  async function fetchCurrentUser() {
    const user = await getMe();
    setCurrentUser(user);
    return user;
  }

  async function refreshProfile() {
    setLoadingProfile(true);

    try {
      const user = await fetchCurrentUser();
      setProfile(user);
      return user;
    } finally {
      setLoadingProfile(false);
    }
  }

  async function openProfile({ tab = "friends" } = {}) {
    await refreshProfile();
    setProfileNavigation((previous) => ({ tab, id: previous.id + 1 }));
  }

  function closeProfile() {
    setProfile(null);
  }

  function openUserPreview({ id, username }, anchorRect) {
    setPreviewUser({ id, username, anchorRect });
  }

  function closeUserPreview() {
    setPreviewUser(null);
  }

  return (
    <ProfileOverlayContext.Provider
      value={{
        currentUser,
        profile,
        profileNavigation,
        loadingProfile,
        openProfile,
        closeProfile,
        refreshProfile,
        previewUser,
        openUserPreview,
        closeUserPreview,
      }}
    >
      {children}
    </ProfileOverlayContext.Provider>
  );
}

export function useProfileOverlay() {
  return useContext(ProfileOverlayContext);
}
