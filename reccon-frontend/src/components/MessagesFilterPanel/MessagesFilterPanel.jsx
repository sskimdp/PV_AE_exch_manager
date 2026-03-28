import { useEffect, useMemo, useRef, useState } from "react";
import { Button } from "../Button/Button";
import { Input } from "../Input/Input";
import "./MessagesFilterPanel.css";

const collator = new Intl.Collator("ru", { sensitivity: "base" });
const norm = (s) => String(s || "").trim().toLowerCase();

function isValidDateStr(s) {
  if (!s) return true;
  const m = /^(\d{2})\.(\d{2})\.(\d{4})$/.exec(s);
  if (!m) return false;
  const dd = Number(m[1]);
  const mm = Number(m[2]);
  const yyyy = Number(m[3]);
  if (mm < 1 || mm > 12) return false;
  if (dd < 1 || dd > 31) return false;
  const d = new Date(yyyy, mm - 1, dd);
  return d.getFullYear() === yyyy && d.getMonth() === mm - 1 && d.getDate() === dd;
}

function parseDDMMYYYY(s) {
  const m = /^(\d{2})\.(\d{2})\.(\d{4})$/.exec(String(s || ""));
  if (!m) return null;

  const dd = Number(m[1]);
  const mm = Number(m[2]);
  const yyyy = Number(m[3]);

  const d = new Date(yyyy, mm - 1, dd);
  if (
    d.getFullYear() !== yyyy ||
    d.getMonth() !== mm - 1 ||
    d.getDate() !== dd
  ) {
    return null;
  }

  return d;
}

export default function MessagesFilterPanel({
  companies = [],
  value,
  onChange,
  onApply,
  hideCompany = false,
  statusMode = "default",
}) {
  
  const wrapRef = useRef(null);
  const [open, setOpen] = useState(false);
  const [companySearch, setCompanySearch] = useState("");

  const companyValue = value.company || "Все";
  const dateFrom = value.dateFrom || "";
  const dateTo = value.dateTo || "";
  const statuses = value.statuses || new Set();

  const dateFromInvalid = !isValidDateStr(dateFrom);
  const dateToInvalid = !isValidDateStr(dateTo);

  const parsedDateFrom = parseDDMMYYYY(dateFrom);
const parsedDateTo = parseDDMMYYYY(dateTo);

const isDateRangeInvalid =
  Boolean(parsedDateFrom && parsedDateTo) && parsedDateFrom > parsedDateTo;

const hasDateError = dateFromInvalid || dateToInvalid || isDateRangeInvalid;

  const sortedCompanies = useMemo(() => {
    const uniq = Array.from(
      new Set(companies.map((c) => String(c || "").trim()).filter(Boolean))
    );
    uniq.sort((a, b) => collator.compare(a, b));
    return uniq;
  }, [companies]);

  const dropdownList = useMemo(() => {
    const q = norm(companySearch);
    const list = sortedCompanies.filter((c) => (q ? norm(c).includes(q) : true));
    return ["Все", ...list.filter((x) => x !== "Все")];
  }, [sortedCompanies, companySearch]);

  useEffect(() => {
    const onDown = (e) => {
      if (!wrapRef.current) return;
      if (!wrapRef.current.contains(e.target)) setOpen(false);
    };
    window.addEventListener("mousedown", onDown);
    return () => window.removeEventListener("mousedown", onDown);
  }, []);

  const isAllSelected = statuses.size === 0;

  const toggleStatus = (key) => {
    const next = new Set(statuses);
    if (next.has(key)) next.delete(key);
    else next.add(key);

    const allThree =
      next.has("confirmed") && next.has("unconfirmed") && next.has("read");
    if (allThree || next.size === 0) {
      onChange({ ...value, statuses: new Set() });
      return;
    }
    onChange({ ...value, statuses: next });
  };

  return (
    <div
  className={`mfp ${hideCompany ? "mfp--noCompany" : ""} ${
    statusMode === "drafts" ? "mfp--drafts" : ""
  }`}
  ref={wrapRef}
>
      <div className="mfp-top">
        {}
        {!hideCompany && (
          <div className="mfp-company">
            <div className="mfp-label">Компания</div>

            <button
              type="button"
              className="mfp-select"
              onClick={() => {
                setOpen((v) => !v);
                setCompanySearch("");
              }}
            >
              <span className="mfp-selectText" title={companyValue}>
                {companyValue}
              </span>
              <span className="mfp-caret">▼</span>
            </button>

            {open && (
              <div className="mfp-dropdown">
                <div className="mfp-dropdownHead">
                  <input
                    className="mfp-dropdownInput"
                    placeholder="Введите компанию"
                    value={companySearch}
                    onChange={(e) => setCompanySearch(e.target.value)}
                    autoFocus
                  />
                  <span className="mfp-caret"></span>
                </div>

                <div className="mfp-dropdownList">
                  {dropdownList.map((c) => (
                    <button
                      key={c}
                      type="button"
                      className={`mfp-option ${c === companyValue ? "is-active" : ""}`}
                      onClick={() => {
                        onChange({ ...value, company: c });
                        setOpen(false);
                      }}
                    >
                      {c}
                    </button>
                  ))}
                </div>
              </div>
            )}

            <div className="mfp-hint">Выберите “Все” - для всех компаний</div>
          </div>
        )}

        {}
        <div className="mfp-date">
          <div className="mfp-label">Дата</div>

          <div className="mfp-dateRow">
            <div className="mfp-dateInputWrap">
              <Input
                className="mfp-dateInput"
                state={dateFromInvalid || isDateRangeInvalid ? "error" : "default"}
                value={dateFrom}
                onChange={(e) => onChange({ ...value, dateFrom: e.target.value })}
              />
            </div>

            <span className="mfp-arrow" aria-hidden="true">
              <svg
                width="13"
                height="8"
                viewBox="0 0 13 8"
                fill="none"
                xmlns="http://www.w3.org/2000/svg"
              >
                <path
                  d="M0.5 4H12.5M9.5 1L12.5 4L9.5 7"
                  stroke="#000"
                  strokeWidth="1"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </span>

            <div className="mfp-dateInputWrap">
              <Input
                className="mfp-dateInput"
                state={dateToInvalid || isDateRangeInvalid ? "error" : "default"}
                value={dateTo}
                onChange={(e) => onChange({ ...value, dateTo: e.target.value })}
              />
            </div>

            <Button
              type="button"
              variant="primary"
              className="mfp-applyBtn"
              onClick={() => {
  if (hasDateError) return;
  onApply?.();
}}
disabled={hasDateError}
            >
              Применить
            </Button>
          </div>

          <div className="mfp-hint">
  {isDateRangeInvalid
    ? "Дата «с» не может быть позже даты «по»."
    : "Формат - дд.мм.гггг"}
</div>
        </div>
      </div>

      {}
      {statusMode !== "drafts" && (
  <div className="mfp-statusRow">
    <Button
      type="button"
      variant={isAllSelected ? "primary" : "secondary"}
      className="mfp-statusBtn"
      onClick={() => onChange({ ...value, statuses: new Set() })}
    >
      Все
    </Button>

    <Button
      type="button"
      variant={!isAllSelected && statuses.has("confirmed") ? "primary" : "secondary"}
      className="mfp-statusBtn"
      onClick={() => toggleStatus("confirmed")}
    >
      Подтверждённые
    </Button>

    <Button
      type="button"
      variant={!isAllSelected && statuses.has("unconfirmed") ? "primary" : "secondary"}
      className="mfp-statusBtn"
      onClick={() => toggleStatus("unconfirmed")}
    >
      <span className="mfp-statusBtnText">
        <span className="mfp-statusBtnMain">Непрочитанные</span>
        <span className="mfp-statusBtnSub">неподтверждённые</span>
      </span>
    </Button>

    <Button
      type="button"
      variant={!isAllSelected && statuses.has("read") ? "primary" : "secondary"}
      className="mfp-statusBtn"
      onClick={() => toggleStatus("read")}
    >
      <span className="mfp-statusBtnText">
        <span className="mfp-statusBtnMain">Прочитанные</span>
        <span className="mfp-statusBtnSub">неподтверждённые</span>
      </span>
    </Button>
  </div>
)}
    </div>
  );
}