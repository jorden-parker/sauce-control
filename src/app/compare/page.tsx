import Link from "next/link";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  canRunComparison,
  currentComparison,
} from "@/comparison/current-comparison";
import { gitHubClient } from "@/github/github";
import { settings } from "@/settings/settings";
import { ComparisonForm } from "./comparison-form";
import { EmbeddedInstances } from "./embedded-instances";
import { RunPanel } from "./run-panel";

export const dynamic = "force-dynamic";

const Blocker = ({ children }: { children: React.ReactNode }) => (
  <p className="text-sm text-muted-foreground">
    {children}{" "}
    <Link href="/settings" className="underline">
      Open Settings
    </Link>
  </p>
);

export default async function ComparePage() {
  const organisation = settings().getOrganisation(),
    client = await gitHubClient("compare-page"),
    repositories =
      organisation !== undefined && client !== undefined
        ? await client.listRepositories(organisation)
        : [],
    saved = settings().getComparisonSelection(),
    status = currentComparison(),
    setup = settings().getEnvironmentSetup(),
    canRun = await canRunComparison();

  return (
    <main className="mx-auto w-full max-w-6xl p-8">
      <h1 className="mb-6 text-2xl font-semibold tracking-tight">Compare</h1>
      <div className="max-w-lg">
        <p className="mb-4 text-sm text-muted-foreground">
          {setup.conflicts.length > 0
            ? "Resolve the different saved setup commands before running a Comparison. "
            : "Environment setup is shared across all repositories. "}
          <Link href="/settings#environment-setup" className="underline">
            Configure environment setup
          </Link>
        </p>
        <Card>
          <CardHeader>
            <CardTitle>Choose what to compare</CardTitle>
            <CardDescription>
              A Repository from{" "}
              <span className="font-mono">
                {organisation ?? "your Organisation"}
              </span>
              , the Target Branch under review, and the Base Branch to compare
              against.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {organisation === undefined ? (
              <Blocker>Save a GitHub Organisation first.</Blocker>
            ) : client === undefined ? (
              <Blocker>
                No GitHub credential found. Log in with{" "}
                <span className="font-mono">gh</span> or paste a personal access
                token.
              </Blocker>
            ) : (
              <ComparisonForm repositories={repositories} saved={saved} />
            )}
          </CardContent>
        </Card>
        {saved === undefined ? null : (
          <Card className="mt-6">
            <CardHeader>
              <CardTitle>Run</CardTitle>
              <CardDescription>
                Installs dependencies and starts both development servers
                through the Proxy.
              </CardDescription>
            </CardHeader>
            <CardContent>
              {canRun ? null : (
                <div className="mb-3">
                  <Blocker>Choose a Container Runtime first.</Blocker>
                </div>
              )}
              <RunPanel
                key={saved.repository}
                repository={saved.repository}
                paths={settings().getEnvironmentFiles(saved.repository)}
                canRun={canRun && setup.conflicts.length === 0}
                manualScenarioNames={settings()
                  .getScenarioConfig(saved.repository)
                  .manualScenarios.map(({ name }) => name)}
                status={status}
              />
            </CardContent>
          </Card>
        )}
      </div>
      {status.kind === "running" ? (
        <div className="mt-8">
          <EmbeddedInstances urls={status.urls} />
        </div>
      ) : null}
    </main>
  );
}
