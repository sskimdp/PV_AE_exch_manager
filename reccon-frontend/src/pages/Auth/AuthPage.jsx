import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Input } from "../../components/Input/Input";
import { Button } from "../../components/Button/Button";
import "./AuthPage.css";

export default function AuthPage({ onLogin }) {
  const navigate = useNavigate();

  const [login, setLogin] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();

    setIsSubmitting(true);
    setError("");

    try {
      const user = await onLogin?.(login, password);

      if (user) {
        navigate("/", { replace: true });
        return;
      }

      setError("Неверный логин или пароль");
    } catch (requestError) {
      setError(requestError?.message || "Не удалось выполнить вход");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="auth-page">
      <div className={`auth-card ${error ? "has-error" : ""}`}>
        <form onSubmit={handleSubmit}>
          <h1 className="auth-title">Вход</h1>

          <label className="auth-label">Логин</label>
          <div className="auth-field">
            <Input
              value={login}
              onChange={(e) => setLogin(e.target.value)}
              className={error ? "auth-input-error" : ""}
              name="login"
              autoComplete="username"
              disabled={isSubmitting}
            />
          </div>

          <p className={`auth-error-text ${error ? "is-visible" : ""}`}>
            {error || " "}
          </p>

          <label className="auth-label auth-label--password">Пароль</label>
          <div className="auth-field">
            <Input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className={error ? "auth-input-error" : ""}
              name="password"
              autoComplete="current-password"
              disabled={isSubmitting}
            />
          </div>

          <div className="auth-actions">
            <Button type="submit" disabled={isSubmitting}>
              {isSubmitting ? "Входим..." : "Войти"}
            </Button>
          </div>

          <p className="auth-hint">
            Нет доступа? Обратитесь к администратору компании.
          </p>
        </form>
      </div>
    </div>
  );
}
