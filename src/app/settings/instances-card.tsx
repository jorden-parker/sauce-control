import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import type { InstanceSummary } from "@/instance/instances";
import { startInstance, stopAllInstances, stopInstance } from "./actions";

const age = (createdAt: string, now: number): string => {
    const minutes = Math.max(
      0,
      Math.round((now - Date.parse(createdAt)) / 60_000)
    );
    return minutes < 60
      ? `${minutes} min ago`
      : `${Math.round(minutes / 60)} h ago`;
  },
  Row = ({ instance, now }: { instance: InstanceSummary; now: number }) => (
    <li
      data-testid="instance-row"
      className="flex flex-wrap items-center justify-between gap-3 py-2"
    >
      <div className="flex flex-col text-sm">
        <span>
          <span className="font-mono">{instance.repository}</span>{" "}
          <span className="font-mono">{instance.branch}</span>
          {instance.leftover ? (
            <span className="ml-2 text-muted-foreground">Leftover</span>
          ) : null}
        </span>
        <span className="text-muted-foreground">
          {instance.state}
          {instance.hostPort === undefined
            ? ""
            : ` on 127.0.0.1:${instance.hostPort}`}
          {instance.createdAt === "" ? "" : `, ${age(instance.createdAt, now)}`}
          {", "}
          <span className="font-mono" title={instance.containerId}>
            {instance.containerId.slice(0, 12)}
          </span>
        </span>
      </div>
      <form
        action={instance.state === "running" ? stopInstance : startInstance}
      >
        <input type="hidden" name="containerId" value={instance.containerId} />
        <Button type="submit" variant="outline" size="sm">
          {instance.state === "running" ? "Stop" : "Start"}
        </Button>
      </form>
    </li>
  );

/** Every Instance the Container Runtime holds for this Sauce Control, with stop and start controls. */
export const InstancesCard = ({
  instances,
  now = Date.now(),
}: {
  instances: InstanceSummary[];
  now?: number;
}) => (
  <Card>
    <CardHeader>
      <CardTitle>Instances</CardTitle>
      <CardDescription>
        Containers this tool has running or stopped, read from the Container
        Runtime. All of them are removed when Sauce Control exits.
      </CardDescription>
    </CardHeader>
    <CardContent>
      {instances.length === 0 ? (
        <p className="text-sm text-muted-foreground">No Instances.</p>
      ) : (
        <div className="flex flex-col gap-3">
          <ul className="divide-y">
            {instances.map((instance) => (
              <Row key={instance.containerId} instance={instance} now={now} />
            ))}
          </ul>
          <form action={stopAllInstances}>
            <Button type="submit" variant="destructive" size="sm">
              Stop and remove all
            </Button>
          </form>
        </div>
      )}
    </CardContent>
  </Card>
);
