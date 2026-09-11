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
        <Label htmlFor="buildCommand">Build command</Label>
        <Input
          id="buildCommand"
          name="buildCommand"
          defaultValue={config.buildCommand}
          autoComplete="off"
        />
      </div>
      <div className="flex flex-col gap-2">
        <Label htmlFor="startCommand">Start command</Label>
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
            This looks like a production server. Production builds usually ship
            without source maps, so Affected Page detection may fall back to
            comparing every Page.
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
      <div className="flex flex-col gap-2">
        <div className="flex items-center gap-2">
          <input
            type="checkbox"
            id="useDotEnvLocal"
            name="useDotEnvLocal"
            defaultChecked={config.useDotEnvLocal}
          />
          <Label htmlFor="useDotEnvLocal">
            Use the clone&apos;s .env.local
          </Label>
        </div>
        <p className="text-sm text-muted-foreground">
          Warning: any secrets in that file are copied into the Instance image
          on this machine. Off by default; keychain variables are always used.
        </p>
      </div>
      <Button type="submit" className="self-start">
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
