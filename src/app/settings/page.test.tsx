// @vitest-environment jsdom
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { cleanup, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type {
  ContainerDetails,
  RuntimeAdapter,
} from "@/container-runtime/runtime-adapter";
import type {
  RuntimeName,
  RuntimeStatus,
} from "@/container-runtime/runtime-status";

/** Per-test picture of the machine's Container Runtimes. */
const machine: {
    containers: ContainerDetails[];
    statuses: Partial<Record<RuntimeName, RuntimeStatus>>;
  } = { containers: [], statuses: {} },
  fake: Pick<
    RuntimeAdapter,
    "detect" | "inspectContainers" | "listContainers" | "start"
  > = {
    detect: (name) =>
      Promise.resolve(machine.statuses[name] ?? { installed: false, name }),
    inspectContainers: (_name, ids) =>
      Promise.resolve(
        machine.containers.filter((c) => ids.includes(c.containerId))
      ),
    listContainers: () =>
      Promise.resolve(machine.containers.map((c) => c.containerId)),
    start: () => Promise.resolve(),
  };
vi.mock("@/container-runtime/runtime", () => ({ runtimeAdapter: fake }));

const renderSettingsPage = async (): Promise<void> => {
  const { default: SettingsPage } = await import("./page");
  render(await SettingsPage());
};

beforeEach(() => {
  machine.containers = [];
  process.env.SAUCE_CONTROL_DATA_DIR = mkdtempSync(
    join(tmpdir(), "sauce-control-page-")
  );
  vi.resetModules();
});
afterEach(cleanup);

describe("Settings page Container Runtime with both installed and nothing saved", () => {
  it("offers both with version and state, nothing preselected", async () => {
    machine.statuses = {
      docker: {
        installed: true,
        name: "docker",
        running: true,
        version: "29.7.2",
      },
      podman: {
        installed: true,
        name: "podman",
        running: false,
        version: "5.4.0",
      },
    };
    await renderSettingsPage();

    const docker = screen.getByRole("radio", {
        name: /docker 29\.7\.2.*running/iu,
      }),
      podman = screen.getByRole("radio", { name: /podman 5\.4\.0.*stopped/iu });
    expect(docker).not.toBeChecked();
    expect(podman).not.toBeChecked();
  });
});

describe("Settings page Container Runtime with a saved runtime", () => {
  it("shows the saved runtime with its live state and no picker", async () => {
    machine.statuses = {
      docker: {
        installed: true,
        name: "docker",
        running: true,
        version: "29.7.2",
      },
      podman: {
        installed: true,
        name: "podman",
        running: false,
        version: "5.4.0",
      },
    };
    const { settings } = await import("@/settings/settings");
    settings().saveContainerRuntime("docker");
    await renderSettingsPage();

    expect(
      screen.getByText(/using docker 29\.7\.2, running/iu)
    ).toBeInTheDocument();
    expect(screen.queryByRole("radio")).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /start/iu })
    ).not.toBeInTheDocument();
  });

  it("offers to start the saved runtime when it is stopped", async () => {
    machine.statuses = {
      podman: {
        installed: true,
        name: "podman",
        running: false,
        version: "5.4.0",
      },
    };
    const { settings } = await import("@/settings/settings");
    settings().saveContainerRuntime("podman");
    await renderSettingsPage();

    expect(
      screen.getByText(/using podman 5\.4\.0, stopped/iu)
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /start podman/iu })
    ).toBeInTheDocument();
  });
});

describe("Settings page Container Runtime when the saved runtime is gone", () => {
  it("says so and asks before switching to the other runtime", async () => {
    machine.statuses = {
      docker: {
        installed: true,
        name: "docker",
        running: true,
        version: "29.7.2",
      },
    };
    const { settings } = await import("@/settings/settings");
    settings().saveContainerRuntime("podman");
    await renderSettingsPage();

    expect(
      screen.getByText(/podman is no longer installed/iu)
    ).toBeInTheDocument();
    expect(screen.queryByText(/using docker/iu)).not.toBeInTheDocument();
    expect(
      screen.getByRole("radio", { name: /docker 29\.7\.2.*running/iu })
    ).not.toBeChecked();
  });
});

describe("Settings page Container Runtime with nothing installed", () => {
  it("explains that Docker or Podman is required", async () => {
    machine.statuses = {};
    await renderSettingsPage();
    expect(
      screen.getByText(/neither docker nor podman is installed/iu)
    ).toBeInTheDocument();
  });
});

describe("Settings page Instances", () => {
  it("lists every owned Instance from the runtime with a Stop or Start button and a stop-all", async () => {
    machine.statuses = {
      docker: {
        installed: true,
        name: "docker",
        running: true,
        version: "29.7.2",
      },
    };
    machine.containers = [
      {
        containerId: "abc123abc123abc123",
        createdAt: new Date(Date.now() - 60_000).toISOString(),
        hostPort: 49_152,
        labels: {
          "sauce-control.app": "sauce-control",
          "sauce-control.branch": "feature/login",
          "sauce-control.repository": "web-app",
          "sauce-control.session": "crashed",
        },
        state: "running",
      },
      {
        containerId: "def456def456def456",
        createdAt: new Date(Date.now() - 3_600_000).toISOString(),
        hostPort: undefined,
        labels: {
          "sauce-control.app": "sauce-control",
          "sauce-control.branch": "main",
          "sauce-control.repository": "web-app",
          "sauce-control.session": "crashed",
        },
        state: "stopped",
      },
    ];
    const { settings } = await import("@/settings/settings");
    settings().saveContainerRuntime("docker");
    await renderSettingsPage();

    const rows = screen.getAllByTestId("instance-row");
    expect(rows).toHaveLength(2);
    expect(rows[0]).toHaveTextContent("feature/login");
    expect(rows[0]).toHaveTextContent("Leftover");
    expect(rows[0]).toHaveTextContent("127.0.0.1:49152");
    expect(screen.getByRole("button", { name: "Stop" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Start" })).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Stop and remove all" })
    ).toBeInTheDocument();
  });

  it("is hidden while the runtime is stopped", async () => {
    machine.statuses = {
      docker: {
        installed: true,
        name: "docker",
        running: false,
        version: "29.7.2",
      },
    };
    const { settings } = await import("@/settings/settings");
    settings().saveContainerRuntime("docker");
    await renderSettingsPage();

    expect(screen.queryByText("Instances")).not.toBeInTheDocument();
  });
});
