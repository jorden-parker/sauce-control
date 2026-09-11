import { EventEmitter } from "node:events";
import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { RuntimeAdapter } from "@/container-runtime/runtime-adapter";
import {
  registerExitCleanup,
  remainingInstances,
  removeAllInstances,
  removeLeftoverDirectories,
  removeSessionContainers,
} from "./session";

/** Fake docker holding containers as (id, labels) and remembering image removals by label. */
export const fakeRuntime = (
  containers: Record<string, Record<string, string>>
) => {
  const store = { ...containers },
    imageRemovals: string[] = [],
    adapter = {
      listContainers: (_name, label) => {
        const [key, value] = label.split("=");
        return Promise.resolve(
          Object.entries(store)
            .filter(
              ([, labels]) =>
                key !== undefined &&
                key in labels &&
                (value === undefined || labels[key] === value)
            )
            .map(([id]) => id)
        );
      },
      removeContainers: (_name, ids) => {
        for (const id of ids) {
          delete store[id];
        }
        return Promise.resolve();
      },
      removeImages: (_name, label) => {
        imageRemovals.push(label);
        return Promise.resolve();
      },
    } as Pick<
      RuntimeAdapter,
      "listContainers" | "removeContainers" | "removeImages"
    > as RuntimeAdapter;
  return { adapter, imageRemovals, remaining: () => Object.keys(store) };
};

const OURS = { "sauce-control.app": "sauce-control" };

describe("removing a session's containers", () => {
  it("removes only containers labelled with that session id", async () => {
    const runtime = fakeRuntime({
      base: { ...OURS, "sauce-control.session": "s1" },
      other: { ...OURS, "sauce-control.session": "s2" },
      target: { ...OURS, "sauce-control.session": "s1" },
      unrelated: { "com.docker.compose.project": "x" },
    });
    await removeSessionContainers(runtime.adapter, "docker", "s1");
    expect(runtime.remaining()).toEqual(["other", "unrelated"]);
    expect(runtime.imageRemovals).toEqual(["sauce-control.session=s1"]);
  });
});

describe("removing every Instance this Sauce Control owns", () => {
  it("removes containers from any session with our app label and leaves the rest", async () => {
    const runtime = fakeRuntime({
      crashed: { ...OURS, "sauce-control.session": "old" },
      e2e: {
        "sauce-control.app": "sauce-control-e2e",
        "sauce-control.session": "e2e-1",
      },
      older: { ...OURS, "sauce-control.session": "older" },
      unrelated: { "com.docker.compose.project": "x" },
    });
    await expect(removeAllInstances(runtime.adapter, "docker")).resolves.toBe(
      2
    );
    expect(runtime.remaining()).toEqual(["e2e", "unrelated"]);
    expect(runtime.imageRemovals).toEqual(["sauce-control.app=sauce-control"]);
    await expect(
      remainingInstances(runtime.adapter, "docker")
    ).resolves.toEqual([]);
  });

  it("reports what is still present so a failed removal is visible", async () => {
    const runtime = fakeRuntime({
      stuck: { ...OURS, "sauce-control.session": "old" },
    });
    await expect(
      remainingInstances(runtime.adapter, "docker")
    ).resolves.toEqual(["stuck"]);
  });
});

describe("removing Leftover clone directories", () => {
  it("deletes every session directory except the current one", () => {
    const comparisons = mkdtempSync(join(tmpdir(), "comparisons-"));
    for (const session of ["old", "current"]) {
      mkdirSync(join(comparisons, session, "main"), { recursive: true });
      writeFileSync(join(comparisons, session, "main", "file"), "x");
    }
    expect(removeLeftoverDirectories(comparisons, "current")).toEqual(["old"]);
    expect(existsSync(join(comparisons, "old"))).toBe(false);
    expect(existsSync(join(comparisons, "current", "main", "file"))).toBe(true);
  });

  it("is a no-op when nothing has run yet", () => {
    expect(
      removeLeftoverDirectories(join(tmpdir(), "never-created"), "current")
    ).toEqual([]);
  });
});

describe("cleanup on exit", () => {
  it.each(["SIGINT", "SIGTERM", "SIGHUP", "uncaughtException"])(
    "runs the cleanup once and exits on %s",
    async (signal) => {
      const process = Object.assign(new EventEmitter(), {
          exit: (code: number) => {
            process.exitCodes.push(code);
          },
          exitCodes: [] as number[],
        }),
        cleanups: number[] = [];
      registerExitCleanup(process, () => {
        cleanups.push(1);
        return Promise.resolve();
      });

      process.emit(signal, new Error("boom"));
      process.emit(signal, new Error("boom"));
      await new Promise((resolve) => setTimeout(resolve, 0));

      expect(cleanups).toEqual([1]);
      expect(process.exitCodes).toEqual([
        signal === "uncaughtException" ? 1 : 130,
      ]);
    }
  );
});
