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
import { runEnvironmentSetup } from "@/repository-config/environment-setup";

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
          setupValue = `setup-${randomUUID()}`,
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
        const setupFile = join(root, "setup.sh");
        writeFileSync(setupFile, `export SETUP_CREDENTIAL=${setupValue}\n`);
        const setupEnvironment = await runEnvironmentSetup(
          `source '${setupFile}'`
        );
        Object.assign(environment, setupEnvironment);
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
          `const fs=require('node:fs'),crypto=require('node:crypto'); console.log(process.env.NODE_AUTH_TOKEN); console.log(process.env.SETUP_CREDENTIAL); console.error(Buffer.from(process.env.NODE_AUTH_TOKEN).toString('base64')); fs.writeFileSync('.install-check.json', JSON.stringify({hash:crypto.createHash('sha256').update(process.env.NODE_AUTH_TOKEN).digest('hex'),setupHash:crypto.createHash('sha256').update(process.env.SETUP_CREDENTIAL).digest('hex'),runtimeAbsent:process.env.API_TOKEN===undefined}));`
        );
        writeFileSync(
          join(fixture, "server.cjs"),
          `const fs=require('node:fs'),crypto=require('node:crypto'); console.log(process.env.API_TOKEN); console.log(process.env.SETUP_CREDENTIAL); console.error(Buffer.from(process.env.API_TOKEN).toString('base64')); require('node:http').createServer((q,r)=>r.end(JSON.stringify({install:JSON.parse(fs.readFileSync('.install-check.json','utf8')),runtimeHash:crypto.createHash('sha256').update(process.env.API_TOKEN).digest('hex'),setupHash:crypto.createHash('sha256').update(process.env.SETUP_CREDENTIAL).digest('hex'),tokenAbsent:process.env.NODE_AUTH_TOKEN===undefined,excluded:!fs.existsSync('.env.local')&&!fs.existsSync('.git')}))).listen(Number(process.env.PORT),'0.0.0.0');`
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
                setupEnvironment,
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
            install: {
              hash: digest(token),
              runtimeAbsent: true,
              setupHash: digest(setupValue),
            },
            runtimeHash: digest(api),
            setupHash: digest(setupValue),
            tokenAbsent: true,
          };
          expect(
            await (await fetch(`http://127.0.0.1:${instance.hostPort}`)).json()
          ).toEqual(expected);
          const inspected = (await shell(["inspect", id])).stdout;
          expect(inspected).not.toContain(token);
          expect(inspected).not.toContain(setupValue);
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
          expect(history).not.toContain(setupValue);
          expect(history).not.toContain("node install.cjs");
          const logs = await shell(["logs", id]).catch(() => ({ stdout: "" }));
          expect(logs.stdout).toBe("");
          environment.API_TOKEN = "edited-after-start";
          setupEnvironment.SETUP_CREDENTIAL = "edited-after-start";
          environment.SETUP_CREDENTIAL = "edited-after-start";
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

// The registry is inside the disposable container. No real credential or
// External package registry is used, but npm's HTTP authentication is real.
describe.each(["docker", "podman"] as const)(
  "%s private registry authentication",
  (runtime) => {
    it.for([false, true])(
      "auth configuration present: %s",
      { timeout: 180_000 },
      async (configured, { skip }) => {
        const adapter = createCliRuntimeAdapter(nodeCommandRunner, {
            platform: process.platform,
          }),
          status = await adapter.detect(runtime);
        if (!status.installed || !status.running) {
          return skip();
        }
        const root = mkdtempSync(join(tmpdir(), "registry-auth-")),
          fixture = join(root, "fixture"),
          sessionId = randomUUID(),
          token = `synthetic-${randomUUID()}`;
        mkdirSync(fixture);
        const file = join(root, "credentials.env");
        writeFileSync(file, `export NODE_AUTH_TOKEN=${token}\n`);
        const loaded = await readEnvironmentFiles([file]);
        writeFileSync(
          join(fixture, "package.json"),
          JSON.stringify({
            name: "fixture",
            scripts: { dev: "node server.cjs" },
          })
        );
        if (configured) {
          writeFileSync(
            join(fixture, ".npmrc"),
            "//127.0.0.1:4873/:_authToken=${NODE_AUTH_TOKEN}\n"
          );
        }
        writeFileSync(
          join(fixture, "install.cjs"),
          `
const http = require('node:http'), {spawn} = require('node:child_process');
const server = http.createServer((request,response) => {
  response.setHeader('Content-Type','application/json');
  if (request.headers.authorization !== 'Bearer ' + process.env.NODE_AUTH_TOKEN) {
    response.writeHead(401); response.end(JSON.stringify({error:'authentication required'})); return;
  }
  response.end(JSON.stringify({name:'private-fixture','dist-tags':{latest:'1.0.0'},versions:{'1.0.0':{name:'private-fixture',version:'1.0.0'}}}));
});
server.listen(4873,'127.0.0.1',() => {
  const child=spawn('npm',['view','private-fixture','version','--registry=http://127.0.0.1:4873','--fetch-retries=0'],{stdio:'inherit'});
  child.on('error',()=>{process.exitCode=1;server.close()});
  child.on('close',code=>{process.exitCode=code ?? 1;server.close()});
});
`
        );
        writeFileSync(
          join(fixture, "server.cjs"),
          `require('node:http').createServer((q,r)=>r.end('ready')).listen(3000,'0.0.0.0')`
        );
        let id: string | undefined;
        try {
          const running = runInstance(
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
                installCommand: "node install.cjs",
                pages: { added: [], removed: [] },
                port: 3000,
                startCommand: "node server.cjs",
              },
              environment: loaded.environment,
              environmentFiles: loaded.resolvedPaths,
              organisation: "fixture",
              readiness: { pollIntervalMs: 100, timeoutMs: 15_000 },
              repository: "registry-auth",
              runtime,
              sessionId,
              token: "unused",
              workDirectory: join(root, "clones"),
            }
          );
          if (configured) {
            const instance = await running;
            id = instance.containerId;
            expect(
              await (
                await fetch(`http://127.0.0.1:${instance.hostPort}`)
              ).text()
            ).toBe("ready");
          } else {
            const failure = await running.then(
              (instance) => {
                id = instance.containerId;
                return;
              },
              (error: unknown) => error
            );
            expect(failure).toBeInstanceOf(Error);
            expect(String(failure)).toContain("E401");
            expect(String(failure)).toContain(
              "NODE_AUTH_TOKEN reached the installer"
            );
            expect(String(failure)).toContain(".npmrc");
            expect(String(failure)).not.toContain(token);
            expect(String(failure)).not.toContain(
              Buffer.from(token).toString("base64")
            );
          }
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
