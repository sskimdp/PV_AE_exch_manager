import { useEffect, useMemo, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { Input } from "../../../components/Input/Input";
import { Button } from "../../../components/Button/Button";
import { companiesApi } from "../../../api/companiesApi";
import { usersApi } from "../../../api/usersApi";
import "./CreateCompanyPage.css";

const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const loginRegex = /^[A-Za-z0-9._-]{3,}$/;
const PASSWORD_PLACEHOLDER = "********";

export default function CreateCompanyPage() {
  const navigate = useNavigate();
  const location = useLocation();

  const editingIdFromState = location.state?.companyId ?? null;
  const editingIdFromQuery = new URLSearchParams(location.search).get("companyId");
  const editingId = editingIdFromState ?? editingIdFromQuery;

  const [existing, setExisting] = useState(null);
  const [companiesAll, setCompaniesAll] = useState([]);
  const [usersAll, setUsersAll] = useState([]);

  const [name, setName] = useState("");
  const [adminLogin, setAdminLogin] = useState("");
  const [pass, setPass] = useState("");
  const [pass2, setPass2] = useState("");
  const [email, setEmail] = useState("");
  const [submitted, setSubmitted] = useState(false);

  useEffect(() => {
    let cancelled = false;

    const loadLookups = async () => {
      try {
        const [companies, users] = await Promise.all([
          companiesApi.listAdmin(),
          usersApi.listAdmin(),
        ]);

        if (cancelled) return;
        setCompaniesAll(Array.isArray(companies) ? companies : []);
        setUsersAll(Array.isArray(users) ? users : []);
      } catch (error) {
        if (cancelled) return;
        console.error("Не удалось загрузить списки для формы компании", error);
      }
    };

    loadLookups();

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;

    const loadCompany = async () => {
      if (!editingId) {
        setExisting(null);
        return;
      }

      try {
        const company = await companiesApi.getAdminById(editingId);
        if (cancelled) return;
        setExisting(company || null);
      } catch (error) {
        if (cancelled) return;
        console.error("Не удалось загрузить компанию", error);
      }
    };

    loadCompany();

    return () => {
      cancelled = true;
    };
  }, [editingId]);

  useEffect(() => {
    if (!existing) return;
    setName(existing.name || "");
    setAdminLogin(existing.adminLogin || "");
    setPass(existing.adminPassword || PASSWORD_PLACEHOLDER);
    setPass2(existing.adminPassword || PASSWORD_PLACEHOLDER);
    setEmail(existing.adminEmail || "");
  }, [existing]);

  const requiredFilled =
    name.trim().length > 0 &&
    adminLogin.trim().length > 0 &&
    pass.length > 0 &&
    pass2.length > 0;

  const isFilled = requiredFilled;

  const rawLoginInvalid = adminLogin.trim().length > 0 && !loginRegex.test(adminLogin.trim());

  const adminLoginTakenRaw = useMemo(() => {
    const value = adminLogin.trim().toLowerCase();
    if (!value) return false;

    const currentAdminUserId = existing?.adminUserId ?? null;
    const currentCompanyId = existing?.id ?? null;

    const takenInUsers = usersAll.some(
      (u) =>
        String(u.login || "").trim().toLowerCase() === value &&
        String(u.id) !== String(currentAdminUserId)
    );

    const takenInCompanies = companiesAll.some(
      (c) =>
        String(c.adminLogin || "").trim().toLowerCase() === value &&
        String(c.id) !== String(currentCompanyId)
    );

    return takenInUsers || takenInCompanies;
  }, [adminLogin, companiesAll, usersAll, existing?.adminUserId, existing?.id]);

  const rawPassMismatch = pass.length > 0 && pass2.length > 0 && pass !== pass2;
  const rawEmailInvalid = email.trim().length > 0 && !emailRegex.test(email.trim());
  const hasErrors = rawLoginInvalid || adminLoginTakenRaw || rawPassMismatch || rawEmailInvalid;

  const onEdit = (setter) => (e) => {
    if (submitted) setSubmitted(false);
    setter(e.target.value);
  };

  const handleSave = async (e) => {
    e.preventDefault();
    setSubmitted(true);

    if (!requiredFilled || hasErrors) return;

    const payload = {
      name: name.trim(),
      adminLogin: adminLogin.trim(),
      adminEmail: email.trim() || "",
    };

    const isPasswordChanged = !existing || pass !== (existing.adminPassword || PASSWORD_PLACEHOLDER);
    if (isPasswordChanged) {
      payload.adminPassword = pass;
    }

    try {
      if (existing?.id) {
        await companiesApi.updateAdmin(existing.id, payload);
      } else {
        await companiesApi.createAdmin({
          ...payload,
          adminPassword: pass,
        });
      }
      navigate(-1);
    } catch (error) {
      window.alert(error?.message || "Не удалось сохранить компанию.");
    }
  };

  return (
    <div className="cc">
      <div className="cc-top">
        <Button
          variant="secondary"
          className="cc-backBtn"
          onClick={() => navigate(-1)}
          type="button"
        >
          <span className="cc-backInner" aria-hidden="true">
            <svg
              className="cc-backIcon"
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
          className="cc-saveBtn"
          onClick={handleSave}
          type="button"
        >
          Сохранить
        </Button>
      </div>

      <form className="cc-panel" onSubmit={handleSave}>
        <div className="cc-grid">
          <div className="cc-col">
            <div className="cc-field">
              <div className="cc-label">Название компании</div>
              <Input
                state="focus"
                placeholder="Введите название"
                value={name}
                onChange={onEdit(setName)}
              />
            </div>

            <div className="cc-field cc-mt22">
              <div className="cc-label">Логин администратора</div>
              <Input
                state={submitted && (rawLoginInvalid || adminLoginTakenRaw) ? "error" : "focus"}
                placeholder="Введите логин"
                value={adminLogin}
                onChange={onEdit(setAdminLogin)}
                helperText={
                  submitted && rawLoginInvalid
                    ? "Неправильный формат"
                    : submitted && adminLoginTakenRaw
                    ? "Этот логин уже используется"
                    : " "
                }
                name="username"
                autoComplete="username"
              />
            </div>
          </div>

          <div className="cc-col">
            <div className="cc-field">
              <div className="cc-label">Пароль администратора</div>
              <Input
                state={submitted && rawPassMismatch ? "error" : "focus"}
                placeholder="Придумайте пароль"
                type="text"
                name="new-password"
                autoComplete="new-password"
                value={pass}
                onChange={onEdit(setPass)}
              />
            </div>

            <div className="cc-field cc-mt22">
              <div className="cc-labelSmall">Подтверждение</div>
              <Input
                state={submitted && rawPassMismatch ? "error" : "focus"}
                placeholder="Повторите пароль"
                type="password"
                name="confirm-password"
                autoComplete="new-password"
                value={pass2}
                onChange={onEdit(setPass2)}
                helperText={submitted && rawPassMismatch ? "Пароли должны совпадать" : " "}
              />
            </div>

            <div className="cc-field cc-mt25">
              <div className="cc-label">Email</div>
              <Input
                state={submitted && rawEmailInvalid ? "error" : "default"}
                placeholder="Введите email"
                value={email}
                onChange={onEdit(setEmail)}
                type="email"
                name="email"
                autoComplete="email"
                helperText={submitted && rawEmailInvalid ? "Неправильный формат" : " "}
              />
            </div>
          </div>
        </div>
      </form>
    </div>
  );
}
