import type { InstanceStep } from "@/instance/run-instance";

export type ProgressScope = "base" | "target" | "comparison";
export type StepState =
  | "pending"
  | "active"
  | "complete"
  | "failed"
  | "cancelled";
export interface StartupStep {
  key: string;
  label: string;
  scope: ProgressScope;
  state: StepState;
  startedAt?: number;
  endedAt?: number;
  detail?: string;
}
export interface StartupProgress {
  id: string;
  repository: string;
  branches: { base: string; target: string };
  startedAt: number;
  endedAt?: number;
  outcome: "starting" | "ready" | "failed" | "cancelled";
  cleanup: "none" | "pending" | "complete" | "failed";
  steps: StartupStep[];
  messages: { at: number; scope: ProgressScope; text: string }[];
}
const INSTANCE_STEPS = [
  ["clone", "Clone branch"],
  ["container", "Prepare container"],
  ["install", "Install dependencies"],
  ["start", "Start development server"],
  ["readiness", "Wait for readiness"],
] as const;

/** Only controlled messages enter this in-memory record; snapshots are safe to send to the browser. */
export class StartupProgressTracker {
  private readonly value: StartupProgress;
  constructor(
    id: string,
    repository: string,
    branches: StartupProgress["branches"],
    private readonly changed: () => void
  ) {
    this.value = {
      branches,
      cleanup: "none",
      id,
      messages: [],
      outcome: "starting",
      repository,
      startedAt: Date.now(),
      steps: [
        ...(["base", "target"] as const).flatMap((scope) =>
          INSTANCE_STEPS.map(([key, label]) => ({
            key,
            label,
            scope,
            state: "pending" as const,
          }))
        ),
        {
          key: "discovery",
          label: "Discover Pages",
          scope: "comparison",
          state: "pending",
        },
        {
          key: "affected",
          label: "Detect Affected Pages",
          scope: "comparison",
          state: "pending",
        },
      ],
    };
  }
  snapshot(): StartupProgress {
    return structuredClone(this.value);
  }
  private message(scope: ProgressScope, text: string): void {
    this.value.messages.push({ at: Date.now(), scope, text });
    // Retain the latest messages; step timings remain available independently.
    if (this.value.messages.length > 300) {
      this.value.messages.shift();
    }
  }
  begin(
    scope: ProgressScope,
    key: InstanceStep | "discovery" | "affected"
  ): void {
    if (this.value.outcome !== "starting") {
      return;
    }
    const now = Date.now();
    for (const step of this.value.steps) {
      if (step.scope === scope && step.state === "active" && step.key !== key) {
        step.state = "complete";
        step.endedAt = now;
        this.message(scope, `${step.label} complete.`);
      }
    }
    const step = this.value.steps.find(
      (entry) => entry.scope === scope && entry.key === key
    );
    if (step?.state === "pending") {
      step.state = "active";
      step.startedAt = now;
      this.message(scope, `${step.label} started.`);
    }
    this.changed();
  }
  detail(scope: ProgressScope, key: string, text: string): void {
    if (this.value.outcome !== "starting") {
      return;
    }
    const step = this.value.steps.find(
      (entry) => entry.scope === scope && entry.key === key
    );
    if (!step || step.detail === text) {
      return;
    }
    step.detail = text;
    this.message(scope, text);
    this.changed();
  }
  finish(
    outcome: "ready" | "failed" | "cancelled",
    message: string,
    failedScope?: ProgressScope
  ): void {
    if (this.value.outcome !== "starting") {
      return;
    }
    const now = Date.now();
    this.value.outcome = outcome;
    this.value.endedAt = now;
    for (const step of this.value.steps) {
      if (step.state === "active") {
        step.state =
          outcome === "ready"
            ? "complete"
            : outcome === "failed" &&
                (!failedScope || step.scope === failedScope)
              ? "failed"
              : "cancelled";
        step.endedAt = now;
      }
    }
    this.message(failedScope ?? "comparison", message);
    this.changed();
  }
  cleanup(state: StartupProgress["cleanup"]): void {
    this.value.cleanup = state;
    this.message(
      "comparison",
      state === "pending"
        ? "Stopping work and cleaning up resources."
        : state === "complete"
          ? "Cleanup complete."
          : "Cleanup could not be completed. Check Container Runtime in Settings."
    );
    this.changed();
  }
}
