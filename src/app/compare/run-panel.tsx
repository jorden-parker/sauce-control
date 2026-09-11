"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type {
  ComparisonSnapshot,
  ComparisonStatus,
} from "@/comparison/current-comparison";
import { ComparisonStatusPanel } from "./comparison-status";
import { EnvironmentFilesForm } from "./environment-files-form";

export const RunPanel = ({
  repository,
  paths,
  canRun,
  manualScenarioNames,
  status,
}: {
  repository: string;
  paths: string[];
  canRun: boolean;
  manualScenarioNames: string[];
  status: ComparisonStatus;
}) => {
  const [dirty, setDirty] = useState(false),
    [snapshot, setSnapshot] = useState<ComparisonSnapshot>({ status }),
    [disconnected, setDisconnected] = useState(false),
    kind = useRef(status.kind),
    router = useRouter();
  useEffect(() => {
    const events = new EventSource("/compare/progress");
    events.addEventListener("open", () => setDisconnected(false));
    events.addEventListener("error", () => setDisconnected(true));
    events.addEventListener("message", (event) => {
      const next: ComparisonSnapshot = JSON.parse(event.data);
      setSnapshot(next);
      setDisconnected(false);
      if (kind.current !== next.status.kind) {
        kind.current = next.status.kind;
        router.refresh();
      }
    });
    return () => events.close();
  }, [router]);
  const liveStatus = snapshot.status,
    cleaning = snapshot.progress?.cleanup === "pending";
  return (
    <>
      <EnvironmentFilesForm
        repository={repository}
        saved={paths}
        disabled={
          liveStatus.kind === "starting" ||
          liveStatus.kind === "running" ||
          cleaning
        }
        onDirtyChange={setDirty}
      />
      {dirty ? (
        <p className="mb-3 text-sm text-muted-foreground" role="status">
          Save the file paths before running.
        </p>
      ) : null}
      {disconnected ? (
        <p role="status" className="mb-3 text-sm text-muted-foreground">
          Progress connection lost. Reconnecting… Startup continues.
        </p>
      ) : null}
      <ComparisonStatusPanel
        manualScenarioNames={manualScenarioNames}
        canRun={canRun && !dirty && !cleaning && !disconnected}
        status={liveStatus}
        progress={snapshot.progress}
      />
    </>
  );
};
