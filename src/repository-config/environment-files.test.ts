import { afterEach, describe, expect, it } from "vitest";
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  browseEnvironmentDirectory,
  parseEnvironmentFile,
  readEnvironmentFiles,
  validateInstanceEnvironment,
} from "./environment-files";

const directories: string[] = [],
  fixture = async () => {
    const path = await mkdtemp(join(tmpdir(), "environment-files-"));
    directories.push(path);
    return path;
  };
afterEach(async () => {
  await Promise.all(
    directories
      .splice(0)
      .map((path) => rm(path, { force: true, recursive: true }))
  );
});

describe("Environment Files", () => {
  it("preserves quoted multiline, substitutions and backslashes literally", () => {
    expect(
      parseEnvironmentFile(
        "export TOKEN = \"a\nb\"\nURL=a#b # comment\nEMPTY=\nOTHER='$HOME $(touch /tmp/nope) \\n'\n# ignored"
      )
    ).toEqual({
      EMPTY: "",
      OTHER: "$HOME $(touch /tmp/nope) \\n",
      TOKEN: "a\nb",
      URL: "a#b",
    });
    expect(
      parseEnvironmentFile("__proto__=safe\nA=first\nA=last").__proto__
    ).toBe("safe");
  });
  it.each([
    'TOKEN="hidden',
    'TOKEN="hidden" trailing',
    "hidden-secret-with-no-assignment",
    "TOKEN=hidden\0",
  ])("never includes malformed source in errors", (source) => {
    try {
      parseEnvironmentFile(source, "/tmp/config");
      throw new Error("did not reject");
    } catch (error) {
      expect(String(error)).toContain("/tmp/config");
      expect(String(error)).not.toContain("hidden");
    }
  });
  it("merges saved variables and files in order, rereading edits and empty overrides", async () => {
    const directory = await fixture(),
      a = join(directory, "a"),
      b = join(directory, "b");
    await writeFile(a, 'TOKEN="one"\nAPI=first');
    await writeFile(b, "TOKEN=two\nAPI=");
    const first = await readEnvironmentFiles([a, b], {
      KEPT: "yes",
      TOKEN: "saved",
    });
    expect(first.environment).toEqual({ API: "", KEPT: "yes", TOKEN: "two" });
    await writeFile(b, "TOKEN=changed");
    expect((await readEnvironmentFiles([a, b])).environment.TOKEN).toBe(
      "changed"
    );
    expect(first.environment.TOKEN).toBe("two");
  });
  it("rejects unreadable, non-regular, oversized and non-UTF8 inputs", async () => {
    const directory = await fixture(),
      path = join(directory, "bad");
    await expect(readEnvironmentFiles([path])).rejects.toThrow(
      "missing or unreadable"
    );
    await expect(readEnvironmentFiles([directory])).rejects.toThrow(
      "regular file"
    );
    await writeFile(path, Buffer.from([255]));
    await expect(readEnvironmentFiles([path])).rejects.toThrow(
      "valid UTF-8 text"
    );
    await writeFile(path, Buffer.alloc(1024 * 1024 + 1));
    await expect(readEnvironmentFiles([path])).rejects.toThrow("1 MiB");
  });
  it("lists dotfiles and folders without returning contents", async () => {
    const directory = await fixture();
    await writeFile(join(directory, ".env.local"), "TOKEN=hidden");
    await mkdir(join(directory, "child"));
    await symlink(join(directory, "child"), join(directory, "link"));
    const listing = await browseEnvironmentDirectory(directory);
    expect(listing.entries.map((entry) => entry.name)).toContain(".env.local");
    expect(
      listing.entries.find((entry) => entry.name === "link")?.directory
    ).toBe(true);
    expect(JSON.stringify(listing)).not.toContain("hidden");
  });
  it("rejects conflicting runtime controls without exposing values", () => {
    expect(() =>
      validateInstanceEnvironment({ NODE_ENV: "production" }, 3000)
    ).toThrow("conflicts");
    expect(() => validateInstanceEnvironment({ PORT: "secret" }, 3000)).toThrow(
      "conflicts"
    );
    expect(() =>
      validateInstanceEnvironment(
        { NODE_ENV: "development", PORT: "3000" },
        3000
      )
    ).not.toThrow();
  });
});
