import Link from "next/link";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { loadRuntimeChoice } from "@/container-runtime/runtime-choice";
import { runtimeAdapter } from "@/container-runtime/runtime";
import { settings } from "@/settings/settings";
import { saveOrganisation } from "./actions";
import { currentSessionId } from "@/instance/current-session";
import { listInstances } from "@/instance/instances";
import { ContainerRuntimeCard } from "./container-runtime-card";
import { InstancesCard } from "./instances-card";
import { GitHubAccessCard } from "./github-access-card";
import { gitHubTokenSource } from "@/github/github";
import { EnvironmentSetupCard } from "./environment-setup-card";

export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  const organisation = settings().getOrganisation(),
    tokenSource = await gitHubTokenSource(),
    runtimeChoice = await loadRuntimeChoice(
      runtimeAdapter,
      settings().getContainerRuntime()
    ),
    instances =
      runtimeChoice.kind === "use" && runtimeChoice.runtime.running
        ? await listInstances(
            runtimeAdapter,
            runtimeChoice.runtime.name,
            currentSessionId
          )
        : undefined;

  return (
    <main className="mx-auto w-full max-w-lg p-8">
      <h1 className="mb-6 text-2xl font-semibold tracking-tight">Settings</h1>
      <Card>
        <CardHeader>
          <CardTitle>GitHub Organisation</CardTitle>
          <CardDescription>
            Saved once and reused across sessions. Repositories are picked from
            this Organisation.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form action={saveOrganisation} className="flex flex-col gap-4">
            <div className="flex flex-col gap-2">
              <Label htmlFor="organisation">Organisation</Label>
              <Input
                id="organisation"
                name="organisation"
                defaultValue={organisation ?? ""}
                placeholder="my-org"
                autoComplete="off"
                required
              />
            </div>
            <Button type="submit" className="self-start">
              Save
            </Button>
            {organisation ? (
              <p className="text-sm text-muted-foreground">
                Current Organisation:{" "}
                <span className="font-mono">{organisation}</span>
              </p>
            ) : null}
          </form>
        </CardContent>
      </Card>
      <div className="mt-6">
        <GitHubAccessCard source={tokenSource} />
      </div>
      <div className="mt-6" id="environment-setup">
        <EnvironmentSetupCard setup={settings().getEnvironmentSetup()} />
      </div>
      <div className="mt-6">
        <ContainerRuntimeCard choice={runtimeChoice} />
      </div>
      {instances === undefined ? null : (
        <div className="mt-6">
          <InstancesCard instances={instances} />
        </div>
      )}
      <p className="mt-6 text-sm">
        <Link href="/compare" className="underline">
          Choose what to compare
        </Link>
      </p>
    </main>
  );
}
