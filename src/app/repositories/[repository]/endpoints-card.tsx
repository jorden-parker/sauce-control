import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import type { Endpoint } from "@/endpoints/endpoint-recordings";
import { purgeEndpointRecordings } from "./actions";

const samples = (amount: number): string =>
  amount === 1 ? "1 sample" : `${amount} samples`;

/** The Endpoints this Repository's Instances called, with the personal-data warning and a purge. */
export const EndpointsCard = ({
  endpoints,
  repository,
}: {
  endpoints: Endpoint[];
  repository: string;
}) => (
  <Card data-testid="endpoints">
    <CardHeader>
      <CardTitle>Endpoints</CardTitle>
      <CardDescription>
        Outbound HTTP APIs the Instances of this Repository called, recorded
        through the Proxy while they were used or crawled.{" "}
        <span className="font-mono">Authorization</span> and{" "}
        <span className="font-mono">Cookie</span> headers are always redacted.
      </CardDescription>
    </CardHeader>
    <CardContent className="flex flex-col gap-3">
      <p
        className="rounded-md border border-amber-500/50 bg-amber-500/10 px-3 py-2 text-sm"
        role="note"
      >
        Recordings may contain personal data from the responses the Instances
        received. Purge them when you no longer need them.
      </p>
      {endpoints.length === 0 ? (
        <p className="text-sm text-muted-foreground">No Endpoints recorded.</p>
      ) : (
        <ul className="divide-y text-sm">
          {endpoints.map((endpoint) => (
            <li
              key={`${endpoint.method} ${endpoint.origin}${endpoint.pathPattern}`}
              className="flex flex-wrap items-baseline justify-between gap-3 py-2"
              data-testid="endpoint-row"
            >
              <span className="font-mono">
                <span className="font-semibold">{endpoint.method}</span>{" "}
                <span className="text-muted-foreground">{endpoint.origin}</span>
                {endpoint.pathPattern}
              </span>
              <span className="text-muted-foreground">
                {samples(endpoint.samples)}
              </span>
            </li>
          ))}
        </ul>
      )}
      <form action={purgeEndpointRecordings}>
        <input type="hidden" name="repository" value={repository} />
        <Button
          disabled={endpoints.length === 0}
          size="sm"
          type="submit"
          variant="destructive"
        >
          Purge recordings
        </Button>
      </form>
    </CardContent>
  </Card>
);
