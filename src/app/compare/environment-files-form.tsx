"use client";

import { useRef, useState, useTransition } from "react";
import { ArrowDown, ArrowUp, File, Folder, Plus, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { DirectoryListing } from "@/repository-config/environment-files";
import { browseFiles, saveEnvironmentFiles } from "./environment-file-actions";

export const EnvironmentFilesForm = ({
  repository,
  saved,
  disabled = false,
  onDirtyChange,
}: {
  repository: string;
  saved: string[];
  disabled?: boolean;
  onDirtyChange?: (dirty: boolean) => void;
}) => {
  const [paths, setPaths] = useState(saved),
    [error, setError] = useState(""),
    [message, setMessage] = useState(""),
    [pending, transition] = useTransition(),
    [listing, setListing] = useState<DirectoryListing>(),
    [directory, setDirectory] = useState(""),
    [browserOpen, setBrowserOpen] = useState(false),
    [selected, setSelected] = useState<string[]>([]),
    dialog = useRef<HTMLDialogElement>(null),
    browseButton = useRef<HTMLButtonElement>(null),
    browse = (path: string) =>
      transition(async () => {
        const result = await browseFiles(path);
        setError(result.error ?? "");
        if (result.listing) {
          setListing(result.listing);
          setDirectory(result.listing.directory);
        }
      }),
    close = () => {
      dialog.current?.close();
      setBrowserOpen(false);
      browseButton.current?.focus();
    },
    move = (index: number, offset: number) => {
      onDirtyChange?.(true);
      setMessage("");
      setPaths((previous) => {
        const next = [...previous],
          other = index + offset;
        [next[index], next[other]] = [next[other]!, next[index]!];
        return next;
      });
    };
  return (
    <section
      className="mb-5 flex flex-col gap-3 border-b pb-5"
      aria-labelledby="environment-files-title"
    >
      <div>
        <h2 id="environment-files-title" className="text-sm font-medium">
          Environment Files
        </h2>
        <p className="mt-1 text-xs leading-5 text-muted-foreground">
          Later files override earlier ones. Only paths are saved; values stay
          private.
        </p>
      </div>
      <fieldset disabled={disabled || pending} className="flex flex-col gap-2">
        {paths.map((path, index) => (
          <div className="flex items-center gap-1" key={index}>
            <Label className="sr-only" htmlFor={`environment-file-${index}`}>
              Environment File {index + 1}
            </Label>
            <Input
              id={`environment-file-${index}`}
              className="min-w-0 font-mono text-xs"
              value={path}
              autoComplete="off"
              placeholder="/absolute/path/.env.local"
              onChange={(event) => {
                const { value } = event.target;
                setPaths((old) =>
                  old.map((entry, at) => (at === index ? value : entry))
                );
                onDirtyChange?.(true);
                setMessage("");
              }}
            />
            <Button
              type="button"
              variant="ghost"
              size="icon"
              aria-label={`Move file ${index + 1} up`}
              disabled={index === 0}
              onClick={() => move(index, -1)}
            >
              <ArrowUp className="size-4" />
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              aria-label={`Move file ${index + 1} down`}
              disabled={index === paths.length - 1}
              onClick={() => move(index, 1)}
            >
              <ArrowDown className="size-4" />
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              aria-label={`Remove file ${index + 1}`}
              onClick={() => {
                setPaths((old) => old.filter((_, at) => at !== index));
                onDirtyChange?.(true);
                setMessage("");
              }}
            >
              <X className="size-4" />
            </Button>
          </div>
        ))}
        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={paths.length >= 32}
            onClick={() => {
              setPaths((old) => [...old, ""]);
              onDirtyChange?.(true);
              setMessage("");
            }}
          >
            <Plus className="size-4" />
            Add path
          </Button>
          <Button
            ref={browseButton}
            type="button"
            variant="outline"
            size="sm"
            onClick={() => {
              setSelected([]);
              setBrowserOpen(true);
              dialog.current?.showModal();
              browse(directory);
            }}
          >
            <Folder className="size-4" />
            Browse files
          </Button>
          <Button
            type="button"
            size="sm"
            onClick={() =>
              transition(async () => {
                const result = await saveEnvironmentFiles(repository, paths);
                setError(result.error ?? "");
                setMessage(result.error ? "" : "File paths saved.");
                if (!result.error) {
                  onDirtyChange?.(false);
                }
              })
            }
          >
            {pending ? "Working…" : "Save file paths"}
          </Button>
        </div>
      </fieldset>
      {error && !browserOpen ? (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      ) : null}
      {message ? (
        <p role="status" className="text-xs text-muted-foreground">
          {message}
        </p>
      ) : null}
      <dialog
        ref={dialog}
        aria-labelledby="file-browser-title"
        onClose={() => {
          setBrowserOpen(false);
          browseButton.current?.focus();
        }}
        className="m-auto w-[min(40rem,calc(100vw-2rem))] rounded-lg border bg-background p-0 text-foreground shadow-xl backdrop:bg-black/50"
      >
        <div className="flex items-center justify-between border-b px-5 py-4">
          <h2 id="file-browser-title" className="font-medium tracking-tight">
            Select Environment Files
          </h2>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            aria-label="Close file browser"
            onClick={close}
          >
            <X className="size-4" />
          </Button>
        </div>
        <form
          className="flex gap-2 p-4"
          onSubmit={(event) => {
            event.preventDefault();
            browse(directory);
          }}
        >
          <Label htmlFor="file-browser-directory" className="sr-only">
            Folder path
          </Label>
          <Input
            id="file-browser-directory"
            className="font-mono text-xs"
            value={directory}
            onChange={(event) => setDirectory(event.target.value)}
            autoComplete="off"
          />
          <Button type="submit" variant="outline" disabled={pending}>
            Open folder
          </Button>
        </form>
        {error ? (
          <p role="alert" className="px-4 pb-3 text-sm text-destructive">
            {error}
          </p>
        ) : null}
        <div
          className="h-72 overflow-auto border-y px-2 py-1"
          aria-busy={pending}
        >
          {listing ? (
            <Button
              type="button"
              variant="ghost"
              className="w-full justify-start font-mono text-xs"
              disabled={pending || listing.parent === listing.directory}
              onClick={() => browse(listing.parent)}
            >
              .. / Parent folder
            </Button>
          ) : null}
          {listing?.entries.map((entry) =>
            entry.directory ? (
              <Button
                key={entry.path}
                type="button"
                variant="ghost"
                className="w-full justify-start font-mono text-xs"
                disabled={pending}
                onClick={() => browse(entry.path)}
              >
                <Folder className="size-4 shrink-0" />
                {entry.name}
              </Button>
            ) : (
              <label
                key={entry.path}
                className="flex cursor-pointer items-center gap-3 rounded-md px-3 py-2 text-xs hover:bg-accent focus-within:ring-2 focus-within:ring-ring"
              >
                <input
                  type="checkbox"
                  checked={selected.includes(entry.path)}
                  disabled={pending}
                  onChange={(event) =>
                    setSelected((old) =>
                      event.target.checked
                        ? [...old, entry.path]
                        : old.filter((path) => path !== entry.path)
                    )
                  }
                />
                <File className="size-4 shrink-0 text-muted-foreground" />
                <span className="truncate font-mono">{entry.name}</span>
              </label>
            )
          )}
          {listing?.entries.length === 0 ? (
            <p className="p-4 text-sm text-muted-foreground">
              This folder is empty.
            </p>
          ) : null}
        </div>
        <div className="flex items-center justify-between p-4">
          <span className="text-xs text-muted-foreground">
            {selected.length} selected
          </span>
          <div className="flex gap-2">
            <Button type="button" variant="outline" onClick={close}>
              Cancel
            </Button>
            <Button
              type="button"
              disabled={
                selected.length === 0 ||
                pending ||
                paths.length +
                  selected.filter((path) => !paths.includes(path)).length >
                  32
              }
              onClick={() => {
                setPaths((old) => [...new Set([...old, ...selected])]);
                onDirtyChange?.(true);
                setMessage("");
                close();
              }}
            >
              Add files
            </Button>
          </div>
        </div>
      </dialog>
    </section>
  );
};
