import { clear, el } from "./dom.js";

export type StageId = "load" | "clean" | "transform" | "view" | "export";

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
  { id: "view", label: "View" },
  { id: "export", label: "Export" },
];

/**
 * Slim horizontal pipeline stepper. Purely orienteering — it reflects the
 * Load → Clean → Transform → View → Export flow without moving data around.
 */
export class PipelineStepper {
  private readonly items = new Map<StageId, HTMLElement>();

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

    const list = el("ol", { class: "stepper-list" });
    PIPELINE_STAGES.forEach((stage, index) => {
      const item = el("li", { class: "stepper-item", "data-stage": stage.id });
      const button = el(
        "button",
        { class: "stepper-btn", type: "button" },
        [],
      ) as HTMLButtonElement;
      button.append(
        el("span", { class: "stepper-number" }, [String(index + 1)]),
        el("span", { class: "stepper-label" }, [stage.label]),
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
    });

    this.root.append(list);
  }

  setActive(id: StageId): void {
    for (const [stageId, item] of this.items) {
      item.classList.toggle("active", stageId === id);
    }
  }

  setDone(id: StageId, done: boolean): void {
    this.items.get(id)?.classList.toggle("done", done);
  }
}
