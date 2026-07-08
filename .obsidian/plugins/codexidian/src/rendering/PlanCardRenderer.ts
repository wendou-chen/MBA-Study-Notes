import { t } from "../i18n";
import type { PlanStep, PlanUpdate } from "../types";

export interface PlanCallbacks {
  onApproveAll?: () => void | Promise<void>;
  onGiveFeedback?: () => void | Promise<void>;
  onExecuteNext?: () => void | Promise<void>;
}

export class PlanCardRenderer {
  static render(
    container: HTMLElement,
    plan: PlanUpdate,
    callbacks: PlanCallbacks,
  ): HTMLElement {
    container.empty();

    const cardEl = container.createDiv({ cls: "codexidian-plan-card" });

    const headerEl = cardEl.createDiv({ cls: "codexidian-plan-header" });
    headerEl.createDiv({ cls: "codexidian-plan-title", text: plan.title || t("planTitle") });
    headerEl.createDiv({
      cls: `codexidian-plan-status codexidian-plan-status--${plan.status}`,
      text: this.planStatusLabel(plan.status),
    });

    const stepsEl = cardEl.createDiv({ cls: "codexidian-plan-steps" });
    for (const step of plan.steps) {
      const stepEl = stepsEl.createDiv({
        cls: `codexidian-plan-step codexidian-plan-step--${step.status}`,
      });

      stepEl.createDiv({
        cls: "codexidian-plan-step-index",
        text: `${step.index}.`,
      });
      const descriptionEl = stepEl.createDiv({
        cls: "codexidian-plan-step-description",
        text: step.description,
      });
      descriptionEl.title = step.description;
      stepEl.createDiv({
        cls: "codexidian-plan-step-status",
        text: this.stepStatusIcon(step.status),
      });
    }

    const actionsEl = cardEl.createDiv({ cls: "codexidian-plan-actions" });
    const approveBtn = actionsEl.createEl("button", {
      cls: "codexidian-plan-action-btn plan-approve",
      text: t("planApproveAll"),
    });
    const feedbackBtn = actionsEl.createEl("button", {
      cls: "codexidian-plan-action-btn plan-feedback",
      text: t("planGiveFeedback"),
    });
    const executeBtn = actionsEl.createEl("button", {
      cls: "codexidian-plan-action-btn plan-execute",
      text: t("planExecuteNext"),
    });

    approveBtn.type = "button";
    feedbackBtn.type = "button";
    executeBtn.type = "button";

    const hasExecutableStep = plan.steps.some((step) => (
      step.status === "approved" || step.status === "pending"
    ));

    approveBtn.disabled = !(plan.status === "proposed");
    executeBtn.disabled = !(
      plan.status === "approved" || plan.status === "in_progress"
    ) || !hasExecutableStep;

    approveBtn.addEventListener("click", () => {
      void callbacks.onApproveAll?.();
    });
    feedbackBtn.addEventListener("click", () => {
      void callbacks.onGiveFeedback?.();
    });
    executeBtn.addEventListener("click", () => {
      void callbacks.onExecuteNext?.();
    });

    return cardEl;
  }

  private static planStatusLabel(status: PlanUpdate["status"]): string {
    if (status === "approved") return t("planStatusApproved");
    if (status === "in_progress") return t("planStatusInProgress");
    if (status === "completed") return t("planStatusCompleted");
    return t("planStatusProposed");
  }

  private static stepStatusIcon(status: PlanStep["status"]): string {
    if (status === "completed") return "✓";
    if (status === "failed") return "✗";
    if (status === "executing") return "⏳";
    if (status === "approved") return "•";
    if (status === "skipped") return "↷";
    return "○";
  }
}
