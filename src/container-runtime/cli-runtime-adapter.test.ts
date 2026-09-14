import { describe, expect, it } from "vitest";
import {
  type CommandRunner,
  cliRuntimeAdapter,
  createCliRuntimeAdapter,
} from "./cli-runtime-adapter";
import { RUNTIME_NAMES } from "./runtime-status";

/** Fake shell: scripted stdout per "command args", `hang` commands only finish via the timeout option. */
const fakeShell = ({
    failures = {},
    hang = [],
    outputs,
  }: {
    /** Commands that exit non-zero, with their stderr. */
    failures?: Record<string, string>;
    hang?: string[];
    outputs: Record<string, string>;
  }): CommandRunner & {
    calls: string[];
    environments: (Record<string, string> | undefined)[];
    inputs: (string | undefined)[];
  } => {
    const calls: string[] = [],
      environments: (Record<string, string> | undefined)[] = [],
      inputs: (string | undefined)[] = [];
    return {
      calls,
      environments,
      inputs,
      run: (command, args, { environment, input, timeoutMs }) => {
        const line = [command, ...args].join(" ");
        calls.push(line);
        environments.push(environment);
        inputs.push(input);
        if (hang.includes(line)) {
          return new Promise((_, reject) => {
            setTimeout(
              () => reject(new Error(`timed out after ${timeoutMs}ms`)),
              timeoutMs
            );
          });
        }
        const stderr = failures[line];
        if (stderr !== undefined) {
          return Promise.reject(
            Object.assign(new Error(`Command failed: ${command}`), {
              code: 125,
              stderr,
              stdout: "",
            })
          );
        }
        const stdout = outputs[line];
        return stdout === undefined
          ? Promise.reject(
              Object.assign(new Error(`${command}: not found`), {
                code: "ENOENT",
              })
            )
          : Promise.resolve({ stdout });
      },
    };
  },
  mac = { platform: "darwin" as const };

describe("CLI adapter detection", () => {
  it("treats a docker info that hangs as stopped instead of hanging the page", async () => {
    const shell = fakeShell({
        hang: ["docker info"],
        outputs: { "docker --version": "Docker version 29.7.2, build a7dcaa6" },
      }),
      adapter = createCliRuntimeAdapter(shell, {
        ...mac,
        commandTimeoutMs: 20,
      });
    await expect(adapter.detect("docker")).resolves.toEqual({
      installed: true,
      name: "docker",
      reason: "timed out after 20ms",
      running: false,
      version: "29.7.2",
    });
  });

  it("names why podman info failed so a machine that is up but unreachable is not mistaken for stopped", async () => {
    const shell = fakeShell({
        failures: {
          "podman info":
            "Cannot connect to Podman. Please verify your connection to the Linux system\nError: unable to connect to Podman socket: ssh: handshake failed",
        },
        outputs: { "podman --version": "podman version 5.6.0\n" },
      }),
      adapter = createCliRuntimeAdapter(shell, mac);
    await expect(adapter.detect("podman")).resolves.toEqual({
      installed: true,
      name: "podman",
      reason:
        "Error: unable to connect to Podman socket: ssh: handshake failed",
      running: false,
      version: "5.6.0",
    });
  });
});

describe("CLI adapter detection of podman", () => {
  it("reports a running podman machine as running", async () => {
    // Podman info has no ServerVersion field, so the docker-only format template fails.
    const shell = fakeShell({
        outputs: {
          "podman --version": "podman version 5.6.0\n",
          "podman info": "host:\n  arch: arm64\n",
        },
      }),
      adapter = createCliRuntimeAdapter(shell, mac);
    await expect(adapter.detect("podman")).resolves.toEqual({
      installed: true,
      name: "podman",
      running: true,
      version: "5.6.0",
    });
  });
});

describe("CLI adapter start", () => {
  it("runs the start command for the active docker context", async () => {
    const shell = fakeShell({
      outputs: { "colima start": "", "docker context show": "colima\n" },
    });
    await createCliRuntimeAdapter(shell, mac).start("docker");
    expect(shell.calls).toContain("colima start");
  });

  it("refuses with the manual hint when nothing can be started automatically", async () => {
    const shell = fakeShell({
      outputs: { "docker context show": "default\n" },
    });
    await expect(
      createCliRuntimeAdapter(shell, { platform: "linux" }).start("docker")
    ).rejects.toThrow(
      "docker cannot be started from here. Run `sudo systemctl start docker` and try again."
    );
  });

  it("names the failed command, the manual hint, and the reason", async () => {
    const shell = fakeShell({
      outputs: { "docker context show": "desktop-linux\n" },
    });
    await expect(
      createCliRuntimeAdapter(shell, mac).start("docker")
    ).rejects.toThrow(
      "Could not start docker with `open -a Docker`. Open Docker and try again. (open: not found)"
    );
  });

  it("gives the start command its own, longer timeout than ordinary CLI calls", async () => {
    const shell = fakeShell({
      hang: ["podman machine start"],
      outputs: {},
    });
    await expect(
      createCliRuntimeAdapter(shell, {
        ...mac,
        commandTimeoutMs: 5,
        startTimeoutMs: 40,
      }).start("podman")
    ).rejects.toThrow(
      "Could not start podman with `podman machine start`. Run `podman machine start` and try again. (timed out after 40ms)"
    );
  });

  it("surfaces the last stderr line as the reason", async () => {
    const shell: CommandRunner = {
      run: () =>
        Promise.reject(
          Object.assign(new Error("Command failed"), {
            stderr: "Error: podman machine init must be run first\n",
          })
        ),
    };
    await expect(
      createCliRuntimeAdapter(shell, mac).start("podman")
    ).rejects.toThrow("(Error: podman machine init must be run first)");
  });
});

/** Smoke test against the real CLI. Detection only; starting a VM is not something a unit run should do. */
describe.each(RUNTIME_NAMES)("real %s adapter", (name) => {
  it("reports a version and running state when installed, or absent otherwise", async () => {
    const status = await cliRuntimeAdapter.detect(name);
    expect(status.name).toBe(name);
    if (!status.installed) {
      return;
    }
    expect(status.version).toMatch(/^\d+\.\d+\.\d+$/u);
    expect(typeof status.running).toBe("boolean");
  });
});

describe("CLI adapter containers", () => {
  it("runs a hardened container without values in its environment or arguments", async () => {
    const shell = fakeShell({
        outputs: {
          "docker port abc123def 3000/tcp": "127.0.0.1:49152\n",
          "docker run -d --log-driver none --cap-drop ALL --security-opt no-new-privileges --memory 4g --cpus 2 --pids-limit 1024 --tmpfs /tmp -p 127.0.0.1::3000 -l sauce-control.session=s1 sauce-control/web-app:s1":
            "abc123def\n",
        },
      }),
      adapter = createCliRuntimeAdapter(shell, mac);

    await expect(
      adapter.runContainer("docker", {
        environment: {},
        image: "sauce-control/web-app:s1",
        labels: { "sauce-control.session": "s1" },
        port: 3000,
      })
    ).resolves.toEqual({ containerId: "abc123def", hostPort: 49_152 });
    expect(
      shell.environments.every((environment) => environment === undefined)
    ).toBe(true);
  });

  it("builds from the context with an inline Dockerfile on stdin when one is generated, labelling the image", async () => {
    const shell = fakeShell({
        outputs: {
          "docker build -t tag --label sauce-control.session=s1 -f - /tmp/clone":
            "",
        },
      }),
      adapter = createCliRuntimeAdapter(shell, mac);
    await adapter.buildImage("docker", {
      context: "/tmp/clone",
      dockerfile: "FROM scratch\n",
      labels: { "sauce-control.session": "s1" },
      tag: "tag",
    });
    expect(shell.inputs).toEqual(["FROM scratch\n"]);
  });

  it("passes build secrets through the environment and a mount id, never as an argument", async () => {
    const shell = fakeShell({
        outputs: {
          "docker build -t tag --secret id=NODE_AUTH_TOKEN,env=NODE_AUTH_TOKEN -f - /tmp/clone":
            "",
        },
      }),
      adapter = createCliRuntimeAdapter(shell, mac);
    await adapter.buildImage("docker", {
      context: "/tmp/clone",
      dockerfile: "FROM scratch\n",
      labels: {},
      secrets: [{ id: "NODE_AUTH_TOKEN", value: "synthetic-token" }],
      tag: "tag",
    });
    expect(shell.calls[0]).not.toContain("synthetic-token");
    expect(shell.environments).toEqual([
      { DOCKER_BUILDKIT: "1", NODE_AUTH_TOKEN: "synthetic-token" },
    ]);
  });

  it("builds with the context's own Dockerfile otherwise", async () => {
    const shell = fakeShell({
        outputs: { "docker build -t tag /tmp/clone": "" },
      }),
      adapter = createCliRuntimeAdapter(shell, mac);
    await adapter.buildImage("docker", {
      context: "/tmp/clone",
      dockerfile: undefined,
      labels: {},
      tag: "tag",
    });
    expect(shell.calls).toEqual(["docker build -t tag /tmp/clone"]);
  });

  it("checks for a listener on the port from inside the container", async () => {
    const listening = fakeShell({
        outputs: {
          "docker exec abc123 sh -c grep -qi ':0BB8 ' /proc/net/tcp /proc/net/tcp6":
            "",
        },
      }),
      silent = fakeShell({ outputs: {} }),
      adapter = createCliRuntimeAdapter(listening, mac);
    await expect(adapter.isListening("docker", "abc123", 3000)).resolves.toBe(
      true
    );
    await expect(
      createCliRuntimeAdapter(silent, mac).isListening("docker", "abc123", 3000)
    ).resolves.toBe(false);
  });

  it("lists containers by label, running or not, and force-removes by id", async () => {
    const shell = fakeShell({
        outputs: {
          "docker image ls -q --filter label=sauce-control.session":
            "img1\nimg1\nimg2\n",
          "docker image rm -f img1 img2": "",
          "docker ps -aq --no-trunc --filter label=sauce-control.session":
            "abc\ndef\n",
          "docker rm -f abc def": "",
        },
      }),
      adapter = createCliRuntimeAdapter(shell, mac);
    await expect(
      adapter.listContainers("docker", "sauce-control.session")
    ).resolves.toEqual(["abc", "def"]);
    await adapter.removeContainers("docker", ["abc", "def"]);
    await adapter.removeContainers("docker", []);
    await adapter.removeImages("docker", "sauce-control.session");
    expect(shell.calls).toEqual([
      "docker ps -aq --no-trunc --filter label=sauce-control.session",
      "docker rm -f abc def",
      "docker image ls -q --filter label=sauce-control.session",
      "docker image rm -f img1 img2",
    ]);
  });
});

describe("CLI adapter Instance lifecycle", () => {
  it("publishes the bridge port for a development container and tells the launcher about it", async () => {
    const calls: string[] = [],
      payloads: { bridgePort?: number; probe?: boolean }[] = [],
      adapter = createCliRuntimeAdapter(
        {
          run: (command, args, options) => {
            calls.push([command, ...args].join(" "));
            if (args[0] === "exec") {
              const payload = JSON.parse(
                options.input!
              ) as (typeof payloads)[number];
              payloads.push(payload);
              return Promise.resolve({
                stdout: payload.probe ? "ready" : "started",
              });
            }
            return Promise.resolve({
              stdout:
                args[0] === "run"
                  ? "abc123def\n"
                  : args[0] === "port"
                    ? "127.0.0.1:49153\n"
                    : "[]",
            });
          },
        },
        mac
      );
    await expect(
      adapter.runContainer("docker", {
        development: { installCommand: "", startCommand: "npm run dev" },
        environment: {},
        image: "sauce-control/web-app:s1",
        labels: { "sauce-control.session": "s1" },
        port: 3000,
      })
    ).resolves.toEqual({ containerId: "abc123def", hostPort: 49_153 });
    expect(calls).toContain(
      "docker run -d --log-driver none --cap-drop ALL --security-opt no-new-privileges --memory 4g --cpus 2 --pids-limit 1024 --tmpfs /tmp -p 127.0.0.1::45173 -l sauce-control.session=s1 sauce-control/web-app:s1"
    );
    expect(calls).toContain("docker port abc123def 45173/tcp");
    expect(payloads.find((payload) => !payload.probe)?.bridgePort).toBe(45_173);
  });

  it("inspects containers into id, labels, state, host port, and creation time", async () => {
    const shell = fakeShell({
        outputs: {
          "docker inspect abc def": JSON.stringify([
            {
              Config: {
                Labels: {
                  "sauce-control.app": "sauce-control",
                  "sauce-control.branch": "main",
                },
              },
              Created: "2026-09-11T10:00:00.000000000Z",
              Id: "abc",
              NetworkSettings: {
                Ports: {
                  "3000/tcp": [{ HostIp: "127.0.0.1", HostPort: "49152" }],
                },
              },
              State: { Status: "running" },
            },
            {
              Config: { Labels: null },
              Created: "2026-09-11T09:00:00.000000000Z",
              Id: "def",
              NetworkSettings: { Ports: { "3000/tcp": null } },
              State: { Status: "exited" },
            },
          ]),
        },
      }),
      adapter = createCliRuntimeAdapter(shell, mac);

    await expect(
      adapter.inspectContainers("docker", ["abc", "def"])
    ).resolves.toEqual([
      {
        containerId: "abc",
        createdAt: "2026-09-11T10:00:00.000000000Z",
        hostPort: 49_152,
        labels: {
          "sauce-control.app": "sauce-control",
          "sauce-control.branch": "main",
        },
        state: "running",
      },
      {
        containerId: "def",
        createdAt: "2026-09-11T09:00:00.000000000Z",
        hostPort: undefined,
        labels: {},
        state: "stopped",
      },
    ]);
  });

  it("stops and starts by id without shelling out for an empty list", async () => {
    const shell = fakeShell({
        outputs: { "docker start abc": "abc\n", "docker stop abc": "abc\n" },
      }),
      adapter = createCliRuntimeAdapter(shell, mac);

    await adapter.stopContainers("docker", ["abc"]);
    await expect(adapter.startContainers("docker", ["abc"])).rejects.toThrow(
      "Run a new Comparison"
    );
    await adapter.startContainers("docker", []);
    await adapter.stopContainers("docker", []);

    expect(shell.calls).toEqual(["docker stop abc"]);
  });
});
