"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  type PackageManifest,
  looksLikeProductionServer,
} from "@/repository-config/infer-config";
import type { RepositoryConfig } from "@/settings/settings-store";
import { saveRepositoryConfig } from "./actions";

export interface ConfigFormProps {
  config: RepositoryConfig;
  environmentCount: number;
  manifest: PackageManifest;
  repository: string;
  saved: boolean;
}

export const ConfigForm = ({
  config,
  environmentCount,
  manifest,
  repository,
  saved,
}: ConfigFormProps) => {
  const [startCommand, setStartCommand] = useState(config.startCommand),
    productionWarning = looksLikeProductionServer(startCommand, manifest);

  return (
    <form action={saveRepositoryConfig} className="flex flex-col gap-4">
      <input type="hidden" name="repository" value={repository} />
      <div className="flex flex-col gap-2">
        <Label htmlFor="environmentSetupCommand">
          Environment Setup Command
        </Label>
        <Textarea
          id="environmentSetupCommand"
          name="environmentSetupCommand"
          defaultValue={config.environmentSetupCommand ?? ""}
          placeholder="pizzabox token update && pizzabox token env --repo pnpm && source ~/path/to/env"
          rows={3}
          autoComplete="off"
          spellCheck={false}
          maxLength={65_536}
          aria-describedby="environment-setup-help"
        />
        <p
          id="environment-setup-help"
          className="text-sm text-muted-foreground"
        >
          Optional. Runs on your computer in your login shell, from your home
          directory, before each Comparison. Use an absolute path or ~/… when
          sourcing a file. Exported values override Environment Files. Keep
          installation in the field below. Command text is saved; captured
          values are not. Browser login is supported; terminal prompts are not.
        </p>
      </div>
      <div className="flex flex-col gap-2">
        <Label htmlFor="installCommand">Dependency installation command</Label>
        <Input
          id="installCommand"
          name="installCommand"
          defaultValue={config.installCommand}
          autoComplete="off"
        />
      </div>
      <div className="flex flex-col gap-2">
        <Label htmlFor="startCommand">Development server command</Label>
        <Input
          id="startCommand"
          name="startCommand"
          value={startCommand}
          onChange={(event) => setStartCommand(event.target.value)}
          autoComplete="off"
          required
        />
        {productionWarning ? (
          <p
            className="text-sm text-amber-600 dark:text-amber-400"
            data-testid="production-warning"
          >
            Choose a development-server command. Production commands cannot run.
          </p>
        ) : null}
      </div>
      <div className="flex flex-col gap-2">
        <Label htmlFor="port">Port</Label>
        <Input
          id="port"
          name="port"
          type="number"
          min={1}
          max={65_535}
          defaultValue={config.port}
          required
        />
      </div>
      <div className="flex flex-col gap-2">
        <Label htmlFor="environment">Environment variables</Label>
        <Textarea
          id="environment"
          name="environment"
          placeholder={"API_URL=https://…\nSECRET=…"}
          rows={4}
          autoComplete="off"
        />
        <p
          className="text-sm text-muted-foreground"
          data-testid="environment-count"
        >
          {environmentCount === 1
            ? "1 variable stored in the keychain."
            : `${environmentCount} variables stored in the keychain.`}{" "}
          Pasting replaces them; leave empty to keep them.
        </p>
      </div>
      <fieldset className="flex flex-col gap-4 rounded-md border p-4">
        <legend className="px-1 text-sm font-medium">Discovery</legend>
        <div className="grid grid-cols-2 gap-4">
          <div className="flex flex-col gap-2">
            <Label htmlFor="maxDepth">Crawl depth</Label>
            <Input
              id="maxDepth"
              name="maxDepth"
              type="number"
              min={0}
              defaultValue={config.crawl.maxDepth}
              required
            />
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="pageLimit">Page limit</Label>
            <Input
              id="pageLimit"
              name="pageLimit"
              type="number"
              min={1}
              defaultValue={config.crawl.pageLimit}
              required
            />
          </div>
        </div>
        <div className="flex items-center gap-2">
          <input
            type="checkbox"
            id="stripQuery"
            name="stripQuery"
            defaultChecked={config.crawl.stripQuery}
          />
          <Label htmlFor="stripQuery">Strip query strings</Label>
        </div>
        <div className="flex items-center gap-2">
          <input
            type="checkbox"
            id="collapseNumericSegments"
            name="collapseNumericSegments"
            defaultChecked={config.crawl.collapseNumericSegments}
          />
          <Label htmlFor="collapseNumericSegments">
            Collapse numeric segments
          </Label>
        </div>
        <div className="flex flex-col gap-2">
          <Label htmlFor="addedPages">Added Pages</Label>
          <Textarea
            id="addedPages"
            name="addedPages"
            placeholder={"/hidden\n/admin/reports"}
            rows={3}
            defaultValue={config.pages.added.join("\n")}
            autoComplete="off"
          />
        </div>
        <div className="flex flex-col gap-2">
          <Label htmlFor="removedPages">Removed Pages</Label>
          <Textarea
            id="removedPages"
            name="removedPages"
            placeholder="/legal"
            rows={3}
            defaultValue={config.pages.removed.join("\n")}
            autoComplete="off"
          />
        </div>
        <p className="text-sm text-muted-foreground">
          One path per line. Added Pages are compared even when discovery misses
          them; removed Pages are left out even when it finds them.
        </p>
      </fieldset>
      <Button type="submit" className="self-start" disabled={productionWarning}>
        Save configuration
      </Button>
      {saved ? (
        <p className="text-sm text-muted-foreground" data-testid="saved-config">
          Saved for <span className="font-mono">{repository}</span>.
        </p>
      ) : null}
    </form>
  );
};
