import { EventEmitter } from "node:events";
import { describe, expect, it } from "vitest";
import type { RuntimeAdapter } from "@/container-runtime/runtime-adapter";
import {
  registerExitCleanup,
  removeSessionContainers,
  sweepLeftovers,
} from "./session";

/** Fake docker holding containers as (id, labels) and remembering image removals by label. */
const fakeRuntime = (containers: Record<string, Record<string, string>>) => {
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

describe("removing a session's containers", () => {
  it("removes only containers labelled with that session id", async () => {
    const runtime = fakeRuntime({
      base: { "sauce-control.session": "s1" },
      other: { "sauce-control.session": "s2" },
      target: { "sauce-control.session": "s1" },
      unrelated: { "com.docker.compose.project": "x" },
    });
    await removeSessionContainers(runtime.adapter, "docker", "s1");
    expect(runtime.remaining()).toEqual(["other", "unrelated"]);
    expect(runtime.imageRemovals).toEqual(["sauce-control.session=s1"]);
  });
});

describe("sweeping leftovers on startup", () => {
  it("removes every container from any previous session and leaves unrelated ones", async () => {
    const runtime = fakeRuntime({
      crashed: { "sauce-control.session": "old" },
      older: { "sauce-control.session": "older" },
      unrelated: { "com.docker.compose.project": "x" },
    });
    await expect(sweepLeftovers(runtime.adapter, "docker")).resolves.toBe(2);
    expect(runtime.remaining()).toEqual(["unrelated"]);
    expect(runtime.imageRemovals).toEqual(["sauce-control.session"]);
  });
});

describe("cleanup on exit", () => {
  it.each(["SIGINT", "SIGTERM", "uncaughtException"])(
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
