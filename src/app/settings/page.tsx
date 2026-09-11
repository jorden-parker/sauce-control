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
import { ContainerRuntimeCard } from "./container-runtime-card";

export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  const organisation = settings().getOrganisation(),
    runtimeChoice = await loadRuntimeChoice(
      runtimeAdapter,
      settings().getContainerRuntime()
    );

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
        <ContainerRuntimeCard choice={runtimeChoice} />
      </div>
    </main>
  );
}
