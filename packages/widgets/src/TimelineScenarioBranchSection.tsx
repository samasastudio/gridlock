import type { ChangeEvent, FormEvent } from "react";
import {
  MAX_SCENARIO_PROMPT_LENGTH,
  type FrameTimelineNode,
} from "@samasastudio/gridlock-core/schemas";
import { ALERT_TRIANGLE_ICON } from "./DossierPrimitives.tsx";
import type { TimelineBranchAlert } from "./useTimelineBranching.ts";

export interface TimelineScenarioBranchSectionProps {
  baseId: string;
  activeNode: FrameTimelineNode;
  scenarioPrompt: string;
  isSubmitting: boolean;
  error: TimelineBranchAlert | null;
  onPromptChange: (nextPrompt: string) => void;
  onSubmitBranch: (parentInteractionId: string) => void;
}

function formatBranchAlertPrefix(error: TimelineBranchAlert): string {
  if (error.statusCode === 400) {
    return "Invalid scenario prompt (HTTP 400):";
  }

  if (error.statusCode === 404) {
    return "Parent illustration unavailable (HTTP 404):";
  }

  if (error.statusCode === 429) {
    return "Scenario Branch quota reached (HTTP 429):";
  }

  if (error.statusCode !== undefined && error.statusCode >= 500) {
    return `Stateful Painter unavailable (HTTP ${error.statusCode}):`;
  }

  if (error.statusCode !== undefined) {
    return `Scenario Branch rejected (HTTP ${error.statusCode}):`;
  }

  return "Scenario Branch request failed:";
}

export function TimelineScenarioBranchSection(props: TimelineScenarioBranchSectionProps) {
  const {
    baseId,
    activeNode,
    scenarioPrompt,
    isSubmitting,
    error,
    onPromptChange,
    onSubmitBranch,
  } = props;

  const headingId = `${baseId}-branch-heading`;
  const promptId = `${baseId}-branch-prompt`;
  const counterId = `${baseId}-branch-counter`;
  const alertId = `${baseId}-branch-alert`;
  const trimmedLength = scenarioPrompt.trim().length;
  const isOverLimit = trimmedLength > MAX_SCENARIO_PROMPT_LENGTH;

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    onSubmitBranch(activeNode.plate.interactionId);
  };

  const handlePromptInput = (event: ChangeEvent<HTMLTextAreaElement>) => {
    onPromptChange(event.currentTarget.value);
  };

  return (
    <form
      className="gridlock-plate-branch-section"
      aria-labelledby={headingId}
      aria-busy={isSubmitting}
      onSubmit={handleSubmit}
    >
      <div className="gridlock-plate-branch-head">
        <h4 id={headingId} className="gridlock-section-heading">
          Scenario Branch
        </h4>
        <span className="gridlock-plate-branch-target">
          <span>{`Forking Turn ${activeNode.plate.turnNumber}`}</span>
          <span aria-hidden="true"> · </span>
          <code>{activeNode.plate.interactionId}</code>
        </span>
      </div>
      <label htmlFor={promptId} className="gridlock-plate-branch-label">
        What-if corridor scenario prompt
      </label>
      <textarea
        id={promptId}
        name="scenarioPrompt"
        className="gridlock-plate-branch-input"
        rows={3}
        value={scenarioPrompt}
        disabled={isSubmitting}
        aria-invalid={isOverLimit || error?.statusCode === 400}
        aria-describedby={error !== null ? `${counterId} ${alertId}` : counterId}
        onChange={handlePromptInput}
      />
      <div className="gridlock-plate-branch-footer">
        <span
          id={counterId}
          className="gridlock-plate-branch-counter"
          data-over-limit={isOverLimit ? "true" : "false"}
        >
          {`${trimmedLength.toLocaleString("en-US")} / ${MAX_SCENARIO_PROMPT_LENGTH.toLocaleString("en-US")} chars`}
        </span>
        <button
          type="submit"
          className="gridlock-action-btn gridlock-plate-branch-submit"
          disabled={isSubmitting || trimmedLength === 0}
        >
          {isSubmitting ? "Painting Scenario Branch…" : "Fork Scenario Branch"}
        </button>
      </div>
      {error !== null ? (
        <div
          id={alertId}
          role="alert"
          className="gridlock-banner gridlock-plate-branch-alert"
          data-error-status={
            error.statusCode !== undefined ? String(error.statusCode) : "network"
          }
          data-error-code={error.errorCode ?? "request_failed"}
        >
          <div className="gridlock-banner-copy">
            <span className="gridlock-banner-icon">{ALERT_TRIANGLE_ICON}</span>
            <p>
              <strong>{formatBranchAlertPrefix(error)}</strong> {error.message}
            </p>
          </div>
        </div>
      ) : null}
    </form>
  );
}
