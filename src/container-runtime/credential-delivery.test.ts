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
        expect(String(error)).toContain("securely");
        expect(String(error)).not.toContain("raw-secret");
        expect((error as Error).cause).toBeUndefined();
      }
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
