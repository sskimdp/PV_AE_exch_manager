import React, { useEffect, useMemo, useRef, useState } from "react";
import { Button } from "../Button/Button";
import { MENU_CONFIG } from "./menuConfig";
import { storage } from "../../utils/storage";
import "./Sidebar.css";

const MAX_AVATAR_SIZE = 5 * 1024 * 1024;
const ALLOWED_AVATAR_TYPES = ["image/png", "image/jpeg", "image/webp"];

function EditIcon() {
  return (
    <svg
      className="sidebar__avatarEditIcon"
      viewBox="0 0 14 14"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
    >
      <path
        d="M9.916 2.042a1.237 1.237 0 0 1 1.75 1.75L5.25 10.208l-2.333.583.583-2.333 6.416-6.416Z"
        stroke="currentColor"
        strokeWidth="0.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export default function Sidebar({
  companyType = "master",
  companyName = "Компания",
  login = "user",
  isAdmin = false,
  counts = {
    incoming: 0,
    drafts: 0,
    inbox: 0,
    inboxCount: 0,
    inboxUnconfirmed: 0,
    draftsCount: 0,
  },
  avatarUrl = "",
  userId = null,

  activeKey: controlledActiveKey,
  onNavigate,
  onCreateMessage,
  onLogout,
  onAvatarChange,
}) {
  const items = MENU_CONFIG[companyType] ?? MENU_CONFIG.master;

  const [uncontrolledActiveKey, setUncontrolledActiveKey] = useState("home");
  const activeKey = controlledActiveKey ?? uncontrolledActiveKey;

  const [isAvatarModalOpen, setIsAvatarModalOpen] = useState(false);
  const [localAvatarUrl, setLocalAvatarUrl] = useState(avatarUrl);
  const [selectedAvatarFile, setSelectedAvatarFile] = useState(null);
  const [selectedAvatarPreview, setSelectedAvatarPreview] = useState("");
  const [avatarError, setAvatarError] = useState("");
  const [isSavingAvatar, setIsSavingAvatar] = useState(false);

  const fileInputRef = useRef(null);

  useEffect(() => {
    setLocalAvatarUrl(avatarUrl || "");
  }, [avatarUrl]);

  const handleNav = (key) => {
    if (!controlledActiveKey) setUncontrolledActiveKey(key);
    if (onNavigate) onNavigate(key);
  };

  const incomingBadge = useMemo(() => {
    const value = Number(
      counts?.inboxUnconfirmed ??
        counts?.incoming ??
        counts?.inboxCount ??
        counts?.inbox ??
        0
    );
    return value > 0 ? value : 0;
  }, [counts]);

  const draftsCount = useMemo(() => {
    const value = Number(
      counts?.draftsCount ??
        counts?.drafts ??
        0
    );
    return value > 0 ? value : 0;
  }, [counts]);

  const resetAvatarModalState = () => {
    setSelectedAvatarFile(null);
    setSelectedAvatarPreview("");
    setAvatarError("");

    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  };

  const openAvatarModal = () => {
    resetAvatarModalState();
    setIsAvatarModalOpen(true);
  };

  const closeAvatarModal = () => {
    resetAvatarModalState();
    setIsAvatarModalOpen(false);
  };

  const handleAvatarFileChange = (event) => {
    const file = event.target.files?.[0];
    if (!file) return;

    if (!ALLOWED_AVATAR_TYPES.includes(file.type)) {
      setSelectedAvatarFile(null);
      setSelectedAvatarPreview("");
      setAvatarError("Можно загрузить только PNG, JPG или WebP.");
      return;
    }

    if (file.size > MAX_AVATAR_SIZE) {
      setSelectedAvatarFile(null);
      setSelectedAvatarPreview("");
      setAvatarError("Размер файла не должен превышать 5 МБ.");
      return;
    }

    const reader = new FileReader();

    reader.onload = () => {
      const result = typeof reader.result === "string" ? reader.result : "";
      setSelectedAvatarFile(file);
      setSelectedAvatarPreview(result);
      setAvatarError("");
    };

    reader.onerror = () => {
      setSelectedAvatarFile(null);
      setSelectedAvatarPreview("");
      setAvatarError("Не удалось прочитать файл. Попробуйте другой.");
    };

    reader.readAsDataURL(file);
  };

  const handleAvatarSave = async () => {
    if (!selectedAvatarFile || !selectedAvatarPreview) {
      setAvatarError("Сначала выберите изображение.");
      return;
    }

    try {
      setIsSavingAvatar(true);
      setAvatarError("");

      if (onAvatarChange) {
        await onAvatarChange(selectedAvatarPreview);
      }

      setLocalAvatarUrl(selectedAvatarPreview);

      const resolvedUserId = userId ?? storage.getCurrentUser()?.id ?? null;
      if (resolvedUserId) {
        storage.updateUserAvatar(resolvedUserId, selectedAvatarPreview);
      }

      closeAvatarModal();
    } catch (error) {
      setAvatarError(error?.message || "Не удалось сохранить аватар.");
    } finally {
      setIsSavingAvatar(false);
    }
  };

  return (
    <>
      <aside className="sidebar">
        <div className="sidebar__header">
          <div className="sidebar__avatarWrap">
            <div className="sidebar__avatar">
              {localAvatarUrl ? (
                <img
                  className="sidebar__avatarImg"
                  src={localAvatarUrl}
                  alt="Аватар пользователя"
                />
              ) : null}
            </div>

            <button
              type="button"
              className="sidebar__avatarEdit"
              aria-label="Изменить аватар"
              title="Изменить аватар"
              onClick={openAvatarModal}
            >
              <EditIcon />
            </button>
          </div>

          <div className="sidebar__headerText">
            <div className="sidebar__company" title={companyName}>
              {companyName}
            </div>
            <div className="sidebar__login">{login}</div>
          </div>
        </div>

        <nav className="sidebar__nav">
          {items.map((item) => {
            const isActive = activeKey === item.key;

            const isInboxItem =
              item.key === "inbox" || item.badge === "incoming";
            const showIncoming = isInboxItem && incomingBadge > 0;

            const showDrafts =
              (item.key === "drafts" || item.count === "drafts") &&
              draftsCount > 0;

            return (
              <button
                key={item.key}
                type="button"
                className={`sidebar__item ${isActive ? "is-active" : ""}`}
                onClick={() => handleNav(item.key)}
              >
                <span className="sidebar__itemLabel">{item.label}</span>

                {showIncoming && (
                  <span className="sidebar__badge">{incomingBadge}</span>
                )}

                {item.key === "drafts" && (
                  <span className="sidebar__count">
                    {showDrafts ? draftsCount : ""}
                  </span>
                )}
              </button>
            );
          })}

          {companyType === "slave" && (
            <div className="sidebar__createWrap">
              <Button onClick={onCreateMessage}>+ Новое сообщение</Button>
            </div>
          )}
        </nav>

        <div className="sidebar__bottom">
          {isAdmin && (
            <button
              type="button"
              className={`sidebar__item ${activeKey === "admin" ? "is-active" : ""}`}
              onClick={() => handleNav("admin")}
            >
              <span className="sidebar__itemLabel">Администратор</span>
            </button>
          )}

          <button
            type="button"
            className="sidebar__item"
            onClick={() => (onLogout ? onLogout() : handleNav("logout"))}
          >
            <span className="sidebar__itemLabel">Выход</span>
          </button>
        </div>
      </aside>

      {isAvatarModalOpen && (
        <div className="sidebar__modalOverlay" onClick={closeAvatarModal}>
          <div
            className="sidebar__modal"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="sidebar__modalTitle">Изменить аватар</div>

            <div className="sidebar__modalText">
              Выберите изображение PNG / JPG / WebP размером до 5 МБ.
            </div>

            <input
              ref={fileInputRef}
              type="file"
              accept=".png,.jpg,.jpeg,.webp"
              className="sidebar__fileInput"
              onChange={handleAvatarFileChange}
            />

            <div className="sidebar__modalActions">
              <button
                type="button"
                className="sidebar__modalBtn sidebar__modalBtn--secondary"
                onClick={() => fileInputRef.current?.click()}
              >
                Выбрать файл
              </button>
            </div>

            {selectedAvatarFile && (
              <div className="sidebar__selectedFile">{selectedAvatarFile.name}</div>
            )}

            {selectedAvatarPreview && (
              <div className="sidebar__previewWrap">
                <img
                  className="sidebar__previewImg"
                  src={selectedAvatarPreview}
                  alt="Предпросмотр аватара"
                />
              </div>
            )}

            {avatarError && <div className="sidebar__error">{avatarError}</div>}

            <div className="sidebar__modalFooter">
              <button
                type="button"
                className="sidebar__modalBtn sidebar__modalBtn--ghost"
                onClick={closeAvatarModal}
              >
                Отмена
              </button>

              <button
                type="button"
                className="sidebar__modalBtn sidebar__modalBtn--primary"
                onClick={handleAvatarSave}
                disabled={!selectedAvatarFile || isSavingAvatar}
              >
                {isSavingAvatar ? "Сохранение..." : "Установить"}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}