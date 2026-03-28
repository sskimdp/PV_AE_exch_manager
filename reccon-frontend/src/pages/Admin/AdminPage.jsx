import { useEffect, useMemo, useRef, useState } from "react";
import { useOutletContext, useLocation, useNavigate } from "react-router-dom";
import "./AdminPage.css";

import { Button } from "../../components/Button/Button";
import { Chip } from "../../components/Chip/Chip";
import { SearchInput } from "../../components/SearchInput/SearchInput";
import { companiesApi } from "../../api/companiesApi";
import { usersApi } from "../../api/usersApi";
import { notificationsApi } from "../../api/notificationsApi";

const INTERVALS = ["30 мин.", "1 час", "2 часа", "6 часов", "12 часов", "24 часа"];

const intervalLabelToMinutes = (label) => {
  const map = {
    "30 мин.": 30,
    "1 час": 60,
    "2 часа": 120,
    "6 часов": 360,
    "12 часов": 720,
    "24 часа": 1440,
  };

  return map[label] || 30;
};

const buildReminderSnapshot = ({ enabled, intervalLabel, channels }) =>
  JSON.stringify({
    enabled: Boolean(enabled),
    intervalLabel: String(intervalLabel || "30 мин."),
    channels: {
      inside: Boolean(channels?.inside),
      email: Boolean(channels?.email),
    },
  });

const normalizeRole = (role, fallback = "Пользователь") => {
  const r = String(role || "").trim().toLowerCase();
  if (!r) return fallback;
  if (r === "admin" || r === "администратор") return "Администратор";
  if (r === "user" || r === "пользователь") return "Пользователь";
  return role;
};

const norm = (s) => String(s || "").trim().toLowerCase();
const collator = new Intl.Collator("ru", { sensitivity: "base" });
const getCompanyName = (u) => String(u.companyName || u.company || "").trim();

const roleRank = (role) => {
  const r = String(role || "").trim().toLowerCase();
  return r === "администратор" || r === "admin" ? 0 : 1;
};

const normalizeStatus = (status) => {
  const s = String(status || "").trim().toLowerCase();
  if (s === "активен" || s === "активна" || s === "active") return "активен";
  if (s === "неактивен" || s === "неактивна" || s === "inactive") return "неактивен";
  return "активен";
};

const statusChipClass = (status) =>
  `admin-statusChip ${status === "активен" ? "admin-statusChip--active" : "admin-statusChip--inactive"
  }`;

export default function AdminPage() {
  const { user } = useOutletContext();
  const isMaster = String(user?.companyType || "").trim().toLowerCase() === "master";
  const navigate = useNavigate();
  const location = useLocation();

  const [tab, setTab] = useState("users");
  const [query, setQuery] = useState("");
  const reminderCompanyName = user?.companyName || "";

  const [usersState, setUsersState] = useState([]);
  const [companiesState, setCompaniesState] = useState([]);
  const [remindersEnabled, setRemindersEnabled] = useState(true);
  const [intervalLabel, setIntervalLabel] = useState("30 мин.");
  const [channels, setChannels] = useState({ inside: true, email: false });

  const toggleChannel = async (key) => {
    if (!remindersEnabled) return;

    const nextChannels = {
      ...channels,
      [key]: !channels[key],
    };

    if (!nextChannels.inside && !nextChannels.email) return;

    setChannels(nextChannels);

    await saveReminderSettings({
      enabled: remindersEnabled,
      intervalLabel,
      channels: nextChannels,
    });
  };

  const isCompanies = isMaster && tab === "companies";

  const saveReminderSettings = async (nextState) => {
    const payload = {
      ...(reminderCompanyName ? { companyName: reminderCompanyName } : {}),
      enabled: nextState.enabled,
      intervalLabel: nextState.intervalLabel,
      intervalMinutes: intervalLabelToMinutes(nextState.intervalLabel),
      channels: nextState.channels,
    };

    try {
      const savedSettings = await notificationsApi.updateReminderSettings(payload);

      const normalizedSavedSettings = {
        companyName: savedSettings?.companyName || payload.companyName || "",
        enabled: Boolean(savedSettings?.enabled ?? nextState.enabled),
        intervalLabel: savedSettings?.intervalLabel || nextState.intervalLabel,
        intervalMinutes:
          savedSettings?.intervalMinutes ??
          intervalLabelToMinutes(savedSettings?.intervalLabel || nextState.intervalLabel),
        channels: {
          inside: Boolean(savedSettings?.channels?.inside ?? nextState.channels.inside),
          email: Boolean(savedSettings?.channels?.email ?? nextState.channels.email),
        },
      };

      setRemindersEnabled(normalizedSavedSettings.enabled);
      setIntervalLabel(normalizedSavedSettings.intervalLabel);
      setChannels(normalizedSavedSettings.channels);

      window.dispatchEvent(
        new CustomEvent("reccon:reminder-settings-updated", {
          detail: normalizedSavedSettings,
        })
      );
    } catch (error) {
      console.error("Не удалось сохранить настройки напоминаний", error);
    }
  };

  useEffect(() => {
    if (!isMaster && tab === "companies") setTab("users");
  }, [isMaster, tab]);

  useEffect(() => {
    let cancelled = false;

    const loadAdminData = async () => {
      try {
        const [users, companies] = await Promise.all([
          usersApi.listAdmin(),
          isMaster ? companiesApi.listAdmin() : Promise.resolve([]),
        ]);

        if (cancelled) return;
        setUsersState(Array.isArray(users) ? users : []);
        setCompaniesState(Array.isArray(companies) ? companies : []);
      } catch (error) {
        if (cancelled) return;
        console.error("Не удалось загрузить данные админки", error);
      }
    };

    loadAdminData();

    return () => {
      cancelled = true;
    };
  }, [isMaster, location.key]);

  useEffect(() => {
    if (!isMaster) return;

    let cancelled = false;

    const loadReminderSettings = async () => {
      try {
        const settings = await notificationsApi.getReminderSettings(
          reminderCompanyName ? { companyName: reminderCompanyName } : {}
        );

        if (cancelled || !settings) return;

        const nextSettings = {
          enabled: Boolean(settings.enabled),
          intervalLabel: settings.intervalLabel || "30 мин.",
          channels: {
            inside: Boolean(settings.channels?.inside ?? true),
            email: Boolean(settings.channels?.email ?? false),
          },
        };

        setRemindersEnabled(nextSettings.enabled);
        setIntervalLabel(nextSettings.intervalLabel);
        setChannels(nextSettings.channels);
      } catch (error) {
        if (cancelled) return;
        console.error("Не удалось загрузить настройки напоминаний", error);
      }
    };

    loadReminderSettings();

    return () => {
      cancelled = true;
    };
  }, [isMaster, reminderCompanyName]);

  const toggleUserStatus = async (userId) => {
    try {
      const updatedUser = await usersApi.toggleAdminStatus(userId);
      setUsersState((prev) =>
        prev.map((u) => (String(u.id) === String(userId) ? updatedUser : u))
      );
    } catch (error) {
      console.error("Не удалось изменить статус пользователя", error);
    }
  };

  const toggleCompanyStatus = async (companyId) => {
    try {
      const updatedCompany = await companiesApi.toggleAdminStatus(companyId);
      setCompaniesState((prev) =>
        prev.map((c) => (String(c.id) === String(companyId) ? updatedCompany : c))
      );
    } catch (error) {
      console.error("Не удалось изменить статус компании", error);
    }
  };

  const scopedUsers = useMemo(() => {
    if (isMaster) return usersState;

    const myCompany = norm(user?.companyName);
    return usersState.filter((u) => norm(u.companyName || u.company) === myCompany);
  }, [isMaster, usersState, user?.companyName]);

  const filteredUsers = useMemo(() => {
    const q = query.trim().toLowerCase();
    const src = scopedUsers;

    if (!q) return src;
    return src.filter((u) => {
      const login = (u.login || "").toLowerCase();
      const company = (u.companyName || u.company || "").toLowerCase();
      return login.includes(q) || company.includes(q);
    });
  }, [query, scopedUsers]);

  const filteredCompanies = useMemo(() => {
    const q = query.trim().toLowerCase();
    const src = companiesState;

    if (!q) return src;
    return src.filter((c) => {
      const name = (c.name || "").toLowerCase();
      const adminLogin = (c.adminLogin || "").toLowerCase();
      return name.includes(q) || adminLogin.includes(q);
    });
  }, [query, companiesState]);

  const adminIdByCompany = useMemo(() => {
    const map = new Map();
    companiesState.forEach((c) => {
      const key = norm(c.name);
      if (key) map.set(key, c.adminUserId ? String(c.adminUserId) : null);
    });
    return map;
  }, [companiesState]);

  const sortedUsers = useMemo(() => {
    return [...filteredUsers].sort((a, b) => {
      const byCompany = collator.compare(getCompanyName(a), getCompanyName(b));
      if (byCompany !== 0) return byCompany;

      const byRole = roleRank(a.role || a.roleKey) - roleRank(b.role || b.roleKey);
      if (byRole !== 0) return byRole;

      if (roleRank(a.role || a.roleKey) === 0 && roleRank(b.role || b.roleKey) === 0) {
        const companyKey = norm(getCompanyName(a));
        const mainAdminId = adminIdByCompany.get(companyKey);

        const aIsMain = mainAdminId && String(a.id) === String(mainAdminId);
        const bIsMain = mainAdminId && String(b.id) === String(mainAdminId);

        if (aIsMain !== bIsMain) return aIsMain ? -1 : 1;
      }

      return collator.compare(String(a.login || ""), String(b.login || ""));
    });
  }, [filteredUsers, adminIdByCompany]);

  const sortedCompanies = useMemo(() => {
    return [...filteredCompanies].sort((a, b) => {
      const byName = collator.compare(String(a.name || ""), String(b.name || ""));
      if (byName !== 0) return byName;

      return collator.compare(String(a.adminLogin || ""), String(b.adminLogin || ""));
    });
  }, [filteredCompanies]);

  const headerCols = isCompanies
    ? ["Название", "Администратор", "Пользователей", "Статус", ""]
    : ["Компания", "Логин", "Роль", "Статус", ""];

  const getUsersCountForCompany = (companyName) => {
    if (!companyName) return 0;
    return usersState.filter(
      (u) => (u.companyName || u.company || "").trim() === String(companyName).trim()
    ).length;
  };

  return (
    <div className="admin">
      <div className="admin-tabs">
        <Button
          className={`admin-tab ${tab === "users" ? "is-active" : ""}`}
          onClick={() => setTab("users")}
        >
          Пользователи
        </Button>

        {isMaster && (
          <Button
            className={`admin-tab ${tab === "companies" ? "is-active" : ""}`}
            onClick={() => setTab("companies")}
          >
            Компании
          </Button>
        )}
      </div>

      <div className="admin-panel">
        <div className="admin-panel__top">
          <Button
            className="admin-addBtn"
            onClick={() => {
              if (isCompanies) navigate("/admin/companies/new");
              else navigate("/admin/users/new");
            }}
          >
            {isCompanies ? "+ Добавить компанию" : "+ Добавить пользователя"}
          </Button>
        </div>

        <div className="admin-panel__search">
          <SearchInput value={query} onChange={setQuery} />
        </div>

        <div className="admin-table">
          <div className="admin-row admin-row--head">
            <div className="admin-col admin-col--company">{headerCols[0]}</div>
            <div className="admin-col admin-col--login">{headerCols[1]}</div>
            <div className="admin-col admin-col--role">{headerCols[2]}</div>
            <div className="admin-col admin-col--status">{headerCols[3]}</div>
            <div className="admin-col admin-col--action" />
          </div>

          <div className="admin-body">
            {!isCompanies
              ? sortedUsers.map((u) => (
                <div className="admin-row" key={u.id}>
                  <div className="admin-col admin-col--company admin-text">
                    {u.companyName || u.company || "—"}
                  </div>

                  <div className="admin-col admin-col--login admin-login">{u.login}</div>

                  <div className="admin-col admin-col--role admin-role">
                    {normalizeRole(u.role || u.roleKey)}
                  </div>

                  <div className="admin-col admin-col--status admin-center">
                    <button
                      type="button"
                      onClick={() => toggleUserStatus(u.id)}
                      style={{
                        background: "transparent",
                        border: 0,
                        padding: 0,
                        cursor: "pointer",
                      }}
                      title="Переключить статус"
                    >
                      {(() => {
                        const st = normalizeStatus(u.status);
                        return <Chip className={statusChipClass(st)}>{st}</Chip>;
                      })()}
                    </button>
                  </div>

                  <div className="admin-col admin-col--action admin-action">
                    <Button
                      type="button"
                      className="admin-editBtn"
                      onClick={() =>
                        navigate(`/admin/users/new?userId=${encodeURIComponent(u.id)}`)
                      }
                    >
                      Изменить
                    </Button>
                  </div>
                </div>
              ))
              : sortedCompanies.map((c) => (
                <div className="admin-row" key={c.id}>
                  <div className="admin-col admin-col--company admin-login">{c.name}</div>

                  <div className="admin-col admin-col--login admin-text">
                    {c.adminLogin || "—"}
                  </div>

                  <div className="admin-col admin-col--role admin-usersCount">
                    <span className="admin-usersIcon" aria-hidden="true">
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
                        <path
                          d="M12 12a4 4 0 1 0-4-4 4 4 0 0 0 4 4Z"
                          stroke="currentColor"
                          strokeWidth="2"
                        />
                        <path
                          d="M4 20c0-4 4-6 8-6s8 2 8 6"
                          stroke="currentColor"
                          strokeWidth="2"
                          strokeLinecap="round"
                        />
                      </svg>
                    </span>
                    <span className="admin-usersNum">
                      {typeof c.usersCount === "number"
                        ? c.usersCount
                        : getUsersCountForCompany(c.name)}
                    </span>
                  </div>

                  <div className="admin-col admin-col--status admin-center">
                    <button
                      type="button"
                      onClick={() => toggleCompanyStatus(c.id)}
                      style={{
                        background: "transparent",
                        border: 0,
                        padding: 0,
                        cursor: "pointer",
                      }}
                      title="Переключить статус"
                    >
                      <Chip className={statusChipClass(c.status)}>{c.status}</Chip>
                    </button>
                  </div>

                  <div className="admin-col admin-col--action admin-action">
                    <Button
                      type="button"
                      className="admin-editBtn"
                      onClick={() =>
                        navigate(`/admin/companies/new?companyId=${encodeURIComponent(c.id)}`)
                      }
                    >
                      Изменить
                    </Button>
                  </div>
                </div>
              ))}
          </div>
        </div>
      </div>

      {isMaster && !isCompanies && (
        <div className="admin-reminders">
          <div className="admin-reminders__title">Напоминания</div>

          <div className="admin-switchRow">
            <button
              type="button"
              className={`admin-radio ${remindersEnabled ? "is-on" : ""}`}
              onClick={async () => {
                const nextEnabled = !remindersEnabled;
                setRemindersEnabled(nextEnabled);

                await saveReminderSettings({
                  enabled: nextEnabled,
                  intervalLabel,
                  channels,
                });
              }}
            >
              <span className="admin-radio__dot" />
            </button>
            <span className="admin-reminders__label">Включить уведомления</span>
          </div>

          <div className="admin-reminders__row">
            <div className="admin-reminders__text">Интервал:</div>

            <div className="admin-intervals">
              {INTERVALS.map((item) => (
                <button
                  key={item}
                  type="button"
                  className="admin-chipBtn"
                  disabled={!remindersEnabled}
                  onClick={async () => {
                    setIntervalLabel(item);

                    await saveReminderSettings({
                      enabled: remindersEnabled,
                      intervalLabel: item,
                      channels,
                    });
                  }}
                >
                  <Chip
                    className={`admin-intervalChip ${intervalLabel === item ? "is-selected" : ""
                      } ${!remindersEnabled ? "is-disabled" : ""}`}
                  >
                    {item}
                  </Chip>
                </button>
              ))}
            </div>
          </div>

          <div className="admin-channels">
            <button
              type="button"
              className="admin-channelRow"
              disabled={!remindersEnabled}
              onClick={() => toggleChannel("inside")}
            >
              <span
                className={`admin-radio ${remindersEnabled && channels.inside ? "is-on" : ""
                  } ${!remindersEnabled ? "is-disabled" : ""}`}
              >
                <span className="admin-radio__dot" />
              </span>

              <span className={`admin-channelText ${!remindersEnabled ? "is-muted" : ""}`}>
                Напоминания в системе
              </span>
            </button>

            <button
              type="button"
              className="admin-channelRow"
              disabled={!remindersEnabled}
              onClick={() => toggleChannel("email")}
            >
              <span
                className={`admin-radio ${remindersEnabled && channels.email ? "is-on" : ""
                  } ${!remindersEnabled ? "is-disabled" : ""}`}
              >
                <span className="admin-radio__dot" />
              </span>

              <span className={`admin-channelText ${!remindersEnabled ? "is-muted" : ""}`}>
                Отправлять напоминания на email
              </span>
            </button>
          </div>

          <div className="admin-reminders__hint">
            Отправлять напоминания пользователю, если у него есть неподтверждённые сообщения
          </div>
        </div>
      )}
    </div>
  );
}