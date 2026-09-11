"use client";

import { useActionState, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { ManualScenario } from "@/scenarios/scenarios";
import { saveManualScenario } from "./scenario-actions";

const newResponse = () => ({
    body: "{}",
    delayMs: 0,
    headers: '{"content-type":"application/json"}',
    method: "GET",
    pathPattern: "",
    status: 200,
  }),
  Editor = ({
    repository,
    scenario,
  }: {
    repository: string;
    scenario: ManualScenario | undefined;
  }) => {
    const [responses, setResponses] = useState(
        () =>
          scenario?.responses.map((response) => ({
            ...response,
            headers: JSON.stringify(response.headers),
          })) ?? [newResponse()]
      ),
      [message, save, pending] = useActionState(saveManualScenario, ""),
      [error, setError] = useState("");
    return (
      <form
        action={(data) => {
          try {
            data.set(
              "responses",
              JSON.stringify(
                responses.map((response) => ({
                  ...response,
                  headers: JSON.parse(response.headers),
                }))
              )
            );
            setError("");
            save(data);
          } catch {
            setError("Response headers must be a JSON object.");
          }
        }}
        className="flex flex-col gap-4"
      >
        <input type="hidden" name="repository" value={repository} />
        <Label htmlFor="manual-name">Scenario name</Label>
        <Input
          id="manual-name"
          name="name"
          defaultValue={scenario?.name ?? ""}
          maxLength={80}
          required
        />
        {responses.map((response, index) => (
          <fieldset
            key={index}
            className="flex flex-col gap-2 rounded-md border p-3"
          >
            <legend>Endpoint response {index + 1}</legend>
            {(
              [
                ["method", "HTTP method"],
                ["pathPattern", "Endpoint path pattern"],
                ["status", "Response status"],
                ["delayMs", "Response delay (ms)"],
                ["headers", "Response headers (JSON)"],
                ["body", "Response body"],
              ] as const
            ).map(([field, label]) => {
              const id = `response-${index}-${field}`,
                numeric = field === "status" || field === "delayMs",
                update = (value: string) =>
                  setResponses((current) =>
                    current.map((item, itemIndex) =>
                      itemIndex === index
                        ? { ...item, [field]: numeric ? Number(value) : value }
                        : item
                    )
                  );
              return (
                <div key={field} className="flex flex-col gap-2">
                  <Label htmlFor={id}>{label}</Label>
                  {field === "body" || field === "headers" ? (
                    <Textarea
                      id={id}
                      value={response[field]}
                      onChange={(event) => update(event.target.value)}
                      rows={field === "body" ? 4 : 2}
                    />
                  ) : (
                    <Input
                      id={id}
                      value={response[field]}
                      type={numeric ? "number" : "text"}
                      min={field === "status" ? 200 : 0}
                      max={field === "status" ? 599 : 30_000}
                      required
                      onChange={(event) => update(event.target.value)}
                    />
                  )}
                </div>
              );
            })}
            {responses.length > 1 ? (
              <Button
                type="button"
                variant="outline"
                onClick={() =>
                  setResponses((current) =>
                    current.filter((_, itemIndex) => index !== itemIndex)
                  )
                }
              >
                Remove response {index + 1}
              </Button>
            ) : null}
          </fieldset>
        ))}
        <Button
          type="button"
          variant="outline"
          onClick={() => setResponses((current) => [...current, newResponse()])}
        >
          Add Endpoint response
        </Button>
        <Button disabled={pending}>Save Scenario</Button>
        <p
          data-testid="manual-scenario-message"
          aria-live="polite"
          className="text-sm"
        >
          {error || message}
        </p>
      </form>
    );
  };

export const ManualScenariosCard = ({
  repository,
  scenarios,
}: {
  repository: string;
  scenarios: ManualScenario[];
}) => {
  const [selected, setSelected] = useState("");
  return (
    <Card className="mt-6">
      <CardHeader>
        <CardTitle>Manual Scenarios</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <Label htmlFor="edit-scenario">Edit Scenario</Label>
        <select
          id="edit-scenario"
          className="h-9 rounded-md border bg-background px-3 text-sm"
          value={selected}
          onChange={(event) => setSelected(event.target.value)}
        >
          <option value="">New Scenario</option>
          {scenarios.map(({ name }) => (
            <option key={name} value={name}>
              {name}
            </option>
          ))}
        </select>
        <p className="text-sm text-muted-foreground">
          Override responses by HTTP method and path, such as /users/{"{id}"}.
          Other Endpoints retain their recorded responses. Save, then choose
          this Scenario on Compare.
        </p>
        <Editor
          key={selected}
          repository={repository}
          scenario={scenarios.find(({ name }) => name === selected)}
        />
      </CardContent>
    </Card>
  );
};
