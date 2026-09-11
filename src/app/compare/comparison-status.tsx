"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";
import type { ComparisonStatus } from "@/comparison/current-comparison";
import type { AffectedPages } from "@/comparison/detect-affected-pages";
import type { Discovery } from "@/comparison/discover-pages";
import type { PageState } from "@/crawler/page";
import { Button } from "@/components/ui/button";
import { startComparison, stopComparison } from "./actions";
import { SCENARIO_NAMES } from "@/scenarios/scenario-name";

const POLL_MS = 2000,
  describeState = (state: PageState): string =>
    `${state.path} after ${state.interactions
      .map((interaction) => `${interaction.role} "${interaction.name}"`)
      .join(", then ")}`,
  count = (amount: number, noun: string): string =>
    amount === 1 ? `1 ${noun}` : `${amount} ${noun}s`,
  FALLBACK_REASONS: Record<NonNullable<AffectedPages["fallback"]>, string> = {
    "missing-source-maps":
      "Affected Page detection is off: the Instances serve no source maps, so every Page is compared. A dev server start command usually serves them.",
    "non-module-changes":
      "Affected Page detection is off: no changed file is a module any Page loads (a stylesheet or config change, say), so every Page is compared.",
  },
  /** Why every Page is listed instead of only the Affected ones. */
  FallbackBanner = ({ affected }: { affected: AffectedPages }) =>
    affected.fallback === undefined ? null : (
      <p
        className="rounded-md border border-amber-500/50 bg-amber-500/10 px-3 py-2"
        data-testid="detection-banner"
        role="status"
      >
        {FALLBACK_REASONS[affected.fallback]}
      </p>
    ),
  /** The Affected Pages with their Page States, or every Page when detection is off. */
  AffectedPageList = ({
    affected,
    discovery,
  }: {
    affected: AffectedPages;
    discovery: Discovery;
  }) => {
    const paths = new Set(affected.pages.map((page) => page.path)),
      states = discovery.pageStates.filter((state) => paths.has(state.path));
    return (
      <div
        className="flex flex-col gap-2 text-sm"
        data-testid="discovered-pages"
      >
        <FallbackBanner affected={affected} />
        <p>
          {affected.fallback === undefined
            ? `${count(affected.pages.length, "Affected Page")} of ${count(discovery.pages.length, "Page")} discovered`
            : `${count(discovery.pages.length, "Page")} discovered`}
          {states.length === 0
            ? ""
            : `, with ${count(states.length, "Page State")}`}
          .
        </p>
        <ul className="font-mono">
          {affected.pages.map((page) => (
            <li key={page.path}>{page.path}</li>
          ))}
          {states.map((state) => (
            <li key={describeState(state)} className="text-muted-foreground">
              {describeState(state)}
            </li>
          ))}
        </ul>
        {affected.fallback === undefined && affected.unattributed.length > 0 ? (
          <p className="text-muted-foreground" data-testid="unattributed-files">
            {count(affected.unattributed.length, "changed file")} no Page loads
            as a module, so the change may reach Pages not listed:{" "}
            <span className="font-mono">
              {affected.unattributed.join(", ")}
            </span>
          </p>
        ) : null}
      </div>
    );
  };

/** Run and Stop for the saved Comparison, with both Instance links once they are up. */
export const ComparisonStatusPanel = ({
  canRun,
  status,
  manualScenarioNames = [],
}: {
  canRun: boolean;
  manualScenarioNames?: string[];
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
          <p className="text-sm">
            Active Scenario: {status.scenario}.{" "}
            {count(status.mockedEndpoints, "Endpoint")} mocked.
          </p>
          <p className="text-sm text-muted-foreground">
            Unmatched requests continue to the real Endpoint.
          </p>
          <AffectedPageList
            affected={status.affected}
            discovery={status.discovery}
          />
          <form action={stopComparison}>
            <Button type="submit" variant="outline">
              Stop Comparison
            </Button>
          </form>
        </>
      ) : status.kind === "starting" ? (
        <p className="text-sm text-muted-foreground">
          {status.stage === "instances"
            ? "Preparing development servers for "
            : status.stage === "discovery"
              ? "Discovering the Pages of "
              : "Detecting the Affected Pages of "}
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
          <form action={startComparison} className="flex flex-col gap-3">
            <label htmlFor="scenario" className="text-sm font-medium">
              Scenario
            </label>
            <select
              id="scenario"
              name="scenario"
              defaultValue="recorded"
              className="h-9 rounded-md border bg-background px-3 text-sm"
              aria-describedby="scenario-help"
            >
              {[...SCENARIO_NAMES, ...manualScenarioNames].map((name) => (
                <option key={name} value={name}>
                  {name}
                </option>
              ))}
            </select>
            <p id="scenario-help" className="text-sm text-muted-foreground">
              Both Instances use Base responses: recorded data, empty values, an
              error, or a three-second delay. Discovery calls real Endpoints
              first.
            </p>
            <Button type="submit" disabled={!canRun}>
              Run Comparison
            </Button>
          </form>
        </>
      )}
    </div>
  );
};
