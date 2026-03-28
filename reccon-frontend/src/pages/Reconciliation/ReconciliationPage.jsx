
import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useOutletContext } from "react-router-dom";
import { Button } from "../../components/Button/Button";
import { Chip } from "../../components/Chip/Chip";
import { Input } from "../../components/Input/Input";
import { reconciliationsApi } from "../../api/reconciliationsApi";
import "../../components/MessagesFilterPanel/MessagesFilterPanel.css";
import "./ReconciliationPage.css";

const collator = new Intl.Collator("ru", { sensitivity: "base" });
const norm = (value) => String(value || "").trim().toLowerCase();

function parseDDMMYYYY(value) {
  const match = /^(\d{2})\.(\d{2})\.(\d{4})$/.exec(String(value || ""));
  if (!match) return null;

  const dd = Number(match[1]);
  const mm = Number(match[2]);
  const yyyy = Number(match[3]);

  const date = new Date(yyyy, mm - 1, dd);
  if (
    date.getFullYear() !== yyyy ||
    date.getMonth() !== mm - 1 ||
    date.getDate() !== dd
  ) {
    return null;
  }

  return date;
}

function isValidDateStr(value) {
  if (!value) return true;
  return Boolean(parseDDMMYYYY(value));
}

function getStatusKey(status) {
  return norm(status) === "завершена" ? "completed" : "active";
}

function getChipVariant(status) {
  return getStatusKey(status) === "completed" ? "confirmed" : "pending";
}

function formatPeriod(item) {
  return `${item.periodFrom} - ${item.periodTo}`;
}

export default function ReconciliationPage() {
  const navigate = useNavigate();
  const { user } = useOutletContext() || {};
  const isMaster = String(user?.companyType || "").trim().toLowerCase() === "master";

  const [reconciliations, setReconciliations] = useState([]);
  const [companies, setCompanies] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [pageError, setPageError] = useState("");

  const wrapRef = useRef(null);
  const modalRef = useRef(null);

  const [companyOpen, setCompanyOpen] = useState(false);
  const [companySearch, setCompanySearch] = useState("");

  const [startModalOpen, setStartModalOpen] = useState(false);
  const [startCompanyOpen, setStartCompanyOpen] = useState(false);
  const [startCompanySearch, setStartCompanySearch] = useState("");
  const [isStarting, setIsStarting] = useState(false);
  const [startError, setStartError] = useState("");

  const [filtersDraft, setFiltersDraft] = useState({
    company: "Все",
    dateFrom: "29.12.2025",
    dateTo: "29.12.2026",
    status: "all",
  });

  const [filtersApplied, setFiltersApplied] = useState({
    company: "Все",
    dateFrom: "29.12.2025",
    dateTo: "29.12.2026",
    status: "all",
  });

  const [startDraft, setStartDraft] = useState({
    companyId: null,
    company: "",
    dateFrom: "29.12.2025",
    dateTo: "29.12.2026",
  });

  useEffect(() => {
    const onDown = (event) => {
      if (wrapRef.current && !wrapRef.current.contains(event.target)) {
        setCompanyOpen(false);
      }

      if (modalRef.current && !modalRef.current.contains(event.target)) {
        setStartCompanyOpen(false);
      }
    };

    window.addEventListener("mousedown", onDown);
    return () => window.removeEventListener("mousedown", onDown);
  }, []);

  useEffect(() => {
    let cancelled = false;

    const loadData = async () => {
      setIsLoading(true);
      setPageError("");

      try {
        const reconciliationsList = await reconciliationsApi.list();

        if (cancelled) return;
        setReconciliations(reconciliationsList);
      } catch (error) {
        if (cancelled) return;
        console.error("Не удалось загрузить сверки", error);
        setPageError("Не удалось загрузить сверки");
        setReconciliations([]);
        setCompanies([]);
        setIsLoading(false);
        return;
      }

      try {
        const availableCompanies = isMaster
          ? await reconciliationsApi.listSlaveCompanies()
          : [];

        if (cancelled) return;
        setCompanies(availableCompanies);
      } catch (error) {
        if (cancelled) return;
        console.error("Не удалось загрузить компании для фильтра/запуска сверки", error);
        setCompanies([]);
      } finally {
        if (!cancelled) {
          setIsLoading(false);
        }
      }
    };

    loadData();

    const handleReload = () => {
      loadData();
    };

    window.addEventListener(
      reconciliationsApi.events.RECONCILIATIONS_CHANGED_EVENT,
      handleReload
    );

    return () => {
      cancelled = true;
      window.removeEventListener(
        reconciliationsApi.events.RECONCILIATIONS_CHANGED_EVENT,
        handleReload
      );
    };
  }, [isMaster]);

  const sortedCompanies = useMemo(
    () => [...companies].sort((a, b) => collator.compare(a.name, b.name)),
    [companies]
  );

  const dropdownList = useMemo(() => {
    const query = norm(companySearch);
    const list = sortedCompanies
      .map((company) => company.name)
      .filter((companyName) =>
        query ? norm(companyName).includes(query) : true
      );

    return ["Все", ...list];
  }, [sortedCompanies, companySearch]);

  const startDropdownList = useMemo(() => {
    const query = norm(startCompanySearch);

    return sortedCompanies.filter((company) =>
      query ? norm(company.name).includes(query) : true
    );
  }, [sortedCompanies, startCompanySearch]);

  const filteredReconciliations = useMemo(() => {
    const fromDate = parseDDMMYYYY(filtersApplied.dateFrom);
    const toDate = parseDDMMYYYY(filtersApplied.dateTo);

    return reconciliations.filter((item) => {
      if (isMaster && filtersApplied.company !== "Все") {
        if (norm(item.company) !== norm(filtersApplied.company)) return false;
      }

      if (filtersApplied.status !== "all") {
        if (getStatusKey(item.status) !== filtersApplied.status) return false;
      }

      const itemDate = parseDDMMYYYY(item.date);
      if (fromDate && itemDate && itemDate < fromDate) return false;
      if (toDate && itemDate && itemDate > toDate) return false;

      return true;
    });
  }, [filtersApplied, isMaster, reconciliations]);

  const startDateFromInvalid = !isValidDateStr(startDraft.dateFrom);
  const startDateToInvalid = !isValidDateStr(startDraft.dateTo);

  const canStartReconciliation = useMemo(() => {
    if (!startDraft.companyId || !startDraft.company.trim()) return false;
    if (startDateFromInvalid || startDateToInvalid) return false;

    const fromDate = parseDDMMYYYY(startDraft.dateFrom);
    const toDate = parseDDMMYYYY(startDraft.dateTo);

    if (!fromDate || !toDate) return false;
    return fromDate <= toDate;
  }, [startDraft, startDateFromInvalid, startDateToInvalid]);

  const openReconciliation = (id) => {
    if (!id) return;
    navigate(`/reconciliation/${id}`);
  };

  const applyFilters = () => {
    setFiltersApplied(filtersDraft);
  };

  const updateDraftField = (field, value) => {
    setFiltersDraft((prev) => ({ ...prev, [field]: value }));
  };

  const updateStartDraftField = (field, value) => {
    setStartDraft((prev) => ({ ...prev, [field]: value }));
  };

  const handleOpenStartModal = () => {
    setStartDraft({
      companyId: null,
      company: "",
      dateFrom: "29.12.2025",
      dateTo: "29.12.2026",
    });
    setStartError("");
    setStartCompanySearch("");
    setStartCompanyOpen(false);
    setStartModalOpen(true);
  };

  const handleCloseStartModal = () => {
    if (isStarting) return;
    setStartModalOpen(false);
    setStartCompanyOpen(false);
    setStartCompanySearch("");
    setStartError("");
  };

  const handleStartReconciliation = async () => {
    if (!canStartReconciliation || isStarting) return;

    setIsStarting(true);
    setStartError("");

    try {
      const created = await reconciliationsApi.create({
        slaveCompanyId: startDraft.companyId,
        periodStart: reconciliationsApi.toBackendDate(startDraft.dateFrom),
        periodEnd: reconciliationsApi.toBackendDate(startDraft.dateTo),
      });

      setFiltersDraft((prev) => ({ ...prev, company: startDraft.company }));
      setFiltersApplied((prev) => ({ ...prev, company: startDraft.company }));
      setStartModalOpen(false);
      openReconciliation(created.id);
    } catch (error) {
      console.error("Не удалось запустить сверку", error);
      setStartError(
        error?.message ||
        error?.detail ||
        "Не удалось запустить сверку"
      );
    } finally {
      setIsStarting(false);
    }
  };

  return (
    <div className="reconciliation-page">
      <div
        className={`mfp reconciliation-filterPanel ${!isMaster ? "mfp--noCompany" : ""
          }`}
        ref={wrapRef}
      >
        <div className="mfp-top">
          {isMaster && (
            <div className="mfp-company">
              <div className="mfp-label">Компания</div>

              <button
                type="button"
                className="mfp-select"
                onClick={() => {
                  setCompanyOpen((prev) => !prev);
                  setCompanySearch("");
                }}
              >
                <span className="mfp-selectText" title={filtersDraft.company}>
                  {filtersDraft.company}
                </span>
                <span className="mfp-caret">▼</span>
              </button>

              {companyOpen && (
                <div className="mfp-dropdown">
                  <div className="mfp-dropdownHead">
                    <input
                      className="mfp-dropdownInput"
                      placeholder="Введите компанию"
                      value={companySearch}
                      onChange={(event) => setCompanySearch(event.target.value)}
                      autoFocus
                    />
                    <span className="mfp-caret"></span>
                  </div>

                  <div className="mfp-dropdownList">
                    {dropdownList.map((company) => (
                      <button
                        key={company}
                        type="button"
                        className={`mfp-option ${company === filtersDraft.company ? "is-active" : ""
                          }`}
                        onClick={() => {
                          updateDraftField("company", company);
                          setCompanyOpen(false);
                        }}
                      >
                        {company}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              <div className="mfp-hint">Выберите “Все” - для всех компаний</div>
            </div>
          )}

          <div className="mfp-date">
            <div className="mfp-label">Дата</div>

            <div className="mfp-dateRow">
              <div className="mfp-dateInputWrap">
                <Input
                  className="mfp-dateInput"
                  state={isValidDateStr(filtersDraft.dateFrom) ? "default" : "error"}
                  value={filtersDraft.dateFrom}
                  onChange={(event) =>
                    updateDraftField("dateFrom", event.target.value)
                  }
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
                  state={isValidDateStr(filtersDraft.dateTo) ? "default" : "error"}
                  value={filtersDraft.dateTo}
                  onChange={(event) =>
                    updateDraftField("dateTo", event.target.value)
                  }
                />
              </div>

              <Button
                type="button"
                variant="primary"
                className="mfp-applyBtn reconciliation-filterPanel__applyBtn"
                onClick={applyFilters}
              >
                Применить
              </Button>
            </div>

            <div className="mfp-hint">Формат - дд.мм.гггг</div>
          </div>
        </div>

        <div className="mfp-statusRow reconciliation-filterPanel__statusRow">
          <Button
            type="button"
            variant={filtersDraft.status === "all" ? "primary" : "secondary"}
            className="mfp-statusBtn reconciliation-filterPanel__statusBtn"
            onClick={() => updateDraftField("status", "all")}
          >
            Все
          </Button>

          <Button
            type="button"
            variant={filtersDraft.status === "active" ? "primary" : "secondary"}
            className="mfp-statusBtn reconciliation-filterPanel__statusBtn"
            onClick={() => updateDraftField("status", "active")}
          >
            Активные
          </Button>

          <Button
            type="button"
            variant={filtersDraft.status === "completed" ? "primary" : "secondary"}
            className="mfp-statusBtn reconciliation-filterPanel__statusBtn"
            onClick={() => updateDraftField("status", "completed")}
          >
            Завершенные
          </Button>
        </div>
      </div>

      <div className="reconciliation-listCard">
        {isMaster && (
          <div className="reconciliation-listCard__top">
            <Button
              type="button"
              variant="primary"
              className="reconciliation-listCard__startBtn"
              onClick={handleOpenStartModal}
            >
              + Запустить сверку
            </Button>
          </div>
        )}

        <div
          className={`reconciliation-table ${isMaster ? "reconciliation-table--master" : "reconciliation-table--slave"
            }`}
        >
          <div className="reconciliation-table__head">
            <div className="reconciliation-table__headCell">Период</div>
            <div className="reconciliation-table__headCell">
              {isMaster ? "Компания" : "Инициатор"}
            </div>
            <div className="reconciliation-table__headCell">Этап</div>
            <div className="reconciliation-table__headCell reconciliation-table__headCell--status">
              Статус
            </div>
            <div className="reconciliation-table__headCell">Дата</div>
          </div>

          <div className="reconciliation-table__body">
            {isLoading && (
              <div className="reconciliation-table__empty">Загрузка...</div>
            )}

            {!isLoading && pageError && (
              <div className="reconciliation-table__empty">{pageError}</div>
            )}

            {!isLoading &&
              !pageError &&
              filteredReconciliations.map((item) => (
                <div
                  className="reconciliation-table__row reconciliation-table__row--clickable"
                  key={item.id}
                  onClick={() => openReconciliation(item.id)}
                  role="button"
                  tabIndex={0}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" || event.key === " ") {
                      event.preventDefault();
                      openReconciliation(item.id);
                    }
                  }}
                >
                  <div
                    className="reconciliation-table__cell reconciliation-table__period"
                    title={formatPeriod(item)}
                  >
                    {formatPeriod(item)}
                  </div>

                  <div
                    className="reconciliation-table__cell reconciliation-table__text"
                    title={isMaster ? item.company : item.initiator}
                  >
                    {isMaster ? item.company : item.initiator}
                  </div>

                  <div className="reconciliation-table__cell reconciliation-table__text">
                    Этап {item.stage}
                  </div>

                  <div className="reconciliation-table__cell reconciliation-table__statusCell">
                    <Chip variant={getChipVariant(item.status)}>{item.status}</Chip>
                  </div>

                  <div className="reconciliation-table__cell reconciliation-table__date">
                    {item.date}
                  </div>
                </div>
              ))}

            {!isLoading && !pageError && filteredReconciliations.length === 0 && (
              <div className="reconciliation-table__empty">Сверки не найдены</div>
            )}
          </div>
        </div>
      </div>

      {isMaster && startModalOpen && (
        <div
          className="reconciliation-startModalOverlay"
          onClick={handleCloseStartModal}
        >
          <div
            className="reconciliation-startModal"
            ref={modalRef}
            onClick={(event) => event.stopPropagation()}
          >
            <div className="reconciliation-startModal__title">Запуск сверки</div>

            <div className="reconciliation-startModal__content">
              <div className="reconciliation-startModal__company">
                <div className="mfp-label">Компания</div>

                <button
                  type="button"
                  className="mfp-select reconciliation-startModal__select"
                  onClick={() => {
                    setStartCompanyOpen((prev) => !prev);
                    setStartCompanySearch("");
                  }}
                >
                  <span
                    className={`mfp-selectText ${!startDraft.company
                      ? "reconciliation-startModal__placeholder"
                      : ""
                      }`}
                    title={startDraft.company}
                  >
                    {startDraft.company || "Введите компанию"}
                  </span>
                  <span className="mfp-caret">{startCompanyOpen ? "▲" : "▼"}</span>
                </button>

                {startCompanyOpen && (
                  <div className="mfp-dropdown reconciliation-startModal__dropdown">
                    <div className="mfp-dropdownHead">
                      <input
                        className="mfp-dropdownInput"
                        placeholder="Введите компанию"
                        value={startCompanySearch}
                        onChange={(event) => setStartCompanySearch(event.target.value)}
                        autoFocus
                      />
                      <span className="mfp-caret"></span>
                    </div>

                    <div className="mfp-dropdownList">
                      {startDropdownList.map((company) => (
                        <button
                          key={company.id}
                          type="button"
                          className={`mfp-option ${company.name === startDraft.company ? "is-active" : ""
                            }`}
                          onClick={() => {
                            updateStartDraftField("company", company.name);
                            updateStartDraftField("companyId", company.id);
                            setStartCompanyOpen(false);
                          }}
                        >
                          {company.name}
                        </button>
                      ))}

                      {startDropdownList.length === 0 && (
                        <div className="reconciliation-startModal__emptyOption">
                          Компании не найдены
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </div>

              <div className="reconciliation-startModal__date">
                <div className="mfp-label">Период</div>

                <div className="reconciliation-startModal__dateRow">
                  <div className="mfp-dateInputWrap">
                    <Input
                      className="mfp-dateInput"
                      state={startDateFromInvalid ? "error" : "default"}
                      value={startDraft.dateFrom}
                      onChange={(event) =>
                        updateStartDraftField("dateFrom", event.target.value)
                      }
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
                      state={startDateToInvalid ? "error" : "default"}
                      value={startDraft.dateTo}
                      onChange={(event) =>
                        updateStartDraftField("dateTo", event.target.value)
                      }
                    />
                  </div>
                </div>

                <div className="mfp-hint">Формат - дд.мм.гггг</div>
                {startError && (
                  <div className="mfp-hint" style={{ color: "#D12730", marginTop: 8 }}>
                    {startError}
                  </div>
                )}
              </div>
            </div>

            <div className="reconciliation-startModal__actions">
              <Button
                type="button"
                variant="outline"
                className="reconciliation-startModal__actionBtn"
                onClick={handleCloseStartModal}
                disabled={isStarting}
              >
                Отменить
              </Button>

              <Button
                type="button"
                variant="primary"
                className="reconciliation-startModal__actionBtn"
                onClick={handleStartReconciliation}
                disabled={!canStartReconciliation || isStarting}
              >
                {isStarting ? "Запуск..." : "Начать"}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
