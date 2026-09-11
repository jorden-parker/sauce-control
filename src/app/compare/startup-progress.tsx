"use client";

import { useEffect, useState } from "react";
import type { StartupProgress, StepState } from "@/comparison/startup-progress";

const elapsed = (start: number, end: number) => {
    const seconds = Math.max(0, Math.floor((end - start) / 1000));
    return `${Math.floor(seconds / 60)}m ${String(seconds % 60).padStart(2, "0")}s`;
  },
  labels: Record<StepState, string> = {
    active: "In progress",
    cancelled: "Cancelled",
    complete: "Complete",
    failed: "Failed",
    pending: "Waiting",
  };

export const StartupProgressPanel = ({
  progress,
}: {
  progress: StartupProgress;
}) => {
  const [now, setNow] = useState(progress.endedAt ?? progress.startedAt);
  useEffect(() => {
    if (progress.endedAt) {
      return;
    }
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [progress.id, progress.endedAt]);
  return (
    <section
      className="flex flex-col gap-3 rounded-md border p-3 text-sm"
      aria-label="Startup progress"
      data-testid="startup-progress"
    >
      <p className="font-medium">
        Startup elapsed:{" "}
        <span className="font-mono tabular-nums">
          {elapsed(progress.startedAt, progress.endedAt ?? now)}
        </span>
      </p>
      {(["base", "target", "comparison"] as const).map((scope) => (
        <div key={scope}>
          <h3 className="mb-1 font-medium">
            {scope === "comparison"
              ? "Page analysis"
              : `${scope === "base" ? "Base" : "Target"}: ${progress.branches[scope]}`}
          </h3>
          <ol className="flex flex-col gap-1">
            {progress.steps
              .filter((step) => step.scope === scope)
              .map((step) => (
                <li
                  key={step.key}
                  className={
                    step.state === "failed"
                      ? "text-destructive"
                      : step.state === "pending"
                        ? "text-muted-foreground"
                        : ""
                  }
                >
                  <div className="flex items-baseline justify-between gap-2">
                    <span>{step.label}</span>
                    <span className="shrink-0 text-xs">
                      {labels[step.state]}
                      {step.startedAt === undefined
                        ? ""
                        : ` · ${elapsed(step.startedAt, step.endedAt ?? now)}`}
                    </span>
                  </div>
                  {step.detail ? (
                    <p className="text-xs text-muted-foreground">
                      {step.detail}
                    </p>
                  ) : null}
                </li>
              ))}
          </ol>
        </div>
      ))}
      <p role="status">
        {progress.cleanup === "pending"
          ? "Stopping work and cleaning up…"
          : progress.cleanup === "failed"
            ? "Cleanup could not be completed. Check Container Runtime in Settings."
            : progress.cleanup === "complete"
              ? "Cleanup complete."
              : progress.outcome === "ready"
                ? "Comparison ready."
                : "Startup in progress."}
      </p>
      <details>
        <summary className="cursor-pointer font-medium">
          Progress messages
        </summary>
        <p className="my-2 text-xs text-muted-foreground">
          Latest Sauce Control messages. Command logs are suppressed to protect
          credentials.
        </p>
        <ol
          className="max-h-64 overflow-y-auto font-mono text-xs"
          aria-label="Progress messages"
        >
          {progress.messages.map((message, index) => (
            <li key={index} className="py-0.5">
              {new Date(message.at).toISOString().slice(11, 19)} ·{" "}
              {message.scope === "base"
                ? "Base"
                : message.scope === "target"
                  ? "Target"
                  : "Comparison"}{" "}
              · {message.text}
            </li>
          ))}
        </ol>
      </details>
    </section>
  );
};
