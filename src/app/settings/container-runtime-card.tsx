import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import type { RuntimeChoice } from "@/container-runtime/runtime-choice";
import type { InstalledRuntime } from "@/container-runtime/runtime-status";
import { saveContainerRuntime, startContainerRuntime } from "./actions";

const describe = ({ name, running, version }: InstalledRuntime): string =>
    `${name} ${version}, ${running ? "running" : "stopped"}`,
  Picker = ({ candidates }: { candidates: InstalledRuntime[] }) => (
    <form action={saveContainerRuntime} className="flex flex-col gap-4">
      <fieldset className="flex flex-col gap-2">
        {candidates.map((runtime) => (
          <div key={runtime.name} className="flex items-center gap-2">
            <input
              type="radio"
              id={`runtime-${runtime.name}`}
              name="runtime"
              value={runtime.name}
              required
            />
            <Label htmlFor={`runtime-${runtime.name}`}>
              {describe(runtime)}
            </Label>
          </div>
        ))}
      </fieldset>
      <Button type="submit" className="self-start">
        Use this runtime
      </Button>
    </form>
  ),
  StartButton = ({ runtime }: { runtime: InstalledRuntime }) => (
    <form action={startContainerRuntime}>
      <input type="hidden" name="runtime" value={runtime.name} />
      <Button type="submit" variant="outline">
        Start {runtime.name}
      </Button>
    </form>
  ),
  InUse = ({ runtime }: { runtime: InstalledRuntime }) => (
    <div className="flex flex-col gap-3">
      <p className="text-sm">Using {describe(runtime)}</p>
      {runtime.running ? null : <StartButton runtime={runtime} />}
    </div>
  ),
  SavedMissing = ({
    candidates,
    saved,
  }: {
    candidates: InstalledRuntime[];
    saved: string;
  }) => (
    <div className="flex flex-col gap-3">
      <p className="text-sm text-destructive">
        {saved} is no longer installed. Choose a runtime to switch to.
      </p>
      {candidates.length > 0 ? (
        <Picker candidates={candidates} />
      ) : (
        <NoneInstalled />
      )}
    </div>
  ),
  NoneInstalled = () => (
    <p className="text-sm text-muted-foreground">
      Neither Docker nor Podman is installed. Install one to run Comparisons.
    </p>
  ),
  choiceContent = (choice: RuntimeChoice) => {
    switch (choice.kind) {
      case "choose": {
        return <Picker candidates={choice.candidates} />;
      }
      case "none": {
        return <NoneInstalled />;
      }
      case "saved-missing": {
        return (
          <SavedMissing candidates={choice.candidates} saved={choice.saved} />
        );
      }
      case "use": {
        return <InUse runtime={choice.runtime} />;
      }
    }
  };

export const ContainerRuntimeCard = ({ choice }: { choice: RuntimeChoice }) => (
  <Card>
    <CardHeader>
      <CardTitle>Container Runtime</CardTitle>
      <CardDescription>
        Docker or Podman, used to build and run both Instances.
      </CardDescription>
    </CardHeader>
    <CardContent>{choiceContent(choice)}</CardContent>
  </Card>
);
