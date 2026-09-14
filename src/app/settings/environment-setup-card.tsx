"use client";

import { useState, useTransition } from "react";
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
import { Textarea } from "@/components/ui/textarea";
import type { EnvironmentSetup } from "@/settings/settings-store";
import { saveEnvironmentSetupCommand } from "./actions";

export const EnvironmentSetupCard = ({
  setup,
}: {
  setup: EnvironmentSetup;
}) => {
  const [command, setCommand] = useState(setup.command),
    [registry, setRegistry] = useState(setup.registry),
    [message, setMessage] = useState(""),
    [error, setError] = useState(""),
    [pending, transition] = useTransition();
  return (
    <Card>
      <CardHeader>
        <CardTitle>Environment setup</CardTitle>
        <CardDescription>
          One command for all Repositories and Organisations. Runs before each
          new Comparison.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form
          className="flex flex-col gap-4"
          onSubmit={(event) => {
            event.preventDefault();
            transition(async () => {
              try {
                const result = await saveEnvironmentSetupCommand(
                  command,
                  registry
                );
                setError(result.error ?? "");
                if (!result.error) {
                  setMessage("Environment setup saved for all repositories.");
                }
              } catch {
                setError("Could not save the setup command. Try again.");
              }
            });
          }}
        >
          {setup.conflicts.length > 0 ? (
            <fieldset
              disabled={pending}
              className="flex flex-col gap-2 rounded-md border p-3"
            >
              <legend className="px-1 text-sm font-medium">
                Choose an existing command
              </legend>
              <p className="text-sm text-muted-foreground">
                Your repositories have different saved commands. Choose one or
                edit the field below, then save before running another
                Comparison. Save an empty field to disable setup.
              </p>
              {setup.conflicts.map((entry) => (
                <div
                  key={entry.repository}
                  className="flex flex-col gap-1 border-t pt-2"
                >
                  <span className="text-sm font-medium">
                    {entry.repository}
                  </span>
                  <pre className="whitespace-pre-wrap break-all text-xs">
                    {entry.command}
                  </pre>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="self-start"
                    onClick={() => {
                      setCommand(entry.command);
                      setMessage("");
                      setError("");
                    }}
                  >
                    Use command from {entry.repository}
                  </Button>
                </div>
              ))}
            </fieldset>
          ) : null}
          <div className="flex flex-col gap-2">
            <Label htmlFor="environmentSetupCommand">
              Environment Setup Command
            </Label>
            <Textarea
              id="environmentSetupCommand"
              name="environmentSetupCommand"
              value={command}
              disabled={pending}
              rows={3}
              maxLength={65_536}
              autoComplete="off"
              spellCheck={false}
              aria-describedby="environment-setup-help"
              placeholder="pizzabox token update && pizzabox token env --repo pnpm && source ~/path/to/env"
              onChange={(event) => {
                setCommand(event.target.value);
                setMessage("");
                setError("");
              }}
            />
            <p
              id="environment-setup-help"
              className="text-sm text-muted-foreground"
            >
              Optional. Runs on your computer in your login shell, from your
              home directory. Use an absolute path or ~/… when sourcing a file.
              Leave empty to skip setup. Changes apply to the next Comparison.
            </p>
            <p className="text-sm text-muted-foreground">
              Exported values override Environment Files. Command text is saved;
              captured values are not. Browser login is supported; terminal
              prompts are not.
            </p>
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="packageRegistry">Package registry URL</Label>
            <Input
              id="packageRegistry"
              name="packageRegistry"
              type="url"
              value={registry}
              disabled={pending}
              maxLength={2048}
              autoComplete="off"
              spellCheck={false}
              aria-describedby="package-registry-help"
              placeholder="https://example-123456789012.d.codeartifact.eu-west-1.amazonaws.com/npm/npm/"
              onChange={(event) => {
                setRegistry(event.target.value);
                setMessage("");
                setError("");
              }}
            />
            <p
              id="package-registry-help"
              className="text-sm text-muted-foreground"
            >
              Optional. Reaches dependency installation only, as NPM_REGISTRY,
              together with NODE_AUTH_TOKEN. Leave empty to use the
              repository&apos;s own .npmrc.
            </p>
          </div>
          <Button type="submit" className="self-start" disabled={pending}>
            {pending ? "Saving…" : "Save environment setup"}
          </Button>
          {message ? (
            <p role="status" className="text-sm text-muted-foreground">
              {message}
            </p>
          ) : null}
          {error ? (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          ) : null}
        </form>
      </CardContent>
    </Card>
  );
};
