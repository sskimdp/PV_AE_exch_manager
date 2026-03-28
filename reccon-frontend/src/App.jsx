import { useEffect, useMemo, useRef, useState } from "react";
import {
  Routes,
  Route,
  Navigate,
  Outlet,
  useLocation,
  useNavigate,
} from "react-router-dom";
import { storage } from "./utils/storage";
import { authApi } from "./api/authApi";
import { tokenStorage } from "./api/tokenStorage";
import { notificationsApi } from "./api/notificationsApi";
import { messagesApi } from "./api/messagesApi";

import AuthPage from "./pages/Auth/AuthPage";
import Sidebar from "./components/Sidebar/Sidebar";
import DashboardPage from "./pages/Dashboard/DashboardPage";
import AdminPage from "./pages/Admin/AdminPage";
import CreateCompanyPage from "./pages/Admin/CreateCompanyPage/CreateCompanyPage";
import CreateUserPage from "./pages/Admin/CreateUserPage/CreateUserPage";
import InboxPage from "./pages/Inbox/InboxPage";
import SentPage from "./pages/Sent/SentPage";
import DraftsPage from "./pages/Drafts/DraftsPage";
import NewMessagePage from "./pages/NewMessage/NewMessagePage";
import ReconciliationPage from "./pages/Reconciliation/ReconciliationPage";
import ReconciliationDetailsPage from "./pages/Reconciliation/ReconciliationDetailsPage/ReconciliationDetailsPage";

const SEED_USERS = [
  {
    id: "seed-master",
    login: "kim_sofiya_1804",
    password: "helloword",
    companyType: "master",
    companyName: "Master Компания",
    role: "Администратор",
  },
];

const norm = (s) => String(s || "").trim().toLowerCase();

const isActiveStatus = (status) => {
  const s = norm(status);
  if (!s) return true;
  return s === "активен" || s === "активна" || s === "active";
};

const roleToIsAdmin = (role) => {
  const r = norm(role);
  return r === "администратор" || r === "admin";
};

const resolveAvatarUrl = (userData = {}, fallback = "") => {
  return (
    userData?.avatarUrl ??
    userData?.avatarDataUrl ??
    userData?.avatar_data_url ??
    userData?.avatar ??
    fallback ??
    ""
  );
};

const resolveAvatarDataUrl = (userData = {}, fallback = "") => {
  return (
    userData?.avatarDataUrl ??
    userData?.avatar_data_url ??
    userData?.avatarUrl ??
    userData?.avatar ??
    fallback ??
    ""
  );
};

const getInitialUser = () => {
  const storedUser = storage.getCurrentUser();
  if (!storedUser) return null;

  return {
    ...storedUser,
    avatarUrl: resolveAvatarUrl(storedUser),
    avatarDataUrl: resolveAvatarDataUrl(storedUser),
  };
};

const resolveActiveKey = (pathname) => {
  if (pathname === "/") return "home";
  if (pathname.startsWith("/inbox")) return "inbox";
  if (pathname.startsWith("/sent")) return "sent";
  if (pathname.startsWith("/drafts")) return "drafts";
  if (pathname.startsWith("/reconciliation")) return "reconciliation";
  if (pathname.startsWith("/admin")) return "admin";
  if (pathname.startsWith("/messages/new")) return "sent";
  return "home";
};

const getCompanyTypeByName = (companyName) => {
  const companies = storage.getCompanies();
  const c = companies.find((x) => norm(x.name) === norm(companyName));
  return c?.companyType || "slave";
};

const getSafeReminderSettings = (companyName) => {
  if (typeof storage.getReminderSettings === "function") {
    const storedSettings = storage.getReminderSettings(companyName);
    if (storedSettings) {
      return {
        enabled: Boolean(storedSettings.enabled ?? true),
        intervalLabel: storedSettings.intervalLabel || "30 мин.",
        intervalMinutes: storedSettings.intervalMinutes || 30,
        channels: {
          inside: Boolean(storedSettings.channels?.inside ?? true),
          email: Boolean(storedSettings.channels?.email ?? false),
        },
      };
    }
  }

  return {
    enabled: true,
    intervalLabel: "30 мин.",
    intervalMinutes: 30,
    channels: {
      inside: true,
      email: false,
    },
  };
};

const EMPTY_COUNTS = {
  inbox: 0,
  sent: 0,
  drafts: 0,
  inboxCount: 0,
  sentCount: 0,
  draftsCount: 0,
  inboxUnconfirmed: 0,
  sentUnconfirmed: 0,
};

function ProtectedRoute({ user }) {
  if (!user) return <Navigate to="/auth" replace />;
  return <Outlet />;
}

function AppLayout({ user, onLogout, onAvatarChange, onCurrentUserUpdated }) {
  const navigate = useNavigate();
  const location = useLocation();

  const [counts, setCounts] = useState(EMPTY_COUNTS);
  const isMaster = norm(user?.companyType) === "master";
  const [activeReminder, setActiveReminder] = useState(null);

  const [reminderSettings, setReminderSettings] = useState(() =>
    isMaster ? getSafeReminderSettings(user?.companyName) : null
  );

  const shownReminderIdsRef = useRef(new Set());

  useEffect(() => {
    let cancelled = false;

    const loadCounts = async () => {
      try {
        const nextCounts = await messagesApi.getCounts();
        if (cancelled) return;

        setCounts({
          inbox: Number(nextCounts?.inbox ?? nextCounts?.inboxCount ?? 0),
          sent: Number(nextCounts?.sent ?? nextCounts?.sentCount ?? 0),
          drafts: Number(nextCounts?.drafts ?? nextCounts?.draftsCount ?? 0),
          inboxCount: Number(nextCounts?.inboxCount ?? nextCounts?.inbox ?? 0),
          sentCount: Number(nextCounts?.sentCount ?? nextCounts?.sent ?? 0),
          draftsCount: Number(nextCounts?.draftsCount ?? nextCounts?.drafts ?? 0),
          inboxUnconfirmed: Number(nextCounts?.inboxUnconfirmed ?? 0),
          sentUnconfirmed: Number(nextCounts?.sentUnconfirmed ?? 0),
        });
      } catch (error) {
        if (cancelled) return;
        console.error("Не удалось загрузить счетчики сообщений", error);
        setCounts(EMPTY_COUNTS);
      }
    };

    loadCounts();

    const handleMessagesChanged = () => {
      loadCounts();
    };

    window.addEventListener(messagesApi.events.MESSAGE_CHANGED_EVENT, handleMessagesChanged);
    return () => {
      cancelled = true;
      window.removeEventListener(
        messagesApi.events.MESSAGE_CHANGED_EVENT,
        handleMessagesChanged
      );
    };
  }, [user?.id, user?.companyName, user?.companyType]);

  const activeKey = useMemo(() => {
    return resolveActiveKey(location.pathname);
  }, [location.pathname]);

  useEffect(() => {
    if (!isMaster) {
      setReminderSettings(null);
      return;
    }

    let cancelled = false;

    const loadReminderSettings = async () => {
      try {
        const settings = await notificationsApi.getReminderSettings(
          user?.companyName ? { companyName: user.companyName } : {}
        );

        if (cancelled) return;
        setReminderSettings(settings || getSafeReminderSettings(user?.companyName));
      } catch (error) {
        if (cancelled) return;
        console.error("Не удалось загрузить настройки напоминаний", error);
        setReminderSettings(getSafeReminderSettings(user?.companyName));
      }
    };

    loadReminderSettings();

    return () => {
      cancelled = true;
    };
  }, [isMaster, user?.companyName]);

  useEffect(() => {
    if (!isMaster) return;

    const handleReminderSettingsUpdated = (event) => {
      const nextSettings = event?.detail;
      if (!nextSettings) return;

      const incomingCompanyName = String(nextSettings.companyName || "").trim();
      const currentCompanyName = String(user?.companyName || "").trim();

      if (incomingCompanyName && currentCompanyName && incomingCompanyName !== currentCompanyName) {
        return;
      }

      setReminderSettings((prev) => ({
        ...(prev || {}),
        ...nextSettings,
        channels: {
          inside: Boolean(nextSettings.channels?.inside ?? prev?.channels?.inside ?? true),
          email: Boolean(nextSettings.channels?.email ?? prev?.channels?.email ?? false),
        },
      }));
    };

    window.addEventListener("reccon:reminder-settings-updated", handleReminderSettingsUpdated);
    return () => {
      window.removeEventListener(
        "reccon:reminder-settings-updated",
        handleReminderSettingsUpdated
      );
    };
  }, [isMaster, user?.companyName]);

  const extractReminderCount = (notification) => {
    const payloadCount = Number(
      notification?.payload?.count ??
      notification?.payload?.unconfirmed_count ??
      notification?.payload?.unread_count
    );

    if (Number.isFinite(payloadCount) && payloadCount > 0) {
      return payloadCount;
    }

    const messageText = String(notification?.message || "");
    const matchedCount = messageText.match(/(\d+)/);
    return matchedCount ? Number(matchedCount[1]) : 0;
  };

  const showReminderNotification = async (notification) => {
    const notificationId = notification?.id;
    if (!notificationId) return;

    const nextReminder = {
      id: `system-reminder-${notificationId}`,
      notificationId,
      count: extractReminderCount(notification),
      createdAt:
        notification?.created_at ||
        notification?.createdAt ||
        new Date().toISOString(),
    };

    setActiveReminder((prev) =>
      prev?.notificationId === notificationId ? prev : nextReminder
    );

    const reminderKey = String(notificationId);
    if (shownReminderIdsRef.current.has(reminderKey)) {
      return;
    }

    shownReminderIdsRef.current.add(reminderKey);

    try {
      await notificationsApi.markRead(notificationId);
    } catch (error) {
      console.error("Не удалось отметить напоминание прочитанным", error);
      shownReminderIdsRef.current.delete(reminderKey);
    }
  };

  const handleCloseReminder = () => {
    setActiveReminder(null);
  };

  useEffect(() => {
    if (!isMaster) return;

    const canShowInsideReminder =
      reminderSettings?.enabled && reminderSettings?.channels?.inside;

    if (!canShowInsideReminder) {
      setActiveReminder(null);
      return;
    }

    let cancelled = false;

    const syncReminderFromBackend = async () => {
      try {
        const notifications = await notificationsApi.list();

        if (cancelled) return;

        const latestUnreadReminder = notifications.find((item) => {
          const type = String(item?.notif_type ?? item?.notifType ?? "")
            .trim()
            .toLowerCase();
          const isRead = Boolean(item?.is_read ?? item?.isRead);
          return type === "reminder" && !isRead;
        });

        if (!latestUnreadReminder) {
          setActiveReminder(null);
          return;
        }

        await showReminderNotification(latestUnreadReminder);
      } catch (error) {
        if (cancelled) return;
        console.error("Не удалось синхронизировать напоминания", error);
      }
    };

    syncReminderFromBackend();

    const intervalId = window.setInterval(syncReminderFromBackend, 30000);
    const handleWindowFocus = () => {
      syncReminderFromBackend();
    };

    window.addEventListener("focus", handleWindowFocus);

    return () => {
      cancelled = true;
      window.clearInterval(intervalId);
      window.removeEventListener("focus", handleWindowFocus);
    };
  }, [isMaster, reminderSettings?.enabled, reminderSettings?.channels?.inside, user?.id]);

  const handleNavigate = (key) => {
    const map = {
      home: "/",
      inbox: "/inbox",
      sent: "/sent",
      drafts: "/drafts",
      reconciliation: "/reconciliation",
      admin: "/admin",
    };

    const to = map[key];
    if (to) navigate(to);
  };

  return (
    <div style={{ display: "flex" }}>
      {isMaster && activeReminder && (
        <div
          key={activeReminder.id}
          className="dashboard-reminder is-visible"
          style={{
            position: "fixed",
            top: 24,
            right: 24,
            zIndex: 3000,
            width: 360,
            maxWidth: "calc(100vw - 48px)",
            animation: "reminderSlideIn 0.35s ease-out",
          }}
        >
          <div className="dashboard-reminder__head">
            <div className="dashboard-reminder__title">Напоминание!</div>
            <button
              type="button"
              className="dashboard-reminder__close"
              onClick={handleCloseReminder}
              aria-label="Закрыть"
            >
              ×
            </button>
          </div>

          <div className="dashboard-reminder__text">
            У вас {activeReminder.count} неподтвержденных писем.
          </div>
        </div>
      )}

      <Sidebar
        userId={user.id}
        companyType={user.companyType}
        companyName={user.companyName}
        login={user.login}
        isAdmin={user.isAdmin}
        counts={counts}
        activeKey={activeKey}
        onNavigate={handleNavigate}
        onCreateMessage={() => navigate("/messages/new")}
        onLogout={onLogout}
        onAvatarChange={onAvatarChange}
        avatarUrl={resolveAvatarUrl(user)}
      />

      <div style={{ flex: 1, minWidth: 0, height: "100vh", overflow: "hidden" }}>
        <div style={{ height: "100%", overflow: "auto", padding: 24 }}>
          <Outlet
            context={{
              user,
              counts,
              onCurrentUserUpdated,
            }}
          />
        </div>
      </div>
    </div>
  );
}

export default function App() {
  const [user, setUser] = useState(getInitialUser);
  const [isBootstrappingAuth, setIsBootstrappingAuth] = useState(true);

  useEffect(() => {
    let isMounted = true;

    const bootstrapAuth = async () => {
      if (!tokenStorage.getAccessToken()) {
        if (isMounted) {
          setIsBootstrappingAuth(false);
        }
        return;
      }

      try {
        const { appUser } = await authApi.me();

        if (!isMounted) return;

        const storedUser = storage.getCurrentUser() || {};
        const nextUser = {
          ...storedUser,
          ...appUser,
          avatarUrl: resolveAvatarUrl(appUser, resolveAvatarUrl(storedUser)),
          avatarDataUrl: resolveAvatarDataUrl(appUser, resolveAvatarDataUrl(storedUser)),
        };

        setUser(nextUser);
        storage.setCurrentUser(nextUser);
      } catch {
        authApi.clearSession();
        if (isMounted) {
          setUser(null);
          storage.setCurrentUser(null);
        }
      } finally {
        if (isMounted) {
          setIsBootstrappingAuth(false);
        }
      }
    };

    bootstrapAuth();

    return () => {
      isMounted = false;
    };
  }, []);

  const handleLogin = async (login, password) => {
    const { appUser } = await authApi.login({
      username: login,
      password,
    });

    const storedUser = storage.getCurrentUser() || {};
    const safeUser = {
      ...storedUser,
      ...appUser,
      avatarUrl: resolveAvatarUrl(appUser, resolveAvatarUrl(storedUser)),
      avatarDataUrl: resolveAvatarDataUrl(appUser, resolveAvatarDataUrl(storedUser)),
    };

    setUser(safeUser);
    storage.setCurrentUser(safeUser);
    return safeUser;
  };

  const handleAvatarChange = async (newAvatarDataUrl) => {
    const { appUser } = await authApi.updateMe({
      avatarDataUrl: newAvatarDataUrl || null,
    });

    setUser((prev) => {
      if (!prev) return prev;

      const next = {
        ...prev,
        ...appUser,
        avatarUrl: resolveAvatarUrl(appUser, resolveAvatarUrl(prev)),
        avatarDataUrl: resolveAvatarDataUrl(appUser, resolveAvatarDataUrl(prev)),
      };

      storage.setCurrentUser(next);
      return next;
    });

    return appUser;
  };

  const handleCurrentUserUpdated = (nextUserData) => {
    setUser((prev) => {
      if (!prev) return prev;

      const next = {
        ...prev,
        ...nextUserData,
        avatarUrl: resolveAvatarUrl(nextUserData, resolveAvatarUrl(prev)),
        avatarDataUrl: resolveAvatarDataUrl(nextUserData, resolveAvatarDataUrl(prev)),
      };

      storage.setCurrentUser(next);
      return next;
    });
  };

  if (isBootstrappingAuth) {
    return (
      <div
        style={{
          minHeight: "100vh",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontSize: 18,
        }}
      >
        Загрузка...
      </div>
    );
  }

  return (
    <Routes>
      <Route path="/auth" element={<AuthPage onLogin={handleLogin} />} />

      <Route element={<ProtectedRoute user={user} />}>
        <Route
          element={
            <AppLayout
              user={user}
              onAvatarChange={handleAvatarChange}
              onCurrentUserUpdated={handleCurrentUserUpdated}
              onLogout={async () => {
                try {
                  await authApi.logout();
                } catch {
                  authApi.clearSession();
                }

                setUser(null);
                storage.setCurrentUser(null);
                window.location.href = "/auth";
              }}
            />
          }
        >
          <Route index element={<DashboardPage />} />
          <Route path="inbox" element={<InboxPage />} />
          <Route path="sent" element={<SentPage />} />
          <Route path="drafts" element={<DraftsPage />} />
          <Route path="reconciliation" element={<ReconciliationPage />} />
          <Route
            path="reconciliation/:id"
            element={<ReconciliationDetailsPage />}
          />
          <Route path="admin" element={<AdminPage />} />
          <Route path="messages/new" element={<NewMessagePage />} />
          <Route path="admin/companies/new" element={<CreateCompanyPage />} />
          <Route path="admin/users/new" element={<CreateUserPage />} />
        </Route>
      </Route>

      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}