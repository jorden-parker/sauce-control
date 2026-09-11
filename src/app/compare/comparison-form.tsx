"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { ComboBox } from "@/components/ui/combobox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { Repository } from "@/github/github-client";
import type { ComparisonSelection } from "@/settings/settings-store";
import { listBranches, saveComparisonSelection } from "./actions";

export interface ComparisonFormProps {
  repositories: Repository[];
  saved: ComparisonSelection | undefined;
}

export const ComparisonForm = ({
  repositories,
  saved,
}: ComparisonFormProps) => {
  const [repository, setRepository] = useState(saved?.repository),
    [targetBranch, setTargetBranch] = useState(saved?.targetBranch),
    [baseBranch, setBaseBranch] = useState(saved?.baseBranch ?? ""),
    [branches, setBranches] = useState<string[]>([]),
    [loadingBranches, startLoadingBranches] = useTransition(),
    chooseRepository = (name: string) => {
      const chosen = repositories.find((candidate) => candidate.name === name);
      setRepository(name);
      setTargetBranch(undefined);
      setBaseBranch(chosen?.defaultBranch ?? "");
      startLoadingBranches(async () => {
        setBranches(await listBranches(name));
      });
    };

  return (
    <form action={saveComparisonSelection} className="flex flex-col gap-4">
      <div className="flex flex-col gap-2">
        <Label htmlFor="repository">Repository</Label>
        <ComboBox
          id="repository"
          label="Repository"
          value={repository}
          onChange={chooseRepository}
          options={repositories.map((candidate) => candidate.name)}
          placeholder="Select a repository"
          searchPlaceholder="Search repositories…"
          emptyText="No repository found."
        />
        <input type="hidden" name="repository" value={repository ?? ""} />
        {repository === undefined ? null : (
          <Link
            href={`/repositories/${encodeURIComponent(repository)}`}
            className="self-start text-sm underline"
          >
            Configure {repository}
          </Link>
        )}
      </div>
      <div className="flex flex-col gap-2">
        <Label htmlFor="targetBranch">Target Branch</Label>
        <ComboBox
          id="targetBranch"
          label="Target Branch"
          value={targetBranch}
          onChange={setTargetBranch}
          options={branches}
          disabled={repository === undefined || loadingBranches}
          placeholder={
            loadingBranches ? "Loading branches…" : "Select a branch"
          }
          searchPlaceholder="Search branches…"
          emptyText="No branch found."
        />
        <input type="hidden" name="targetBranch" value={targetBranch ?? ""} />
      </div>
      <div className="flex flex-col gap-2">
        <Label htmlFor="baseBranch">Base Branch</Label>
        <Input
          id="baseBranch"
          name="baseBranch"
          value={baseBranch}
          onChange={(event) => setBaseBranch(event.target.value)}
          placeholder="Defaults to the repository's default branch"
          autoComplete="off"
          required
        />
      </div>
      <Button
        type="submit"
        className="self-start"
        disabled={repository === undefined || targetBranch === undefined}
      >
        Save Comparison
      </Button>
      {saved ? (
        <p
          className="text-sm text-muted-foreground"
          data-testid="saved-selection"
        >
          Saved: <span className="font-mono">{saved.repository}</span>{" "}
          <span className="font-mono">{saved.targetBranch}</span> against{" "}
          <span className="font-mono">{saved.baseBranch}</span>
        </p>
      ) : null}
    </form>
  );
};
