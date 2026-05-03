import { useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useNavigate, useOutletContext } from "react-router-dom";
import { Button } from "../../components/Button/Button";
import { Input } from "../../components/Input/Input";
import { messagesApi } from "../../api/messagesApi";
import "./NewMessagePage.css";

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

const FILE_ACCEPT = ".pdf,.doc,.docx,.xls,.xlsx,.txt,.png,.jpg,.jpeg,.webp,.zip";
const COMPOSE_STORAGE_KEY_PREFIX = "reccon:new-message-compose";

function getComposeStorageKey(userId, reconciliationId) {
  return `${COMPOSE_STORAGE_KEY_PREFIX}:${userId || "anonymous"}:${reconciliationId || "default"
    }`;
}

function readComposeState(key) {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch {
    return null;
  }
}

function writeComposeState(key, value) {
  localStorage.setItem(key, JSON.stringify(value));
}

function clearComposeState(key) {
  localStorage.removeItem(key);
}

function isMeaningfulDraftContent({ text = "", attachments = [] } = {}) {
  return String(text || "").trim().length > 0 || (attachments || []).length > 0;
}

function normalizeServerAttachment(attachment = {}) {
  return {
    id: attachment.id,
    name: attachment.name || attachment.filename || "Файл",
    filename: attachment.filename || attachment.name || "Файл",
    size: attachment.size || 0,
    status: attachment.status || "attached",
    url: attachment.url || attachment.downloadUrl || "",
    downloadUrl: attachment.downloadUrl || attachment.url || "",
    deleteUrl: attachment.deleteUrl || "",
    isLocal: false,
  };
}

function toStoredAttachment(attachment) {
  if (!attachment || attachment.isLocal) return null;
  return {
    id: attachment.id,
    name: attachment.name || attachment.filename || "Файл",
    filename: attachment.filename || attachment.name || "Файл",
    size: attachment.size || 0,
    status: attachment.status || "attached",
    url: attachment.url || attachment.downloadUrl || "",
    downloadUrl: attachment.downloadUrl || attachment.url || "",
    deleteUrl: attachment.deleteUrl || "",
  };
}

function buildSyncedSignature({ draftId, subject, text, html, attachments }) {
  return JSON.stringify({
    draftId: draftId || null,
    subject: subject || "",
    text: text || "",
    html: html || "",
    attachmentIds: (attachments || [])
      .filter((attachment) => attachment && !attachment.isLocal)
      .map((attachment) => String(attachment.id))
      .sort(),
  });
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

function revokeLocalAttachmentUrls(attachments) {
  for (const attachment of attachments || []) {
    if (attachment?.isLocal && attachment?.url) {
      try {
        URL.revokeObjectURL(attachment.url);
      } catch { }
    }
  }
}

export default function NewMessagePage() {
  const navigate = useNavigate();
  const { user } = useOutletContext() || {};
  const location = useLocation();

  const reconciliationId =
    location.state?.fromReconciliation && location.state?.reconciliationId
      ? Number(location.state.reconciliationId)
      : null;
  const composeStorageKey = useMemo(
    () => getComposeStorageKey(user?.id, reconciliationId),
    [user?.id, reconciliationId]
  );

  const isSlave = user?.companyType === "slave";

  const [recipientName, setRecipientName] = useState("");
  const [subject, setSubject] = useState("");
  const [editorText, setEditorText] = useState("");
  const [editorHtml, setEditorHtml] = useState("");
  const [attachments, setAttachments] = useState([]);
  const [draftId, setDraftId] = useState(null);
  const [fileError, setFileError] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isAutosaving, setIsAutosaving] = useState(false);

  const [isLinkModalOpen, setIsLinkModalOpen] = useState(false);
  const [linkUrl, setLinkUrl] = useState("");
  const [linkText, setLinkText] = useState("");
  const [linkError, setLinkError] = useState("");

  const editorRef = useRef(null);
  const fileInputRef = useRef(null);
  const linkMarkerIdRef = useRef(null);
  const attachmentsRef = useRef([]);
  const subjectRef = useRef("");
  const editorTextRef = useRef("");
  const editorHtmlRef = useRef("");
  const draftIdRef = useRef(null);
  const syncPromiseRef = useRef(null);
  const resyncRequestedRef = useRef(false);
  const autosaveTimerRef = useRef(null);
  const lastSyncedSignatureRef = useRef("");
  const hasRestoredComposeStateRef = useRef(false);
  const isPageUnloadingRef = useRef(false);

  useEffect(() => {
    const markPageUnload = () => {
      isPageUnloadingRef.current = true;
    };

    window.addEventListener("beforeunload", markPageUnload);

    return () => {
      window.removeEventListener("beforeunload", markPageUnload);

      if (!isPageUnloadingRef.current) {
        clearComposeState(composeStorageKey);
      }
    };
  }, [composeStorageKey]);

  useEffect(() => {
    hasRestoredComposeStateRef.current = false;
    const snapshot = readComposeState(composeStorageKey);

    setSubject(snapshot?.subject || "");
    setEditorText(snapshot?.text || "");
    setEditorHtml(snapshot?.html || "");
    setAttachments(
      Array.isArray(snapshot?.attachments)
        ? snapshot.attachments.map(normalizeServerAttachment)
        : []
    );
    setDraftId(snapshot?.draftId || null);

    if (snapshot?.recipientName) {
      setRecipientName(snapshot.recipientName);
    }

    lastSyncedSignatureRef.current = snapshot?.draftId
      ? buildSyncedSignature({
        draftId: snapshot.draftId,
        subject: snapshot.subject || "",
        text: snapshot.text || "",
        html: snapshot.html || "",
        attachments: Array.isArray(snapshot.attachments)
          ? snapshot.attachments.map(normalizeServerAttachment)
          : [],
      })
      : "";

    hasRestoredComposeStateRef.current = true;
  }, [composeStorageKey]);

  useEffect(() => {
    attachmentsRef.current = attachments;
  }, [attachments]);

  useEffect(() => {
    subjectRef.current = subject;
  }, [subject]);

  useEffect(() => {
    editorTextRef.current = editorText;
  }, [editorText]);

  useEffect(() => {
    editorHtmlRef.current = editorHtml;
  }, [editorHtml]);

  useEffect(() => {
    draftIdRef.current = draftId;
  }, [draftId]);

  useEffect(() => {
    if (!editorRef.current) return;
    if (editorRef.current.innerHTML === editorHtml) return;

    editorRef.current.innerHTML = editorHtml || "";
    const nextText = editorRef.current.textContent || "";
    if (nextText !== editorTextRef.current) {
      setEditorText(nextText);
    }
  }, [editorHtml]);

  useEffect(() => {
    if (!hasRestoredComposeStateRef.current) return;

    writeComposeState(composeStorageKey, {
      draftId: draftId || null,
      recipientName: recipientName || "",
      subject,
      text: editorText,
      html: editorHtml,
      attachments: attachments.map(toStoredAttachment).filter(Boolean),
    });
  }, [attachments, composeStorageKey, draftId, editorHtml, editorText, recipientName, subject]);

  useEffect(() => {
    let cancelled = false;

    const fallbackRecipientName =
      user?.masterPartnerName ||
      user?.company?.master_partner_name ||
      "";

    const loadComposeMeta = async () => {
      try {
        const data = await messagesApi.getComposeMeta();
        if (cancelled) return;
        setRecipientName(data?.recipientCompanyName || fallbackRecipientName);
      } catch (error) {
        if (cancelled) return;
        console.error("Не удалось загрузить данные для создания сообщения", error);
        setRecipientName(fallbackRecipientName);
      }
    };

    loadComposeMeta();

    return () => {
      cancelled = true;
      if (autosaveTimerRef.current) {
        window.clearTimeout(autosaveTimerRef.current);
      }
      revokeLocalAttachmentUrls(attachmentsRef.current);
    };
  }, [user?.masterPartnerName, user?.company?.master_partner_name]);

  const syncEditorState = () => {
    const text = editorRef.current?.textContent || "";
    const html = editorRef.current?.innerHTML || "";
    setEditorText(text);
    setEditorHtml(html);
  };

  const applyDraftResponse = (draft) => {
    if (!draft) return null;

    const nextAttachments = Array.isArray(draft.attachments)
      ? draft.attachments.map(normalizeServerAttachment)
      : [];

    setDraftId(draft.id);
    draftIdRef.current = draft.id;
    setFileError("");

    setAttachments((prev) => {
      revokeLocalAttachmentUrls(prev.filter((attachment) => attachment?.isLocal));
      return nextAttachments;
    });

    lastSyncedSignatureRef.current = buildSyncedSignature({
      draftId: draft.id,
      subject: subjectRef.current,
      text: editorRef.current?.textContent || editorTextRef.current,
      html: editorRef.current?.innerHTML || editorHtmlRef.current,
      attachments: nextAttachments,
    });

    return draft.id;
  };

  const getCurrentComposeState = () => ({
    draftId: draftIdRef.current,
    subject: subjectRef.current,
    text: editorRef.current?.textContent || editorTextRef.current || "",
    html: editorRef.current?.innerHTML || editorHtmlRef.current || "",
    attachments: attachmentsRef.current || [],
  });

  const syncDraftNow = async ({ force = false } = {}) => {
    if (!isSlave) return null;

      if (syncPromiseRef.current) {
      const syncedDraftId = await syncPromiseRef.current;

      // Получаем состояние ПОСЛЕ того как первый sync завершился и draftIdRef обновился
      const latestState = getCurrentComposeState();
      const localAttachments = latestState.attachments.filter(
        (attachment) => attachment?.isLocal && attachment?.file
      );
      const latestSignature = buildSyncedSignature(latestState);

      if (
        force ||
        localAttachments.length > 0 ||
        latestSignature !== lastSyncedSignatureRef.current
      ) {
        resyncRequestedRef.current = true;
        window.setTimeout(() => {
          syncDraftNow({ force: true }).catch(() => {});
        }, 0);
      }

      return syncedDraftId;
    }

    const currentState = getCurrentComposeState();

    if (!isMeaningfulDraftContent(currentState)) {
      return currentState.draftId || null;
    }

    const localAttachments = currentState.attachments.filter(
      (attachment) => attachment?.isLocal && attachment?.file
    );
    const currentSignature = buildSyncedSignature(currentState);

    if (
      !force &&
      currentState.draftId &&
      localAttachments.length === 0 &&
      currentSignature === lastSyncedSignatureRef.current
    ) {
      return currentState.draftId;
    }

    syncPromiseRef.current = (async () => {
      setIsAutosaving(true);

      try {
        let draft;

        if (!currentState.draftId) {
          draft = await messagesApi.createDraft({
            subject: currentState.subject,
            text: currentState.text,
            html: currentState.html,
            attachments: currentState.attachments,
            reconciliationId,
          });
        } else {
          draft = await messagesApi.updateDraft(
            currentState.draftId,
            {
              subject: currentState.subject,
              text: currentState.text,
              html: currentState.html,
            },
            { audit: force === true }
          );

          if (localAttachments.length > 0) {
            draft = await messagesApi.uploadDraftAttachments(
              currentState.draftId,
              localAttachments.map((attachment) => attachment.file)
            );
          }
        }

        return applyDraftResponse(draft);
      } catch (error) {
        if (error?.status === 404) {
          setDraftId(null);
          draftIdRef.current = null;
          lastSyncedSignatureRef.current = "";
        }

        setFileError(error.message || "Не удалось сохранить черновик.");
        throw error;
      } finally {
        setIsAutosaving(false);
        syncPromiseRef.current = null;

        if (resyncRequestedRef.current) {
          resyncRequestedRef.current = false;
          window.setTimeout(() => {
            syncDraftNow({ force: true }).catch(() => {});
          }, 0);
        }
      }
    })();

    return syncPromiseRef.current;
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
    syncEditorState();

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
    if (!picked.length) return;

    const valid = [];
    const invalidNames = [];

    for (const file of picked) {
      const ext = getFileExtension(file.name);
      const isAllowed = ALLOWED_FILE_EXTENSIONS.includes(ext);
      const isValidSize = file.size <= MAX_FILE_SIZE;

      if (!isAllowed || !isValidSize) {
        invalidNames.push(file.name);
        continue;
      }

      valid.push({
        id: `${file.name}-${file.size}-${Date.now()}-${Math.random()}`,
        name: file.name,
        url: URL.createObjectURL(file),
        file,
        isLocal: true,
      });
    }

    if (invalidNames.length > 0) {
      setFileError(
        "Можно загрузить PDF, DOC, DOCX, XLS, XLSX, TXT, PNG, JPG, WebP, ZIP до 10 МБ."
      );
    } else {
      setFileError("");
    }

    if (valid.length > 0) {
      setAttachments((prev) => [...prev, ...valid]);
    }

    e.target.value = "";
  };

  const handleAttachmentOpen = (attachment) => {
    openAttachmentFile(attachment);
  };

  const handleAttachmentRemove = async (attachmentId) => {
    const currentAttachments = attachmentsRef.current || [];
    const toRemove = currentAttachments.find((item) => item.id === attachmentId);
    const nextAttachments = currentAttachments.filter((item) => item.id !== attachmentId);

    if (toRemove?.isLocal && toRemove?.url) {
      try {
        URL.revokeObjectURL(toRemove.url);
      } catch {}
    }

    attachmentsRef.current = nextAttachments;
    setAttachments(nextAttachments);

    if (!toRemove || toRemove.isLocal) {
      return;
    }

    try {
      await messagesApi.deleteAttachment(toRemove);
      lastSyncedSignatureRef.current = "";
      window.dispatchEvent(new CustomEvent(messagesApi.events.MESSAGE_CHANGED_EVENT));
    } catch (error) {
      console.error("Не удалось удалить вложение", error);
      setFileError(error.message || "Не удалось удалить вложение.");

      attachmentsRef.current = currentAttachments;
      setAttachments(currentAttachments);
    }
  };

  useEffect(() => {
    if (!isSlave) return;

    if (autosaveTimerRef.current) {
      window.clearTimeout(autosaveTimerRef.current);
      autosaveTimerRef.current = null;
    }

    if (!draftIdRef.current) {
      return;
    }

    if (!isMeaningfulDraftContent({ text: editorText, attachments })) {
      return;
    }

    const hasLocalAttachments = attachments.some(
      (attachment) => attachment?.isLocal && attachment?.file
    );

    if (hasLocalAttachments) {
      return;
    }

    autosaveTimerRef.current = window.setTimeout(() => {
      syncDraftNow().catch(() => {});
    }, 1200);

    return () => {
      if (autosaveTimerRef.current) {
        window.clearTimeout(autosaveTimerRef.current);
        autosaveTimerRef.current = null;
      }
    };
  }, [attachments, editorText, isSlave, reconciliationId, subject]);

  const resetForm = () => {
    revokeLocalAttachmentUrls(attachmentsRef.current);
    setSubject("");
    setEditorText("");
    setEditorHtml("");
    setAttachments([]);
    setDraftId(null);
    setFileError("");
    setIsAutosaving(false);
    setIsLinkModalOpen(false);
    setLinkUrl("");
    setLinkText("");
    setLinkError("");
    draftIdRef.current = null;
    lastSyncedSignatureRef.current = "";
    clearComposeState(composeStorageKey);

    if (editorRef.current) {
      editorRef.current.innerHTML = "";
    }
  };

const handleSaveDraft = async () => {
  if (!isSlave || !hasMessageContent || isSubmitting) return;

  if (autosaveTimerRef.current) {
    window.clearTimeout(autosaveTimerRef.current);
    autosaveTimerRef.current = null;
  }

  try {
    setIsSubmitting(true);

    const savedDraftId = await syncDraftNow({ force: true });

    if (savedDraftId) {
      const latestState = getCurrentComposeState();

      const savedDraft = await messagesApi.updateDraft(
        savedDraftId,
        {
          subject: latestState.subject,
          text: latestState.text,
          html: latestState.html,
        },
        { audit: true }
      );

      applyDraftResponse(savedDraft);
    }

    resetForm();
    navigate("/drafts");
  } catch (error) {
    console.error("Не удалось сохранить черновик", error);
    setFileError(error.message || "Не удалось сохранить черновик.");
  } finally {
    setIsSubmitting(false);
  }
};

  const handleSend = async () => {
    if (!isSlave || !hasMessageContent || isSubmitting) return;

    if (autosaveTimerRef.current) {
      window.clearTimeout(autosaveTimerRef.current);
      autosaveTimerRef.current = null;
    }

    try {
      setIsSubmitting(true);
      const currentDraftId = await syncDraftNow({ force: true });

      if (currentDraftId) {
        await messagesApi.sendDraft(currentDraftId);
      } else {
        await messagesApi.composeAndSend({
          subject: subjectRef.current,
          text: editorRef.current?.textContent || editorTextRef.current || "",
          html: editorRef.current?.innerHTML || editorHtmlRef.current || "",
          attachments: attachmentsRef.current,
          reconciliationId,
        });
      }

      resetForm();
      navigate("/sent");
    } catch (error) {
      console.error("Не удалось отправить письмо", error);
      setFileError(error.message || "Не удалось отправить письмо.");
    } finally {
      setIsSubmitting(false);
    }
  };

  const hasMessageContent =
    editorText.trim().length > 0 || attachments.length > 0;

  return (
    <>
      <div className="new-message">
        <div className="new-message__topCard">
          <div className="new-message__row">
            <span className="new-message__label">Кому:</span>
            <span className="new-message__recipient">{recipientName || "—"}</span>
          </div>

          <div className="new-message__row new-message__row--subject">
            <span className="new-message__label">Тема:</span>

            <input
              type="text"
              className="new-message__subjectInput"
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
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
                disabled={isSubmitting}
              >
                Добавить файл
              </Button>

              <Button
                type="button"
                variant="secondary"
                className="new-message__actionBtn"
                onClick={openLinkModal}
                disabled={isSubmitting}
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
                disabled={!hasMessageContent || !isSlave || isSubmitting}
                onClick={handleSaveDraft}
              >
                Черновик
              </Button>

              <Button
                type="button"
                variant="primary"
                className="new-message__sendBtn"
                disabled={!hasMessageContent || !isSlave || isSubmitting}
                onClick={handleSend}
              >
                {isSubmitting ? "Отправка..." : "Отправить"}
              </Button>
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
