import { clear, el } from "./dom.js";

export type StageId = "load" | "clean" | "transform" | "export";

export interface StepperStage {
  id: StageId;
  label: string;
  soon?: boolean;
}

export interface PipelineStepperCallbacks {
  onSelect: (id: StageId) => void;
}

export const PIPELINE_STAGES: readonly StepperStage[] = [
  { id: "load", label: "Load" },
  { id: "clean", label: "Clean" },
  { id: "transform", label: "Transform" },
  { id: "export", label: "Export" },
];

/**
 * Slim horizontal pipeline rail. Purely orienteering — it reflects the
 * Load → Clean → Transform → Export flow and the step counts from the Process
 * Log without moving data around. It is not a tab strip: opening a drawer
 * highlights an item temporarily, it never changes the selected view.
 */
export class PipelineStepper {
  private readonly items = new Map<StageId, HTMLElement>();
  private readonly labels = new Map<StageId, HTMLElement>();
  private readonly hints = new Map<StageId, HTMLElement>();

  constructor(
    private readonly root: HTMLElement,
    private readonly callbacks: PipelineStepperCallbacks,
  ) {
    this.root.classList.add("stepper");
    this.build();
  }

  private build(): void {
    clear(this.root);
    this.items.clear();
    this.labels.clear();
    this.hints.clear();

    const list = el("ol", { class: "stepper-list" });
    PIPELINE_STAGES.forEach((stage, index) => {
      const item = el("li", { class: "stepper-item", "data-stage": stage.id });
      const button = el(
        "button",
        { class: "stepper-btn", type: "button" },
        [],
      ) as HTMLButtonElement;
      const label = el("span", { class: "stepper-label" }, [stage.label]);
      const hint = el(
        "span",
        { class: `stepper-hint${stage.id === "clean" || stage.id === "transform" ? "" : " hidden"}` },
        ["optional"],
      );
      button.append(
        el("span", { class: "stepper-number" }, [String(index + 1)]),
        label,
        hint,
      );
      if (stage.soon === true) {
        button.disabled = true;
        button.title = `${stage.label} — coming soon`;
        button.append(el("span", { class: "stepper-soon" }, ["soon"]));
      }
      button.addEventListener("click", () => this.callbacks.onSelect(stage.id));
      item.append(button);
      list.append(item);
      this.items.set(stage.id, item);
      this.labels.set(stage.id, label);
      this.hints.set(stage.id, hint);
    });

    this.root.append(list);
  }

  /** Temporary highlight while a drawer is open; pass null to clear. */
  setActive(id: StageId | null): void {
    for (const [stageId, item] of this.items) {
      item.classList.toggle("active", stageId === id);
    }
  }

  setDone(id: StageId, done: boolean): void {
    this.items.get(id)?.classList.toggle("done", done);
  }

  /**
   * Updates the `Clean · 2` style counter from the Process Log. Zero hides the
   * count, clears the done state and shows the optional hint again.
   */
  setCount(id: StageId, count: number): void {
    const item = this.items.get(id);
    const label = this.labels.get(id);
    const stage = PIPELINE_STAGES.find((entry) => entry.id === id);
    if (label !== undefined && stage !== undefined) {
      label.textContent = count > 0 ? `${stage.label} · ${count}` : stage.label;
    }
    item?.classList.toggle("done", count > 0);
    this.hints.get(id)?.classList.toggle("hidden", count > 0);
  }
}
