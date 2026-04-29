import { useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useNavigate, useOutletContext } from "react-router-dom";
import { SearchInput } from "../../components/SearchInput/SearchInput";
import { Chip } from "../../components/Chip/Chip";
import { Button } from "../../components/Button/Button";
import { Input } from "../../components/Input/Input";
import MessagesFilterPanel from "../../components/MessagesFilterPanel/MessagesFilterPanel";
import { messagesApi } from "../../api/messagesApi";
import "../Inbox/InboxPage.css";
import "./DraftsPage.css";
import "../NewMessage/NewMessagePage.css";

const MAX_FILE_SIZE = 10 * 1024 * 1024;

const ALLOWED_FILE_EXTENSIONS = [
  "pdf",
  "doc",
  "docx",
  "xls",
  "xlsx",
  "txt",
  "png",
  "jpg",
  "jpeg",
  "webp",
  "zip",
];

const FILE_ACCEPT =
  ".pdf,.doc,.docx,.xls,.xlsx,.txt,.png,.jpg,.jpeg,.webp,.zip";

const norm = (s) => String(s || "").trim().toLowerCase();

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

function getFileExtension(filename) {
  const parts = String(filename || "").toLowerCase().split(".");
  return parts.length > 1 ? parts.pop() : "";
}

function normalizeUrl(url) {
  const value = String(url || "").trim();
  if (!value) return "";

  if (
    value.startsWith("http://") ||
    value.startsWith("https://") ||
    value.startsWith("mailto:") ||
    value.startsWith("tel:")
  ) {
    return value;
  }

  return `https://${value}`;
}

function isValidLinkAddress(value) {
  const raw = String(value || "").trim();
  if (!raw) return false;
  if (/\s/.test(raw)) return false;

  if (raw.startsWith("mailto:")) {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(raw.slice(7));
  }

  if (raw.startsWith("tel:")) {
    return /^[+\d()\-\s]{5,}$/.test(raw.slice(4));
  }

  try {
    const normalized = normalizeUrl(raw);
    const url = new URL(normalized);

    if (!["http:", "https:", "mailto:", "tel:"].includes(url.protocol)) {
      return false;
    }

    if (url.protocol === "http:" || url.protocol === "https:") {
      return url.hostname === "localhost" || url.hostname.includes(".");
    }

    return true;
  } catch {
    return false;
  }
}

function findClosestLinkNode(node, editor) {
  let current = node?.nodeType === Node.TEXT_NODE ? node.parentElement : node;

  while (current && current !== editor) {
    if (current.tagName === "A") return current;
    current = current.parentElement;
  }

  return null;
}

function isSelectionInsideEditor(editor, range) {
  if (!editor || !range) return false;
  const common = range.commonAncestorContainer;
  return editor.contains(common);
}

function placeCaretAtEnd(element) {
  if (!element) return null;

  element.focus();

  const range = document.createRange();
  range.selectNodeContents(element);
  range.collapse(false);

  const selection = window.getSelection();
  selection.removeAllRanges();
  selection.addRange(range);

  return range;
}

function escapeHtml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function shortFileName(name, maxBase = 18) {
  if (!name) return "";

  const dotIndex = name.lastIndexOf(".");
  if (dotIndex <= 0) {
    return name.length > maxBase ? `${name.slice(0, maxBase)}…` : name;
  }

  const base = name.slice(0, dotIndex);
  const ext = name.slice(dotIndex);

  if (base.length <= maxBase) return `${base}${ext}`;
  return `${base.slice(0, maxBase)}…${ext}`;
}

function openLinkHref(href) {
  if (!href) return;

  if (href.startsWith("mailto:") || href.startsWith("tel:")) {
    window.location.href = href;
    return;
  }

  window.open(href, "_blank", "noopener,noreferrer");
}

function openAttachmentFile(attachment) {
  if (!attachment?.url) return;
  window.open(attachment.url, "_blank", "noopener,noreferrer");
}

function textToEditorHtml(text) {
  return escapeHtml(text || "").replace(/\n/g, "<br>");
}

export default function DraftsPage() {
  const navigate = useNavigate();
  const { user } = useOutletContext() || {};
  const location = useLocation();
  const handledDashboardOpenRef = useRef(null);

  const [drafts, setDrafts] = useState([]);
  const [draftToDelete, setDraftToDelete] = useState(null);
  const [openedDraftId, setOpenedDraftId] = useState(null);
  const [recipientName, setRecipientName] = useState("");
  const [isLoading, setIsLoading] = useState(true);

  const [filtersDraft, setFiltersDraft] = useState({
    dateFrom: "29.12.2025",
    dateTo: "29.12.2026",
    statuses: new Set(),
  });

  const [filtersApplied, setFiltersApplied] = useState(filtersDraft);
  const [search, setSearch] = useState("");

  const [subject, setSubject] = useState("");
  const [editorText, setEditorText] = useState("");
  const [attachments, setAttachments] = useState([]);
  const [fileError, setFileError] = useState("");
  const [isSavingDraft, setIsSavingDraft] = useState(false);

  const [isLinkModalOpen, setIsLinkModalOpen] = useState(false);
  const [linkUrl, setLinkUrl] = useState("");
  const [linkText, setLinkText] = useState("");
  const [linkError, setLinkError] = useState("");

  const editorRef = useRef(null);
  const fileInputRef = useRef(null);
  const linkMarkerIdRef = useRef(null);
  const saveTimeoutRef = useRef(null);
  const pendingPatchRef = useRef({});
  const openedDraftIdRef = useRef(null);

  useEffect(() => {
    openedDraftIdRef.current = openedDraftId;
  }, [openedDraftId]);

  const replaceDraft = (updatedDraft) => {
    if (!updatedDraft?.id) return;
    setDrafts((prev) =>
      prev.map((draft) =>
        draft.id === updatedDraft.id ? { ...draft, ...updatedDraft } : draft
      )
    );
  };

  const loadDrafts = async () => {
    try {
      setIsLoading(true);
      const data = await messagesApi.listDrafts();
      setDrafts(Array.isArray(data) ? data : []);
    } catch (error) {
      console.error("Не удалось загрузить черновики", error);
      setDrafts([]);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    let cancelled = false;

    const loadInitialData = async () => {
      try {
        setIsLoading(true);
        const [draftsData, composeMeta] = await Promise.all([
          messagesApi.listDrafts(),
          messagesApi.getComposeMeta(),
        ]);

        if (cancelled) return;
        setDrafts(Array.isArray(draftsData) ? draftsData : []);
        setRecipientName(composeMeta?.recipientCompanyName || "");
      } catch (error) {
        if (cancelled) return;
        console.error("Не удалось загрузить данные черновиков", error);
        setDrafts([]);
        setRecipientName("");
      } finally {
        if (!cancelled) {
          setIsLoading(false);
        }
      }
    };

    loadInitialData();

    const handleMessagesChanged = () => {
      loadDrafts();
    };

    window.addEventListener(
      messagesApi.events.MESSAGE_CHANGED_EVENT,
      handleMessagesChanged
    );

    return () => {
      cancelled = true;
      window.removeEventListener(
        messagesApi.events.MESSAGE_CHANGED_EVENT,
        handleMessagesChanged
      );
      if (saveTimeoutRef.current) {
        window.clearTimeout(saveTimeoutRef.current);
      }
    };
  }, [user?.companyName]);

  useEffect(() => {
    if (!openedDraftId) return;

    const exists = drafts.find((draft) => draft.id === openedDraftId);
    if (!exists) {
      setOpenedDraftId(null);
    }
  }, [drafts, openedDraftId]);

  const apply = () => setFiltersApplied(filtersDraft);

  const flushDraftPatch = async () => {
    const draftId = openedDraftIdRef.current;
    const patch = { ...pendingPatchRef.current };

    if (!draftId || Object.keys(patch).length === 0) return;

    pendingPatchRef.current = {};
    setIsSavingDraft(true);

    try {
      const updatedDraft = await messagesApi.updateDraft(draftId, patch);
      replaceDraft(updatedDraft);
    } catch (error) {
      console.error("Не удалось сохранить изменения черновика", error);
      setFileError(error.message || "Не удалось сохранить изменения черновика.");
    } finally {
      setIsSavingDraft(false);
    }
  };

  const scheduleDraftPatch = (patch) => {
    if (!openedDraftIdRef.current) return;

    pendingPatchRef.current = {
      ...pendingPatchRef.current,
      ...patch,
    };

    if (saveTimeoutRef.current) {
      window.clearTimeout(saveTimeoutRef.current);
    }

    saveTimeoutRef.current = window.setTimeout(() => {
      flushDraftPatch();
      saveTimeoutRef.current = null;
    }, 400);
  };

  const confirmDelete = async () => {
    if (!draftToDelete) return;

    try {
      await messagesApi.deleteDraft(draftToDelete.id);

      if (openedDraftId === draftToDelete.id) {
        setOpenedDraftId(null);
      }

      setDrafts((prev) => prev.filter((draft) => draft.id !== draftToDelete.id));
      setDraftToDelete(null);
    } catch (error) {
      console.error("Не удалось удалить черновик", error);
      setFileError(error.message || "Не удалось удалить черновик.");
    }
  };

  const filtered = useMemo(() => {
    const q = norm(search);

    const fromD = parseDDMMYYYY(filtersApplied.dateFrom);
    const toD = parseDDMMYYYY(filtersApplied.dateTo);

    return drafts.filter((m) => {
      const md = parseDDMMYYYY(m.date);
      if (fromD && md && md < fromD) return false;
      if (toD && md && md > toD) return false;

      if (q) {
        const hay = [m.company, m.subject, m.text].map(norm).join(" ");
        if (!hay.includes(q)) return false;
      }

      return true;
    });
  }, [drafts, search, filtersApplied]);

  const openedDraft = useMemo(() => {
    return drafts.find((draft) => draft.id === openedDraftId) || null;
  }, [drafts, openedDraftId]);

  const showSlavePanel = user?.companyType === "slave";

  const openDraft = (draft) => {
    setOpenedDraftId(draft.id);
    setSubject(draft.subject || "");
    setEditorText(draft.text || "");
    setAttachments(draft.attachments || []);
    setFileError("");

    setTimeout(() => {
      if (editorRef.current) {
        editorRef.current.innerHTML = draft.html || textToEditorHtml(draft.text || "");
      }
    }, 0);
  };

  useEffect(() => {
    const targetId = location.state?.openDraftId;

    if (!targetId || handledDashboardOpenRef.current === targetId) return;

    const targetDraft = drafts.find((draft) => draft.id === targetId);
    if (!targetDraft) return;

    handledDashboardOpenRef.current = targetId;
    openDraft(targetDraft);
  }, [location.state, drafts]);

  const closeDraft = async () => {
    if (saveTimeoutRef.current) {
      window.clearTimeout(saveTimeoutRef.current);
      saveTimeoutRef.current = null;
    }
    await flushDraftPatch();
    setOpenedDraftId(null);
    setFileError("");
    setIsLinkModalOpen(false);
    setLinkUrl("");
    setLinkText("");
    setLinkError("");
  };

  const syncEditorState = () => {
    const text = editorRef.current?.textContent || "";
    const html = editorRef.current?.innerHTML || "";

    setEditorText(text);
    scheduleDraftPatch({ text, html });
  };

  const handleSubjectChange = (value) => {
    setSubject(value);
    scheduleDraftPatch({ subject: value });
  };

  const removeLinkMarker = () => {
    const editor = editorRef.current;
    const markerId = linkMarkerIdRef.current;

    if (!editor || !markerId) return;

    const marker = editor.querySelector(`[data-link-marker="${markerId}"]`);
    if (marker) {
      marker.remove();
    }

    linkMarkerIdRef.current = null;
  };

  const insertLinkMarker = () => {
    const editor = editorRef.current;
    const selection = window.getSelection();

    if (!editor) return false;

    let range = null;

    if (selection && selection.rangeCount > 0) {
      const currentRange = selection.getRangeAt(0);
      if (isSelectionInsideEditor(editor, currentRange)) {
        range = currentRange.cloneRange();
      }
    }

    if (!range) {
      placeCaretAtEnd(editor);
      const fallbackSelection = window.getSelection();
      if (!fallbackSelection || fallbackSelection.rangeCount === 0) return false;
      range = fallbackSelection.getRangeAt(0).cloneRange();
    }

    removeLinkMarker();
    range.collapse(true);

    const markerId = `link-marker-${Date.now()}-${Math.random()
      .toString(36)
      .slice(2)}`;

    const marker = document.createElement("span");
    marker.setAttribute("data-link-marker", markerId);
    marker.className = "new-message__linkMarker";

    range.insertNode(marker);

    const afterRange = document.createRange();
    afterRange.setStartAfter(marker);
    afterRange.collapse(true);

    const selectionAfter = window.getSelection();
    selectionAfter.removeAllRanges();
    selectionAfter.addRange(afterRange);

    linkMarkerIdRef.current = markerId;
    return true;
  };

  const openLinkModal = () => {
    insertLinkMarker();
    setLinkUrl("");
    setLinkText("");
    setLinkError("");
    setIsLinkModalOpen(true);
  };

  const closeLinkModal = () => {
    removeLinkMarker();
    setIsLinkModalOpen(false);
    setLinkUrl("");
    setLinkText("");
    setLinkError("");
  };

  const insertLinkAtCursor = () => {
    const editor = editorRef.current;
    const rawUrl = String(linkUrl || "").trim();

    if (!editor) return;

    if (!isValidLinkAddress(rawUrl)) {
      setLinkError("Введите корректную ссылку.");
      return;
    }

    const normalizedHref = normalizeUrl(rawUrl);
    const anchorText = String(linkText || "").trim() || normalizedHref;

    const markerId = linkMarkerIdRef.current;
    const marker = markerId
      ? editor.querySelector(`[data-link-marker="${markerId}"]`)
      : null;

    if (!marker) {
      placeCaretAtEnd(editor);
      insertLinkMarker();
    }

    const finalMarker = linkMarkerIdRef.current
      ? editor.querySelector(`[data-link-marker="${linkMarkerIdRef.current}"]`)
      : null;

    if (!finalMarker) return;

    const range = document.createRange();
    range.setStartBefore(finalMarker);
    range.setEndAfter(finalMarker);

    const selection = window.getSelection();
    selection.removeAllRanges();
    selection.addRange(range);

    editor.focus();

    const html = `<a href="${escapeHtml(
      normalizedHref
    )}" target="_blank" rel="noopener noreferrer">${escapeHtml(
      anchorText
    )}</a>&nbsp;`;

    const insertedWithUndo = document.execCommand("insertHTML", false, html);

    if (!insertedWithUndo) {
      const linkNode = document.createElement("a");
      linkNode.href = normalizedHref;
      linkNode.target = "_blank";
      linkNode.rel = "noopener noreferrer";
      linkNode.textContent = anchorText;

      const spacer = document.createTextNode(" ");
      finalMarker.replaceWith(linkNode);
      linkNode.after(spacer);

      const nextRange = document.createRange();
      nextRange.setStartAfter(spacer);
      nextRange.collapse(true);

      const nextSelection = window.getSelection();
      nextSelection.removeAllRanges();
      nextSelection.addRange(nextRange);
    }

    linkMarkerIdRef.current = null;

    const text = editorRef.current?.textContent || "";
    const htmlValue = editorRef.current?.innerHTML || "";
    setEditorText(text);
    scheduleDraftPatch({ text, html: htmlValue });

    setIsLinkModalOpen(false);
    setLinkUrl("");
    setLinkText("");
    setLinkError("");
  };

  const handlePickFiles = () => {
    fileInputRef.current?.click();
  };

  const handleFilesChange = async (e) => {
    const picked = Array.from(e.target.files || []);
    if (!picked.length || !openedDraftId) return;

    const validFiles = [];
    const invalidNames = [];

    for (const file of picked) {
      const ext = getFileExtension(file.name);
      const isAllowed = ALLOWED_FILE_EXTENSIONS.includes(ext);
      const isValidSize = file.size <= MAX_FILE_SIZE;

      if (!isAllowed || !isValidSize) {
        invalidNames.push(file.name);
        continue;
      }

      validFiles.push(file);
    }

    if (invalidNames.length > 0) {
      setFileError(
        "Можно загрузить PDF, DOC, DOCX, XLS, XLSX, TXT, PNG, JPG, WebP, ZIP до 10 МБ."
      );
    } else {
      setFileError("");
    }

    if (validFiles.length > 0) {
      try {
        const updatedDraft = await messagesApi.uploadDraftAttachments(
          openedDraftId,
          validFiles
        );
        replaceDraft(updatedDraft);
        setAttachments(updatedDraft.attachments || []);
      } catch (error) {
        console.error("Не удалось загрузить вложения", error);
        setFileError(error.message || "Не удалось загрузить вложения.");
      }
    }

    e.target.value = "";
  };

  const handleAttachmentOpen = (attachment) => {
    openAttachmentFile(attachment);
  };

  const handleAttachmentRemove = async (attachmentId) => {
    const attachment = attachments.find((item) => item.id === attachmentId);
    if (!attachment) return;

    try {
      await messagesApi.deleteAttachment(attachment);
      const nextAttachments = attachments.filter((item) => item.id !== attachmentId);
      setAttachments(nextAttachments);
      replaceDraft({ id: openedDraftId, attachments: nextAttachments });
    } catch (error) {
      console.error("Не удалось удалить вложение", error);
      setFileError(error.message || "Не удалось удалить вложение.");
    }
  };

  const hasDraftContent =
    subject.trim().length > 0 ||
    editorText.trim().length > 0 ||
    attachments.length > 0;

  const handleSendDraft = async () => {
    if (!openedDraftId) return;

    if (saveTimeoutRef.current) {
      window.clearTimeout(saveTimeoutRef.current);
      saveTimeoutRef.current = null;
    }
    await flushDraftPatch();

    try {
      await messagesApi.sendDraft(openedDraftId);
      setOpenedDraftId(null);
      navigate("/sent");
    } catch (error) {
      console.error("Не удалось отправить черновик", error);
      setFileError(error.message || "Не удалось отправить черновик.");
    }
  };

  if (openedDraft) {
    return (
      <>
        <div className="drafts-open">
          <div className="drafts-open__top">
            <Button
              type="button"
              variant="secondary"
              className="drafts-open__backBtn"
              onClick={closeDraft}
            >
              ← Назад
            </Button>
          </div>

          <div className="new-message">
            <div className="new-message__topCard">
              <div className="new-message__row">
                <span className="new-message__label">Кому:</span>
                <span className="new-message__recipient">
                  {openedDraft.recipientCompany || recipientName || "—"}
                </span>
              </div>

              <div className="new-message__row new-message__row--subject">
                <span className="new-message__label">Тема:</span>

                <input
                  type="text"
                  className="new-message__subjectInput"
                  value={subject}
                  onChange={(e) => handleSubjectChange(e.target.value)}
                />
              </div>
            </div>

            <div className="new-message__editorCard">
              <div className="new-message__editorArea">
                <div className="new-message__editorWrap">
                  {editorText.trim().length === 0 && (
                    <span className="new-message__placeholder" aria-hidden="true">
                      Напишите что-нибудь
                    </span>
                  )}

                  <div
                    ref={editorRef}
                    className="new-message__editor"
                    contentEditable
                    suppressContentEditableWarning
                    onInput={syncEditorState}
                    onClick={(e) => {
                      const editor = editorRef.current;
                      const linkNode = findClosestLinkNode(e.target, editor);

                      if (!linkNode?.href) return;

                      e.preventDefault();
                      openLinkHref(linkNode.href);
                    }}
                    onKeyDown={(e) => {
                      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z") {
                        window.setTimeout(syncEditorState, 0);
                        return;
                      }

                      if (e.key !== "Backspace" && e.key !== "Delete") return;

                      const editor = editorRef.current;
                      const selection = window.getSelection();

                      if (
                        !editor ||
                        !selection ||
                        selection.rangeCount === 0 ||
                        !selection.isCollapsed
                      ) {
                        return;
                      }

                      const range = selection.getRangeAt(0);
                      if (!isSelectionInsideEditor(editor, range)) return;

                      const linkNode = findClosestLinkNode(range.startContainer, editor);
                      if (!linkNode) return;

                      e.preventDefault();

                      const afterRange = document.createRange();
                      afterRange.setStartBefore(linkNode);
                      afterRange.collapse(true);

                      linkNode.remove();

                      const nextSelection = window.getSelection();
                      nextSelection.removeAllRanges();
                      nextSelection.addRange(afterRange);

                      syncEditorState();
                    }}
                  />
                </div>

                {attachments.length > 0 && (
                  <div className="new-message__attachments">
                    {attachments.map((attachment) => (
                      <div
                        key={attachment.id}
                        className="new-message__attachmentItem"
                        title={attachment.name}
                      >
                        <button
                          type="button"
                          className="new-message__attachmentFile"
                          onClick={() => handleAttachmentOpen(attachment)}
                        >
                          <span className="new-message__attachmentFileName">
                            {shortFileName(attachment.name, 18)}
                          </span>
                        </button>

                        <button
                          type="button"
                          className="new-message__attachmentRemove"
                          onClick={(e) => {
                            e.stopPropagation();
                            handleAttachmentRemove(attachment.id);
                          }}
                          aria-label="Удалить файл"
                          title="Удалить"
                        />
                      </div>
                    ))}
                  </div>
                )}

                {fileError && <div className="new-message__fileError">{fileError}</div>}
              </div>

              <div className="new-message__footer">
                <div className="new-message__footerLeft">
                  <Button
                    type="button"
                    variant="secondary"
                    className="new-message__actionBtn"
                    onClick={handlePickFiles}
                  >
                    Добавить файл
                  </Button>

                  <Button
                    type="button"
                    variant="secondary"
                    className="new-message__actionBtn"
                    onClick={openLinkModal}
                  >
                    Добавить ссылку
                  </Button>

                  <input
                    ref={fileInputRef}
                    type="file"
                    className="new-message__hiddenInput"
                    accept={FILE_ACCEPT}
                    multiple
                    onChange={handleFilesChange}
                  />
                </div>

                <div className="new-message__footerRight">
                  <Button
                    type="button"
                    variant="outline"
                    className="new-message__draftBtn"
                    disabled={!hasDraftContent}
                    onClick={closeDraft}
                  >
                    {isSavingDraft ? "Сохранение..." : "Черновик"}
                  </Button>

                  <Button
                    type="button"
                    variant="primary"
                    className="new-message__sendBtn"
                    disabled={!hasDraftContent}
                    onClick={handleSendDraft}
                  >
                    Отправить
                  </Button>
                </div>
              </div>
            </div>
          </div>
        </div>

        {isLinkModalOpen && (
          <div className="new-message__modalOverlay" onClick={closeLinkModal}>
            <div className="new-message__modal" onClick={(e) => e.stopPropagation()}>
              <div className="new-message__modalTitle">Ссылка</div>

              <div className="new-message__modalField">
                <div className="new-message__modalLabel">Адрес ссылки</div>
                <Input
                  state={
                    String(linkUrl || "").trim().length > 0 && !isValidLinkAddress(linkUrl)
                      ? "error"
                      : "focus"
                  }
                  value={linkUrl}
                  onChange={(e) => {
                    setLinkUrl(e.target.value);
                    if (linkError) setLinkError("");
                  }}
                  helperText={
                    String(linkUrl || "").trim().length > 0 && !isValidLinkAddress(linkUrl)
                      ? "Введите корректную ссылку."
                      : linkError || " "
                  }
                />
              </div>

              <div className="new-message__modalField">
                <div className="new-message__modalLabel">Текст ссылки</div>
                <Input
                  state="default"
                  value={linkText}
                  onChange={(e) => setLinkText(e.target.value)}
                  helperText=" "
                />
              </div>

              <div className="new-message__modalFooter">
                <Button type="button" variant="secondary" onClick={closeLinkModal}>
                  Отменить
                </Button>

                <Button
                  type="button"
                  variant="primary"
                  onClick={insertLinkAtCursor}
                  disabled={!String(linkUrl || "").trim()}
                >
                  Вставить
                </Button>
              </div>
            </div>
          </div>
        )}
      </>
    );
  }

  return (
    <>
      <div className="inbox drafts-page">
        {showSlavePanel && (
          <MessagesFilterPanel
            value={filtersDraft}
            onChange={setFiltersDraft}
            onApply={apply}
            statusMode="drafts"
            hideCompany={true}
          />
        )}

        <div className="inbox-searchWrap">
          <SearchInput value={search} onChange={setSearch} placeholder="Поиск" />
        </div>

        <div className={`inbox-list ${filtered.length === 0 ? "is-empty" : ""}`}>
          {isLoading ? (
            <div className="inbox-empty">Загрузка...</div>
          ) : filtered.length === 0 ? (
            <div className="inbox-empty">Список пуст</div>
          ) : (
            filtered.map((m) => (
              <div
                key={m.id}
                className="inbox-row"
                role="button"
                tabIndex={0}
                onClick={() => openDraft(m)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    openDraft(m);
                  }
                }}
              >
                <div className="inbox-left">
                  <div className="inbox-company" title={m.company}>
                    {m.company}
                  </div>

                  <div className="inbox-subject" title={m.subject || "Без темы"}>
                    {m.subject || "Без темы"}
                  </div>

                  <div className="inbox-text" title={m.text || "Без текста"}>
                    {m.text || "Без текста"}
                  </div>
                </div>

                <div className="inbox-right drafts-right">
                  <div className="inbox-rightTop drafts-rightTop">
                    <Chip variant="draft">Черновик</Chip>
                    <div className="inbox-date">{m.date}</div>
                  </div>

                  <Button
                    type="button"
                    variant="secondary"
                    className="drafts-deleteBtn"
                    onClick={(e) => {
                      e.stopPropagation();
                      setDraftToDelete(m);
                    }}
                  >
                    Удалить
                  </Button>
                </div>
              </div>
            ))
          )}
        </div>
      </div>

      {draftToDelete && (
        <div className="drafts-modalOverlay" onClick={() => setDraftToDelete(null)}>
          <div className="drafts-modal" onClick={(e) => e.stopPropagation()}>
            <div className="drafts-modalTitle">Удаление черновика</div>

            <div className="drafts-modalText">
              Вы действительно хотите удалить черновик письма?
            </div>

            <div className="drafts-modalInfo">
              <div className="drafts-modalRow">
                <span className="drafts-modalLabel">Тема:</span>
                <span
                  className="drafts-modalValue"
                  title={draftToDelete.subject || "Без темы"}
                >
                  {draftToDelete.subject || "Без темы"}
                </span>
              </div>

              <div className="drafts-modalRow">
                <span className="drafts-modalLabel">Дата:</span>
                <span className="drafts-modalValue">{draftToDelete.date}</span>
              </div>
            </div>

            <div className="drafts-modalFooter">
              <Button type="button" variant="secondary" onClick={() => setDraftToDelete(null)}>
                Отмена
              </Button>

              <Button type="button" variant="primary" onClick={confirmDelete}>
                Подтвердить
              </Button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
