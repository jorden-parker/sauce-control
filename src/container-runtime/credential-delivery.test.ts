import { ComparisonStartError } from "@/comparison/comparison-start-error";
import { describe, expect, it } from "vitest";
import { createCliRuntimeAdapter } from "./cli-runtime-adapter";
import type { RunOptions } from "@/shell/command-runner";

describe.each(["docker", "podman"] as const)(
  "%s credential delivery",
  (runtime) => {
    it("does not expose runtime errors or attach their raw causes", async () => {
      const adapter = createCliRuntimeAdapter(
        {
          run: async (_name, args) => {
            if (args[0] === "exec") {
              throw new Error("raw-secret-in-runtime-output");
            }
            return {
              stdout:
                args[0] === "run"
                  ? "id"
                  : args[0] === "port"
                    ? "127.0.0.1:4000"
                    : "[]",
            };
          },
        },
        { platform: "linux" }
      );
      try {
        await adapter.runContainer(runtime, {
          development: {
            installCommand: "npm ci",
            startCommand: "npm run dev",
          },
          environment: { API: "private" },
          image: "test",
          labels: {},
          port: 3000,
        });
        throw new Error("expected failure");
      } catch (error) {
        expect(error).toBeInstanceOf(ComparisonStartError);
        expect(String(error)).toContain("securely");
        expect(String(error)).not.toContain("raw-secret");
        expect((error as Error).cause).toBeUndefined();
      }
    });
    it("streams only recognized launcher steps before completion and removes the container on abort", async () => {
      const controller = new AbortController(),
        progress: string[] = [],
        removed: string[] = [],
        adapter = createCliRuntimeAdapter(
          {
            run: async (_name, args, options) => {
              if (args[0] === "rm") {
                removed.push(args.at(-1)!);
              }
              if (args[0] === "exec") {
                if (JSON.parse(options.input!).probe) {
                  return { stdout: "ready" };
                }
                options.onStdout?.("install");
                options.onStdout?.("ing\nraw-private-value\nstart");
                options.onStdout?.("ing\n");
                expect(progress).toEqual(["install", "start"]);
                controller.abort();
                options.signal?.throwIfAborted();
              }
              return {
                stdout:
                  args[0] === "run"
                    ? "id"
                    : args[0] === "port"
                      ? "127.0.0.1:4000"
                      : "[]",
              };
            },
          },
          { platform: "linux" }
        );
      await expect(
        adapter.runContainer(runtime, {
          development: {
            installCommand: "npm ci",
            startCommand: "npm run dev",
          },
          environment: { API: "private-value" },
          image: "test",
          labels: {},
          onProgress: (step) => progress.push(step),
          port: 3000,
          signal: controller.signal,
        })
      ).rejects.toMatchObject({ name: "AbortError" });
      expect(removed).toEqual(["id"]);
      expect(progress).toEqual(["install", "start"]);
    });
    it("reports failure before container removal finishes", async () => {
      const cleanup = Promise.withResolvers<void>(),
        reported = Promise.withResolvers<unknown>(),
        adapter = createCliRuntimeAdapter(
          {
            run: async (_name, args, options) => {
              if (args[0] === "rm") {
                await cleanup.promise;
                return { stdout: "" };
              }
              return {
                stdout:
                  args[0] === "exec"
                    ? JSON.parse(options.input!).probe
                      ? "ready"
                      : "installing\ninstallation-failed"
                    : args[0] === "run"
                      ? "id"
                      : args[0] === "port"
                        ? "127.0.0.1:4000"
                        : "[]",
              };
            },
          },
          { platform: "linux" }
        );
      let settled = false;
      const run = adapter
          .runContainer(runtime, {
            development: {
              installCommand: "npm ci",
              startCommand: "npm run dev",
            },
            environment: {},
            image: "test",
            labels: {},
            onFailure: reported.resolve,
            port: 3000,
          })
          .catch((error: unknown) => {
            settled = true;
            return error;
          }),
        failure = await reported.promise;
      expect(failure).toBeInstanceOf(ComparisonStartError);
      expect(settled).toBe(false);
      cleanup.resolve();
      expect(await run).toBe(failure);
    });
    it("reports installation failure with the settings to check", async () => {
      const adapter = createCliRuntimeAdapter(
        {
          run: async (_name, args, options) => ({
            stdout:
              args[0] === "exec"
                ? JSON.parse(options.input!).probe
                  ? "ready"
                  : "installation-failed"
                : args[0] === "run"
                  ? "id"
                  : args[0] === "port"
                    ? "127.0.0.1:4000"
                    : "[]",
          }),
        },
        { platform: "linux" }
      );
      await expect(
        adapter.runContainer(runtime, {
          development: {
            installCommand: "npm ci",
            startCommand: "npm run dev",
          },
          environment: { NODE_AUTH_TOKEN: "private-token" },
          image: "test",
          labels: {},
          port: 3000,
        })
      ).rejects.toMatchObject({
        constructor: ComparisonStartError,
        message: expect.stringContaining(
          "Dependency installation failed. Open Compare"
        ),
      });
    });
    it("uses only stdin, reinjects its snapshot on restart, and forgets it on removal", async () => {
      const calls: { args: string[]; options: RunOptions }[] = [],
        adapter = createCliRuntimeAdapter(
          {
            run: async (_name, args, options) => {
              calls.push({ args, options });
              if (args[0] === "exec") {
                return {
                  stdout: JSON.parse(options.input!).probe
                    ? "ready"
                    : "started",
                };
              }
              return {
                stdout:
                  args[0] === "run"
                    ? "id"
                    : args[0] === "port"
                      ? "127.0.0.1:4000"
                      : "[]",
              };
            },
          },
          { platform: "linux" }
        ),
        environment = {
          API_TOKEN: "multi\nline",
          DOCKER_HOST: "do-not-use-on-host",
          NODE_AUTH_TOKEN: "install-secret",
        };
      await adapter.runContainer(runtime, {
        development: { installCommand: "npm ci", startCommand: "npm run dev" },
        environment,
        image: "test",
        labels: {},
        port: 3000,
      });
      environment.API_TOKEN = "changed";
      await adapter.stopContainers(runtime, ["id"]);
      await adapter.startContainers(runtime, ["id"]);
      const payloads = calls
        .filter((call) => call.args[0] === "exec")
        .map((call) => JSON.parse(call.options.input!))
        .filter((payload) => !payload.probe);
      expect(payloads[0].environment.NODE_AUTH_TOKEN).toBe("install-secret");
      expect(payloads[1].environment).toEqual({
        API_TOKEN: "multi\nline",
        DOCKER_HOST: "do-not-use-on-host",
      });
      expect(payloads[1].installCommand).toBe("");
      expect(
        calls.every((call) => call.options.environment === undefined)
      ).toBe(true);
      expect(JSON.stringify(calls.map((call) => call.args))).not.toMatch(
        /install-secret|multi|do-not-use-on-host/u
      );
      await adapter.removeContainers(runtime, ["id"]);
      await expect(adapter.startContainers(runtime, ["id"])).rejects.toThrow(
        "Run a new Comparison"
      );
    });
    it("fails before sending real values when the capability probe fails", async () => {
      const inputs: string[] = [],
        adapter = createCliRuntimeAdapter(
          {
            run: async (_name, args, options) => {
              if (options.input) {
                inputs.push(options.input);
              }
              return {
                stdout:
                  args[0] === "run"
                    ? "id"
                    : args[0] === "port"
                      ? "127.0.0.1:4000"
                      : "unsupported",
              };
            },
          },
          { platform: "linux" }
        );
      await expect(
        adapter.runContainer(runtime, {
          development: {
            installCommand: "npm ci",
            startCommand: "npm run dev",
          },
          environment: { API: "do-not-send" },
          image: "test",
          labels: {},
          port: 3000,
        })
      ).rejects.toThrow("securely");
      expect(inputs.join(",")).not.toContain("do-not-send");
    });
  }
);
