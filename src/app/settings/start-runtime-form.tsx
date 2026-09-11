"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import type { InstalledRuntime } from "@/container-runtime/runtime-status";
import type { StartResult } from "./actions";

export const StartRuntimeForm = ({
  action,
  runtime,
}: {
  action: (previous: StartResult, formData: FormData) => Promise<StartResult>;
  runtime: InstalledRuntime;
}) => {
  const [result, formAction, pending] = useActionState(action, {});
  return (
    <form action={formAction} className="flex flex-col gap-2">
      <input type="hidden" name="runtime" value={runtime.name} />
      <Button
        type="submit"
        variant="outline"
        disabled={pending}
        className="self-start"
      >
        {pending ? `Starting ${runtime.name}…` : `Start ${runtime.name}`}
      </Button>
      {result.error === undefined ? null : (
        <p role="alert" className="text-sm text-destructive">
          {result.error}
        </p>
      )}
    </form>
  );
};
