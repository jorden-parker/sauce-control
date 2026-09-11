"use client";

import { useState } from "react";
import type { ComparisonStatus } from "@/comparison/current-comparison";
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
  const [dirty, setDirty] = useState(false);
  return (
    <>
      <EnvironmentFilesForm
        repository={repository}
        saved={paths}
        disabled={status.kind === "starting" || status.kind === "running"}
        onDirtyChange={setDirty}
      />
      {dirty ? (
        <p className="mb-3 text-sm text-muted-foreground" role="status">
          Save the file paths before running.
        </p>
      ) : null}
      <ComparisonStatusPanel
        manualScenarioNames={manualScenarioNames}
        canRun={canRun && !dirty}
        status={status}
      />
    </>
  );
};
