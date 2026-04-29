import { Button } from "../Button/Button";
import "./ReconciliationStagePanel.css";

const MAX_STAGE_NUMBER = 10;

export function ReconciliationStagePanel({
  companyName,
  periodFrom,
  periodTo,
  currentStageNumber,
  latestStageNumber,
  isViewingLatestStage,
  isLatestStageCompleted,
  role = "master",
  isLatestStageReady = false,
  isConfirmSelectionEnabled = false,
  onOpenPrevStage,
  onOpenNextStage,
  onCreateNewStage,
  onFinishStage,
  onSendMessage,
  onConfirmSelection,
}) {
  const resolvedRole = role === "slave" ? "slave" : "master";
  const isMasterView = resolvedRole === "master";
  const isSlaveView = resolvedRole === "slave";

  const canOpenPrevStage = currentStageNumber > 1;
  const canOpenNextStage = currentStageNumber < latestStageNumber;

  const canShowLatestActions = isViewingLatestStage && !isLatestStageCompleted;

  const canCreateNewStage =
    isMasterView &&
    canShowLatestActions &&
    currentStageNumber < MAX_STAGE_NUMBER;

  const canFinishStage = isMasterView && canShowLatestActions;

  const canSendMessage = isSlaveView && canShowLatestActions;
  const canConfirmStage = isSlaveView && canShowLatestActions;

  const showCompletedBadge = !canShowLatestActions;

  const slot1Type =
    canOpenPrevStage && (canOpenNextStage || canCreateNewStage || canSendMessage)
      ? "prev"
      : "empty";

  let slot2Type = "empty";
  if (canOpenNextStage) {
    slot2Type = "next";
  } else if (canCreateNewStage) {
    slot2Type = "new";
  } else if (canSendMessage) {
    slot2Type = "send";
  } else if (canOpenPrevStage) {
    slot2Type = "prev";
  }

  const actionsClassName = [
    "recon-stage-panel__actions",
    slot1Type === "prev"
      ? "recon-stage-panel__actions--slot1-prev"
      : "recon-stage-panel__actions--slot1-empty",
    slot2Type === "next"
      ? "recon-stage-panel__actions--slot2-next"
      : slot2Type === "new"
      ? "recon-stage-panel__actions--slot2-new"
      : slot2Type === "send"
      ? "recon-stage-panel__actions--slot2-send"
      : slot2Type === "prev"
      ? "recon-stage-panel__actions--slot2-prev"
      : "recon-stage-panel__actions--slot2-empty",
  ].join(" ");

  return (
    <div className="recon-stage-panel">
      <div className="recon-stage-panel__left">
        <div className="recon-stage-panel__row">
          <span className="recon-stage-panel__label">Компания:</span>
          <span className="recon-stage-panel__value">{companyName}</span>
        </div>

        <div className="recon-stage-panel__row">
          <span className="recon-stage-panel__label">Период:</span>
          <span className="recon-stage-panel__period">
            {periodFrom} - {periodTo}
          </span>
        </div>
      </div>

      <div className="recon-stage-panel__right">
        <div className="recon-stage-panel__stageText">Этап {currentStageNumber}</div>

        <div className={actionsClassName}>
          <div className="recon-stage-panel__actionSlot">
            {slot1Type === "prev" ? (
              <Button
                type="button"
                variant="outline"
                className="recon-stage-panel__navBtn"
                onClick={onOpenPrevStage}
              >
                ← Этап {currentStageNumber - 1}
              </Button>
            ) : (
              <div className="recon-stage-panel__placeholder" />
            )}
          </div>

          <div className="recon-stage-panel__actionSlot">
            {slot2Type === "next" ? (
              <Button
                type="button"
                variant="outline"
                className="recon-stage-panel__navBtn"
                onClick={onOpenNextStage}
              >
                Этап {currentStageNumber + 1} →
              </Button>
            ) : slot2Type === "new" ? (
              <Button
                type="button"
                variant="primary"
                className="recon-stage-panel__newStageBtn"
                onClick={onCreateNewStage}
                disabled={!isLatestStageReady}
              >
                + Новый этап
              </Button>
            ) : slot2Type === "send" ? (
              <Button
                type="button"
                variant="primary"
                className="recon-stage-panel__sendBtn"
                onClick={onSendMessage}
              >
                + Дослать сообщение
              </Button>
            ) : slot2Type === "prev" ? (
              <Button
                type="button"
                variant="outline"
                className="recon-stage-panel__navBtn"
                onClick={onOpenPrevStage}
              >
                ← Этап {currentStageNumber - 1}
              </Button>
            ) : (
              <div className="recon-stage-panel__placeholder" />
            )}
          </div>

          <div className="recon-stage-panel__actionSlot">
            {showCompletedBadge ? (
              <div className="recon-stage-panel__completedBadge">Завершена</div>
            ) : canFinishStage ? (
              <Button
                type="button"
                variant="secondary"
                className="recon-stage-panel__finishBtn"
                onClick={onFinishStage}
                disabled={!isLatestStageReady}
              >
                Завершить
              </Button>
            ) : canConfirmStage ? (
              <Button
                type="button"
                variant="primary"
                className="recon-stage-panel__confirmBtn"
                onClick={onConfirmSelection}
                disabled={!isConfirmSelectionEnabled}
              >
                Подтвердить
              </Button>
            ) : (
              <div className="recon-stage-panel__placeholder" />
            )}
          </div>
        </div>
      </div>
    </div>
  );
}