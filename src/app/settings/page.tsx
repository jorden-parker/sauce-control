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
import { settings } from "@/settings/settings";
import { saveOrganisation } from "./actions";

export const dynamic = "force-dynamic";

export default function SettingsPage() {
  const organisation = settings().getOrganisation();

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
    </main>
  );
}
