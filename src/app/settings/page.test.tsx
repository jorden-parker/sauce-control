// @vitest-environment jsdom
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { cleanup, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { RuntimeAdapter } from "@/container-runtime/runtime-adapter";
import type {
  RuntimeName,
  RuntimeStatus,
} from "@/container-runtime/runtime-status";

/** Per-test picture of the machine's Container Runtimes. */
const machine: { statuses: Partial<Record<RuntimeName, RuntimeStatus>> } = {
    statuses: {},
  },
  fake: Pick<RuntimeAdapter, "detect" | "start"> = {
    detect: (name) =>
      Promise.resolve(machine.statuses[name] ?? { installed: false, name }),
    start: () => Promise.resolve(),
  };
vi.mock("@/container-runtime/runtime", () => ({ runtimeAdapter: fake }));

const renderSettingsPage = async (): Promise<void> => {
  const { default: SettingsPage } = await import("./page");
  render(await SettingsPage());
};

beforeEach(() => {
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
