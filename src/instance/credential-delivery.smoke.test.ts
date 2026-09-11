import { cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { createCliRuntimeAdapter } from "@/container-runtime/cli-runtime-adapter";
import { nodeCommandRunner } from "@/shell/command-runner";
import { DEFAULT_CRAWL_LIMITS } from "@/crawler/crawl-limits";
import { runInstance } from "./run-instance";
import { openSettingsStore } from "@/settings/settings-store";
import { readEnvironmentFiles } from "@/repository-config/environment-files";

const digest = (value: string) =>
  createHash("sha256").update(value).digest("hex");

describe.each(["docker", "podman"] as const)(
  "real %s credential protection",
  (runtime) => {
    it.for(["node install.cjs", "npm install --ignore-scripts=false"])(
      "delivers a saved Environment File token through %s, hides output and inspection values, and reuses the restart snapshot",
      { timeout: 180_000 },
      async (installCommand, { skip }) => {
        const adapter = createCliRuntimeAdapter(nodeCommandRunner, {
            platform: process.platform,
          }),
          status = await adapter.detect(runtime);
        if (!status.installed || !status.running) {
          return skip();
        }
        const root = mkdtempSync(join(tmpdir(), "credential-smoke-")),
          fixture = join(root, "fixture"),
          sessionId = randomUUID(),
          token = `install-${randomUUID()}`,
          api = `runtime-${randomUUID()}\nsecond line`,
          shell = (args: string[]) =>
            nodeCommandRunner.run(runtime, args, { timeoutMs: 60_000 }),
          environmentFile = join(root, "credentials.env"),
          store = openSettingsStore(join(root, "settings.db"));
        writeFileSync(
          environmentFile,
          `API_TOKEN='${api}'\nDOCKER_HOST=must-not-affect-host-cli\nexport NODE_AUTH_TOKEN=${token}\n`
        );
        store.saveEnvironmentFiles("credential-smoke", [environmentFile]);
        const { environment, resolvedPaths } = await readEnvironmentFiles(
          store.getEnvironmentFiles("credential-smoke")
        );
        store.close();
        mkdirSync(fixture);
        writeFileSync(
          join(fixture, "package.json"),
          JSON.stringify({
            name: "credential-smoke",
            scripts: {
              dev: "node server.cjs",
              postinstall: "node install.cjs",
            },
            version: "1.0.0",
          })
        );
        writeFileSync(
          join(fixture, "package-lock.json"),
          JSON.stringify({
            lockfileVersion: 3,
            name: "credential-smoke",
            packages: {
              "": {
                hasInstallScript: true,
                name: "credential-smoke",
                version: "1.0.0",
              },
            },
            requires: true,
            version: "1.0.0",
          })
        );
        writeFileSync(
          join(fixture, "install.cjs"),
          `const fs=require('node:fs'),crypto=require('node:crypto'); console.log(process.env.NODE_AUTH_TOKEN); console.error(Buffer.from(process.env.NODE_AUTH_TOKEN).toString('base64')); fs.writeFileSync('.install-check.json', JSON.stringify({hash:crypto.createHash('sha256').update(process.env.NODE_AUTH_TOKEN).digest('hex'),runtimeAbsent:process.env.API_TOKEN===undefined}));`
        );
        writeFileSync(
          join(fixture, "server.cjs"),
          `const fs=require('node:fs'),crypto=require('node:crypto'); console.log(process.env.API_TOKEN); console.error(Buffer.from(process.env.API_TOKEN).toString('base64')); require('node:http').createServer((q,r)=>r.end(JSON.stringify({install:JSON.parse(fs.readFileSync('.install-check.json','utf8')),runtimeHash:crypto.createHash('sha256').update(process.env.API_TOKEN).digest('hex'),tokenAbsent:process.env.NODE_AUTH_TOKEN===undefined,excluded:!fs.existsSync('.env.local')&&!fs.existsSync('.git')}))).listen(Number(process.env.PORT),'0.0.0.0');`
        );
        writeFileSync(join(fixture, ".env.local"), `NODE_AUTH_TOKEN=${token}`);
        mkdirSync(join(fixture, ".git"));
        writeFileSync(join(fixture, ".git", "config"), token);
        writeFileSync(
          join(fixture, "Dockerfile"),
          "FROM scratch\nRUN this-must-never-run\n"
        );
        let id: string | undefined;
        try {
          const progress: string[] = [],
            instance = await runInstance(
              {
                git: {
                  run: async (_command, args) => {
                    cpSync(fixture, args.at(-1)!, { recursive: true });
                    return { stdout: "" };
                  },
                },
                runtime: adapter,
              },
              {
                branch: "main",
                config: {
                  crawl: DEFAULT_CRAWL_LIMITS,
                  installCommand,
                  pages: { added: [], removed: [] },
                  port: 3000,
                  startCommand: "npm run dev",
                },
                environment,
                environmentFiles: resolvedPaths,
                onProgress: (step) => progress.push(step),
                organisation: "fixture",
                readiness: { pollIntervalMs: 200, timeoutMs: 30_000 },
                repository: "credential-smoke",
                runtime,
                sessionId,
                token: "unused",
                workDirectory: join(root, "clones"),
              }
            );
          id = instance.containerId;
          expect(progress).toEqual([
            "clone",
            "container",
            "install",
            "start",
            "readiness",
            "ready",
          ]);
          expect(JSON.stringify(progress)).not.toContain(token);
          expect(JSON.stringify(progress)).not.toContain(api);
          const expected = {
            excluded: true,
            install: { hash: digest(token), runtimeAbsent: true },
            runtimeHash: digest(api),
            tokenAbsent: true,
          };
          expect(
            await (await fetch(`http://127.0.0.1:${instance.hostPort}`)).json()
          ).toEqual(expected);
          const inspected = (await shell(["inspect", id])).stdout;
          expect(inspected).not.toContain(token);
          expect(inspected).not.toContain(api.split("\n")[0]);
          expect(inspected).not.toContain("must-not-affect-host-cli");
          const history = (
            await shell([
              "history",
              "--no-trunc",
              `sauce-control/credential-smoke-main:${sessionId}`,
            ])
          ).stdout;
          expect(history).not.toContain(token);
          expect(history).not.toContain("node install.cjs");
          const logs = await shell(["logs", id]).catch(() => ({ stdout: "" }));
          expect(logs.stdout).toBe("");
          environment.API_TOKEN = "edited-after-start";
          await adapter.stopContainers(runtime, [id]);
          await adapter.startContainers(runtime, [id]);
          await expect
            .poll(() => adapter.isListening(runtime, id!, 3000), {
              timeout: 15_000,
            })
            .toBe(true);
          const [details] = await adapter.inspectContainers(runtime, [id]);
          expect(
            await (await fetch(`http://127.0.0.1:${details!.hostPort}`)).json()
          ).toEqual(expected);
        } finally {
          if (id) {
            await adapter.removeContainers(runtime, [id]);
          }
          await adapter.removeImages(
            runtime,
            `sauce-control.session=${sessionId}`
          );
          rmSync(root, { force: true, recursive: true });
        }
      }
    );
  }
);
