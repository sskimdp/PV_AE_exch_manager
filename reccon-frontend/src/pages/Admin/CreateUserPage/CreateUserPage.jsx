import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useLocation, useOutletContext } from "react-router-dom";
import { Input } from "../../../components/Input/Input";
import { Button } from "../../../components/Button/Button";
import "./CreateUserPage.css";
import { companiesApi } from "../../../api/companiesApi";
import { usersApi } from "../../../api/usersApi";

const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const loginRegex = /^[A-Za-z0-9._-]{3,}$/;
const PASSWORD_PLACEHOLDER = "********";

const MAX_AVATAR_MB = 5;
const MAX_AVATAR_BYTES = MAX_AVATAR_MB * 1024 * 1024;
const AVATAR_ACCEPT = "image/png,image/jpeg,image/webp";

function normalize(s) {
  return (s || "").trim().toLowerCase();
}
const collator = new Intl.Collator("ru", { sensitivity: "base" });

function shortFileName(name, maxBase = 14) {
  if (!name) return "";
  const dot = name.lastIndexOf(".");
  if (dot <= 0) return name.length > maxBase ? name.slice(0, maxBase) + "…" : name;

  const base = name.slice(0, dot);
  const ext = name.slice(dot);
  if (base.length <= maxBase) return base + ext;
  return base.slice(0, maxBase) + "…" + ext;
}

const toDataUrl = (file) =>
  new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = reject;
    r.readAsDataURL(file);
  });

export default function CreateUserPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const { user: currentUser, onCurrentUserUpdated } = useOutletContext() || {};
  const isSlaveAdmin = currentUser?.companyType === "slave" && currentUser?.isAdmin;

  const editingIdFromState = location.state?.userId ?? null;
  const editingIdFromQuery = new URLSearchParams(location.search).get("userId");
  const editingId = editingIdFromState ?? editingIdFromQuery;

  const [existing, setExisting] = useState(null);
  const [companies, setCompanies] = useState([]);
  const [usersAll, setUsersAll] = useState([]);

  const [company, setCompany] = useState("");
  const [login, setLogin] = useState("");
  const [pass, setPass] = useState("");
  const [pass2, setPass2] = useState("");
  const [role, setRole] = useState("");
  const [email, setEmail] = useState("");
  const [isPreviewOpen, setIsPreviewOpen] = useState(false);

  const [submitted, setSubmitted] = useState(false);

  const fileInputRef = useRef(null);
  const companyWrapRef = useRef(null);

  const [companyOpen, setCompanyOpen] = useState(false);
  const [companySearch, setCompanySearch] = useState("");
  const [avatarFile, setAvatarFile] = useState(null);
  const [avatarUrl, setAvatarUrl] = useState("");
  const [avatarError, setAvatarError] = useState("");
  const [isAvatarTouched, setIsAvatarTouched] = useState(false);

  useEffect(() => {
    let cancelled = false;

    const loadLookups = async () => {
      try {
        const [companiesList, usersList] = await Promise.all([
          companiesApi.listAdmin(),
          usersApi.listAdmin(),
        ]);

        if (cancelled) return;
        setCompanies(Array.isArray(companiesList) ? companiesList : []);
        setUsersAll(Array.isArray(usersList) ? usersList : []);
      } catch (error) {
        if (cancelled) return;
        console.error("Не удалось загрузить списки для формы пользователя", error);
      }
    };

    loadLookups();

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;

    const loadUser = async () => {
      if (!editingId) {
        setExisting(null);
        return;
      }

      try {
        const user = await usersApi.getAdminById(editingId);
        if (cancelled) return;
        setExisting(user || null);
      } catch (error) {
        if (cancelled) return;
        console.error("Не удалось загрузить пользователя", error);
      }
    };

    loadUser();

    return () => {
      cancelled = true;
    };
  }, [editingId]);

  useEffect(() => {
    if (!existing) return;

    setCompany(existing.companyName || existing.company || "");
    setLogin(existing.login || existing.username || "");
    setPass(existing.password || PASSWORD_PLACEHOLDER);
    setPass2(existing.password || PASSWORD_PLACEHOLDER);

    const r = String(existing.roleKey || existing.role || "").toLowerCase();
    setRole(
      r === "администратор" || r === "admin"
        ? "admin"
        : r === "пользователь" || r === "user"
        ? "user"
        : ""
    );

    setEmail(existing.email || "");
    setAvatarUrl(existing.avatarDataUrl || "");
    setAvatarFile(null);
    setAvatarError("");
    setIsAvatarTouched(false);

    if (fileInputRef.current) fileInputRef.current.value = "";
  }, [existing]);

  useEffect(() => {
    if (!isSlaveAdmin) return;
    setCompany(currentUser?.companyName || "");
  }, [isSlaveAdmin, currentUser?.companyName]);

  useEffect(() => {
    const onDown = (e) => {
      if (!companyWrapRef.current) return;
      if (!companyWrapRef.current.contains(e.target)) {
        setCompanyOpen(false);
      }
    };

    window.addEventListener("mousedown", onDown);
    return () => window.removeEventListener("mousedown", onDown);
  }, []);

  const onEdit = (setter) => (e) => {
    if (submitted) setSubmitted(false);
    setter(e.target.value);
  };

  const companyOptions = useMemo(() => {
    const names = companies.map((c) => String(c?.name || "").trim()).filter(Boolean);
    const uniq = Array.from(new Set(names));
    uniq.sort((a, b) => collator.compare(a, b));
    return uniq;
  }, [companies]);

  const filteredCompanyOptions = useMemo(() => {
    const q = normalize(companySearch);
    return companyOptions.filter((name) => (q ? normalize(name).includes(q) : true));
  }, [companyOptions, companySearch]);

  const requiredFilled =
    company.trim().length > 0 &&
    login.trim().length > 0 &&
    pass.length > 0 &&
    pass2.length > 0 &&
    role.length > 0;

  const isFilled = requiredFilled;

  const loginInvalidRaw = login.trim().length > 0 && !loginRegex.test(login.trim());

  const loginTakenRaw = useMemo(() => {
    const value = normalize(login);
    if (!value) return false;

    const takenInUsers = usersAll.some(
      (u) => normalize(u.login || u.username) === value && String(u.id) !== String(existing?.id)
    );

    const takenInCompanies = companies.some(
      (c) =>
        normalize(c.adminLogin) === value &&
        String(c.adminUserId) !== String(existing?.id)
    );

    return takenInUsers || takenInCompanies;
  }, [login, usersAll, companies, existing?.id]);

  const passMismatchRaw = pass.length > 0 && pass2.length > 0 && pass !== pass2;
  const emailInvalidRaw = email.trim().length > 0 && !emailRegex.test(email.trim());

  const handlePickAvatar = () => {
    if (submitted) setSubmitted(false);
    fileInputRef.current?.click();
  };

  const handleAvatarChange = async (e) => {
    if (submitted) setSubmitted(false);

    const file = e.target.files?.[0];
    if (!file) return;

    if (!["image/png", "image/jpeg", "image/webp"].includes(file.type)) {
      setAvatarFile(null);
      setAvatarUrl("");
      setAvatarError("Поддерживаются PNG/JPG/WebP");
      if (fileInputRef.current) fileInputRef.current.value = "";
      return;
    }

    if (file.size > MAX_AVATAR_BYTES) {
      setAvatarFile(null);
      setAvatarUrl("");
      setAvatarError(`Файл слишком большой (до ${MAX_AVATAR_MB} МБ)`);
      if (fileInputRef.current) fileInputRef.current.value = "";
      return;
    }

    setAvatarError("");
    setAvatarFile(file);
    setIsAvatarTouched(true);

    const dataUrl = await toDataUrl(file).catch(() => "");
    if (!dataUrl) {
      setAvatarFile(null);
      setAvatarUrl("");
      setAvatarError("Не удалось прочитать файл");
      if (fileInputRef.current) fileInputRef.current.value = "";
      return;
    }

    setAvatarUrl(dataUrl);
  };

  const handleRemoveAvatar = (e) => {
    e.stopPropagation();
    if (submitted) setSubmitted(false);

    setIsPreviewOpen(false);
    setAvatarFile(null);
    setAvatarUrl("");
    setAvatarError("");
    setIsAvatarTouched(true);

    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const handleOpenAvatar = () => {
    if (!avatarUrl && !avatarFile) return;
    setIsPreviewOpen(true);
  };

  const previewUrl = useMemo(() => {
    if (avatarUrl) return avatarUrl;
    if (avatarFile instanceof File) return URL.createObjectURL(avatarFile);
    return "";
  }, [avatarUrl, avatarFile]);

  useEffect(() => {
    if (!previewUrl || !(avatarFile instanceof File) || avatarUrl) return;
    return () => URL.revokeObjectURL(previewUrl);
  }, [previewUrl, avatarFile, avatarUrl]);

  const handleSave = async (e) => {
    e.preventDefault();
    setSubmitted(true);

    if (!requiredFilled) return;
    if (loginInvalidRaw || loginTakenRaw || passMismatchRaw || emailInvalidRaw) return;
    if (avatarError) return;

    const selectedCompany = companies.find((c) => normalize(c.name) === normalize(company));
    const payload = {
      companyId: selectedCompany?.id ?? existing?.companyId ?? currentUser?.companyId ?? null,
      companyName: company.trim(),
      login: login.trim(),
      roleKey: role,
      email: email.trim() || "",
      avatarDataUrl: isAvatarTouched ? avatarUrl || null : existing?.avatarDataUrl || null,
    };

    const isPasswordChanged = !existing || pass !== (existing.password || PASSWORD_PLACEHOLDER);
    if (isPasswordChanged) {
      payload.password = pass;
    } else if (!existing) {
      payload.password = pass;
    } else {
      payload.password = PASSWORD_PLACEHOLDER;
    }

    try {
      const savedUser = existing?.id
        ? await usersApi.updateAdmin(existing.id, payload)
        : await usersApi.createAdmin({ ...payload, password: pass });

      if (existing?.id && currentUser && String(currentUser.id) === String(savedUser.id) && onCurrentUserUpdated) {
        onCurrentUserUpdated({
          ...currentUser,
          login: savedUser.login,
          username: savedUser.login,
          companyName: savedUser.companyName,
          company: savedUser.companyName,
          companyId: savedUser.companyId,
          isAdmin: Boolean(savedUser.isAdmin),
          isCompanyAdmin: Boolean(savedUser.isAdmin),
          avatarUrl: savedUser.avatarDataUrl || "",
        });
      }

      navigate(-1);
    } catch (error) {
      window.alert(error?.message || "Не удалось сохранить пользователя.");
    }
  };

  return (
    <div className="cu">
      <div className="cu-top">
        <Button
          variant="secondary"
          className="cu-backBtn"
          onClick={() => navigate(-1)}
          type="button"
        >
          <span className="cu-backInner" aria-hidden="true">
            <svg
              className="cu-backIcon"
              width="20"
              height="20"
              viewBox="0 0 24 24"
              fill="none"
              aria-hidden="true"
            >
              <path
                d="M10 7L5 12L10 17"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
              <path
                d="M5 12H19"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
              />
            </svg>
            <span>Назад</span>
          </span>
        </Button>

        <Button
          variant="primary"
          disabled={!isFilled}
          className="cu-saveBtn"
          onClick={handleSave}
          type="button"
        >
          Сохранить
        </Button>
      </div>

      <form className="cu-panel" onSubmit={handleSave}>
        <div className="cu-grid">
          <div className="cu-col">
            <div className="cu-field">
              <div className="cu-label">Компания</div>

              {isSlaveAdmin ? (
                <Input
                  className="cu-companyLocked"
                  state="focus"
                  placeholder="Введите компанию"
                  value={company}
                  onChange={() => {}}
                  readOnly
                  helperText=" "
                  name="company"
                  autoComplete="organization"
                />
              ) : (
                <div className="cu-companySelectWrap" ref={companyWrapRef}>
                  <button
                    type="button"
                    className="cu-companySelect"
                    onClick={() => {
                      setCompanyOpen((prev) => !prev);
                      setCompanySearch("");
                    }}
                  >
                    <span
                      className={`cu-companySelectText ${!company ? "is-placeholder" : ""}`}
                      title={company || "Выберите компанию"}
                    >
                      {company || "Выберите компанию"}
                    </span>

                    <span className="cu-companySelectCaret">▼</span>
                  </button>

                  {companyOpen && (
                    <div className="cu-companyDropdown">
                      <div className="cu-companyDropdownHead">
                        <input
                          className="cu-companyDropdownInput"
                          placeholder="Введите компанию"
                          value={companySearch}
                          onChange={(e) => setCompanySearch(e.target.value)}
                          autoFocus
                        />
                      </div>

                      <div className="cu-companyDropdownList">
                        {filteredCompanyOptions.length > 0 ? (
                          filteredCompanyOptions.map((name) => (
                            <button
                              key={name}
                              type="button"
                              className={`cu-companyOption ${name === company ? "is-active" : ""}`}
                              onClick={() => {
                                if (submitted) setSubmitted(false);
                                setCompany(name);
                                setCompanyOpen(false);
                                setCompanySearch("");
                              }}
                            >
                              {name}
                            </button>
                          ))
                        ) : (
                          <div className="cu-companyEmpty">Ничего не найдено</div>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>

            <div className="cu-field cu-mt22">
              <div className="cu-label">Логин</div>
              <Input
                state={submitted && (loginInvalidRaw || loginTakenRaw) ? "error" : "focus"}
                placeholder="Введите логин"
                value={login}
                onChange={onEdit(setLogin)}
                helperText={
                  submitted && loginInvalidRaw
                    ? "Неправильный формат"
                    : submitted && loginTakenRaw
                    ? "Этот логин уже используется"
                    : " "
                }
                name="username"
                autoComplete="username"
              />
            </div>

            <div className="cu-field cu-mt22">
              <div className="cu-label">Пароль</div>
              <Input
                state={submitted && passMismatchRaw ? "error" : "focus"}
                placeholder="Придумайте пароль"
                type="text"
                value={pass}
                onChange={onEdit(setPass)}
                name="new-password"
                autoComplete="new-password"
              />
            </div>

            <div className="cu-field cu-mt22">
              <div className="cu-labelSmall">Подтверждение</div>
              <Input
                state={submitted && passMismatchRaw ? "error" : "focus"}
                placeholder="Повторите пароль"
                type="password"
                value={pass2}
                onChange={onEdit(setPass2)}
                helperText={submitted && passMismatchRaw ? "Пароли должны совпадать" : " "}
                name="confirm-password"
                autoComplete="new-password"
              />
            </div>
          </div>

          <div className="cu-col">
            <div className="cu-field">
              <div className="cu-label">Роль</div>

              <div className="cu-roleRow">
                <Button
                  type="button"
                  variant={role === "user" ? "primary" : "secondary"}
                  className="cu-roleBtn"
                  onClick={() => {
                    if (submitted) setSubmitted(false);
                    setRole((prev) => (prev === "user" ? "" : "user"));
                  }}
                >
                  Пользователь
                </Button>

                <Button
                  type="button"
                  variant={role === "admin" ? "primary" : "secondary"}
                  className="cu-roleBtn"
                  onClick={() => {
                    if (submitted) setSubmitted(false);
                    setRole((prev) => (prev === "admin" ? "" : "admin"));
                  }}
                >
                  Администратор
                </Button>
              </div>
            </div>

            <div className="cu-field cu-mt22">
              <div className="cu-label">Email</div>
              <Input
                state={submitted && emailInvalidRaw ? "error" : "default"}
                placeholder="Введите email"
                value={email}
                onChange={onEdit(setEmail)}
                helperText={submitted && emailInvalidRaw ? "Неправильный формат" : " "}
                type="email"
                name="email"
                autoComplete="email"
              />
            </div>

            <div className="cu-field cu-mt22">
              <div className="cu-label">Аватар</div>

              <input
                ref={fileInputRef}
                type="file"
                accept={AVATAR_ACCEPT}
                onChange={handleAvatarChange}
                style={{ display: "none" }}
              />

              {!avatarUrl ? (
                <Button
                  type="button"
                  variant="secondary"
                  className="cu-avatarBtn"
                  onClick={handlePickAvatar}
                >
                  Добавить файл
                </Button>
              ) : (
                <button
                  type="button"
                  className="cu-avatarFile"
                  onClick={handleOpenAvatar}
                  title="Открыть файл"
                >
                  <span className="cu-avatarFileName">
                    {shortFileName(avatarFile?.name || "avatar.png", 14)}
                  </span>

                  <button
                    type="button"
                    className="cu-avatarRemove"
                    onClick={handleRemoveAvatar}
                    aria-label="Удалить файл"
                    title="Удалить"
                  />
                </button>
              )}

              {submitted && avatarError ? (
                <div className="cu-avatarError">{avatarError}</div>
              ) : (
                <div className="cu-avatarError cu-avatarError--empty"> </div>
              )}

              <div className="cu-avatarHint">PNG / JPG / WebP, до {MAX_AVATAR_MB} МБ</div>
            </div>
          </div>
        </div>
      </form>

      {isPreviewOpen && previewUrl && (
        <div
          className="cu-modalOverlay"
          onClick={() => setIsPreviewOpen(false)}
          role="dialog"
          aria-modal="true"
        >
          <div className="cu-modal" onClick={(e) => e.stopPropagation()}>
            <button
              type="button"
              className="cu-modalClose"
              onClick={() => setIsPreviewOpen(false)}
            >
              ×
            </button>

            <img className="cu-modalImg" src={previewUrl} alt="Аватар" />
          </div>
        </div>
      )}
    </div>
  );
}
