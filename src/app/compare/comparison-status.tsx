"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";
import type { ComparisonStatus } from "@/comparison/current-comparison";
import type { Discovery } from "@/comparison/discover-pages";
import type { PageState } from "@/crawler/page";
import { Button } from "@/components/ui/button";
import { startComparison, stopComparison } from "./actions";

const POLL_MS = 2000,
  describeState = (state: PageState): string =>
    `${state.path} after ${state.interactions
      .map((interaction) => `${interaction.role} "${interaction.name}"`)
      .join(", then ")}`,
  /** Every Page and Page State discovery found, the reviewer's manual Pages applied. */
  DiscoveredPages = ({ discovery }: { discovery: Discovery }) => (
    <div className="flex flex-col gap-2 text-sm" data-testid="discovered-pages">
      <p>
        {discovery.pages.length === 1
          ? "1 Page"
          : `${discovery.pages.length} Pages`}
        {discovery.pageStates.length === 0
          ? ""
          : discovery.pageStates.length === 1
            ? " and 1 Page State"
            : ` and ${discovery.pageStates.length} Page States`}{" "}
        discovered.
      </p>
      <ul className="font-mono">
        {discovery.pages.map((page) => (
          <li key={page.path}>{page.path}</li>
        ))}
        {discovery.pageStates.map((state) => (
          <li key={describeState(state)} className="text-muted-foreground">
            {describeState(state)}
          </li>
        ))}
      </ul>
    </div>
  );

/** Run and Stop for the saved Comparison, with both Instance links once they are up. */
export const ComparisonStatusPanel = ({
  canRun,
  status,
}: {
  canRun: boolean;
  status: ComparisonStatus;
}) => {
  const router = useRouter();
  useEffect(() => {
    if (status.kind !== "starting") {
      return;
    }
    const timer = setInterval(() => router.refresh(), POLL_MS);
    return () => clearInterval(timer);
  }, [router, status.kind]);

  return (
    <div className="flex flex-col gap-3" data-testid="comparison-status">
      {status.kind === "running" ? (
        <>
          <p className="text-sm">
            Both Instances of{" "}
            <span className="font-mono">{status.repository}</span> are up.
          </p>
          <ul className="text-sm">
            <li>
              Base:{" "}
              <a className="font-mono underline" href={status.urls.base}>
                {status.urls.base}
              </a>
            </li>
            <li>
              Target:{" "}
              <a className="font-mono underline" href={status.urls.target}>
                {status.urls.target}
              </a>
            </li>
          </ul>
          <DiscoveredPages discovery={status.discovery} />
          <form action={stopComparison}>
            <Button type="submit" variant="outline">
              Stop Comparison
            </Button>
          </form>
        </>
      ) : status.kind === "starting" ? (
        <p className="text-sm text-muted-foreground">
          {status.stage === "instances"
            ? "Building and starting both Instances of "
            : "Discovering the Pages of "}
          <span className="font-mono">{status.repository}</span>…
        </p>
      ) : (
        <>
          {status.kind === "failed" ? (
            <p
              className="text-sm text-destructive"
              data-testid="comparison-error"
            >
              {status.message}
            </p>
          ) : null}
          <form action={startComparison}>
            <Button type="submit" disabled={!canRun}>
              Run Comparison
            </Button>
          </form>
        </>
      )}
    </div>
  );
};
