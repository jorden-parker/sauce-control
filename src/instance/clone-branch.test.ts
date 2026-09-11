import { mkdirSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { CommandRunner } from "@/shell/command-runner";
import { cloneBranch } from "./clone-branch";

const fakeGit = (failWith?: string): CommandRunner & { calls: string[][] } => {
    const calls: string[][] = [];
    return {
      calls,
      run: (command, args) => {
        calls.push([command, ...args]);
        return failWith === undefined
          ? Promise.resolve({ stdout: "" })
          : Promise.reject(new Error(failWith));
      },
    };
  },
  request = (codeDirectory?: string) => ({
    branch: "feature/login",
    codeDirectory,
    destination: "/tmp/clones/target",
    organisation: "sauce-labs",
    repository: "web-app",
    token: "ghp_secret",
  });

describe("cloning a branch", () => {
  it("clones one branch over HTTPS with the token, without a reference when there is no Code Directory", async () => {
    const git = fakeGit();
    await cloneBranch(git, request());
    expect(git.calls).toEqual([
      [
        "git",
        "clone",
        "--filter=blob:none",
        "--single-branch",
        "--branch",
        "feature/login",
        "https://x-access-token:ghp_secret@github.com/sauce-labs/web-app.git",
        "/tmp/clones/target",
      ],
    ]);
  });

  it("uses a matching checkout in the Code Directory as a clone reference", async () => {
    const codeDirectory = mkdtempSync(join(tmpdir(), "code-")),
      git = fakeGit();
    mkdirSync(join(codeDirectory, "web-app", ".git"), { recursive: true });
    await cloneBranch(git, request(codeDirectory));
    expect(git.calls[0]).toContain("--reference");
    expect(git.calls[0]).toContain(join(codeDirectory, "web-app"));
  });

  it("skips the reference when the Code Directory has no checkout of the Repository", async () => {
    const codeDirectory = mkdtempSync(join(tmpdir(), "code-")),
      git = fakeGit();
    await cloneBranch(git, request(codeDirectory));
    expect(git.calls[0]).not.toContain("--reference");
  });

  it("never leaks the token in a clone error", async () => {
    const git = fakeGit(
        "fatal: could not read from 'https://x-access-token:ghp_secret@github.com/sauce-labs/web-app.git'"
      ),
      failure = cloneBranch(git, request());
    await expect(failure).rejects.toThrow(
      "Could not clone web-app feature/login"
    );
    await expect(failure).rejects.not.toThrow("ghp_secret");
  });
});
