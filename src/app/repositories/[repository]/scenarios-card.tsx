"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  attachSchemaSource,
  detectLocalSchemaSources,
} from "./scenario-actions";

export const ScenariosCard = ({
  repository,
  sourceNames,
  codeDirectory,
}: {
  repository: string;
  sourceNames: string[];
  codeDirectory: string;
}) => {
  const [message, attach, pending] = useActionState(attachSchemaSource, ""),
    [detection, detect, detecting] = useActionState(
      detectLocalSchemaSources,
      ""
    );
  return (
    <Card className="mt-6">
      <CardHeader>
        <CardTitle>Schema Sources</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <p className="text-sm text-muted-foreground">
          Attach JSON or YAML OpenAPI documents. Local references are supported;
          bundle external references into one document before attaching.
        </p>
        <ul data-testid="schema-source-list" className="text-sm">
          {sourceNames.map((name) => (
            <li key={name}>{name}</li>
          ))}
        </ul>
        <form action={attach} className="flex flex-col gap-3">
          <input type="hidden" name="repository" value={repository} />
          <Label htmlFor="schema-upload">Upload Schema Source</Label>
          <Input
            id="schema-upload"
            name="upload"
            type="file"
            accept=".json,.yaml,.yml"
          />
          <Button disabled={pending} className="self-start">
            Attach upload
          </Button>
        </form>
        <form action={attach} className="flex flex-col gap-3">
          <input type="hidden" name="repository" value={repository} />
          <Label htmlFor="schema-url">Schema Source URL</Label>
          <Input id="schema-url" name="url" type="url" required />
          <Button disabled={pending} className="self-start">
            Attach URL
          </Button>
        </form>
        <form action={attach} className="flex flex-col gap-3">
          <input type="hidden" name="repository" value={repository} />
          <Label htmlFor="schema-repository">Schema Source Repository</Label>
          <Input
            id="schema-repository"
            name="sourceRepository"
            placeholder="organisation/repository"
            required
          />
          <Label htmlFor="schema-path">Schema Source path</Label>
          <Input
            id="schema-path"
            name="sourcePath"
            placeholder="openapi.yaml"
            required
          />
          <Button disabled={pending} className="self-start">
            Attach Repository source
          </Button>
        </form>
        <form action={detect} className="flex flex-col gap-3">
          <input type="hidden" name="repository" value={repository} />
          <Label htmlFor="code-directory">Code Directory</Label>
          <Input
            id="code-directory"
            name="codeDirectory"
            defaultValue={codeDirectory}
            placeholder="/path/to/checkouts"
          />
          <p className="text-sm text-muted-foreground">
            Find openapi and swagger documents in the current Comparison's
            clones and your Code Directory. Detected documents are attached for
            the next Comparison.
          </p>
          <Button disabled={detecting} className="self-start">
            Detect Schema Sources
          </Button>
          <p className="text-sm">{detection}</p>
        </form>
        <p role="status" className="text-sm">
          {message}
        </p>
      </CardContent>
    </Card>
  );
};
