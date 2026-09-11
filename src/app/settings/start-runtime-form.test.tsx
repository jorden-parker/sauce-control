// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { afterEach, describe, expect, it } from "vitest";
import type { InstalledRuntime } from "@/container-runtime/runtime-status";
import { StartRuntimeForm } from "./start-runtime-form";

const docker: InstalledRuntime = {
  installed: true,
  name: "docker",
  running: false,
  version: "29.7.2",
};

afterEach(cleanup);

describe("Start runtime form", () => {
  it("shows the start error returned by the action", async () => {
    render(
      <StartRuntimeForm
        runtime={docker}
        action={() =>
          Promise.resolve({
            error:
              "Could not start docker with `open -a Docker`. Open Docker and try again.",
          })
        }
      />
    );
    fireEvent.click(screen.getByRole("button", { name: /start docker/iu }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Could not start docker with `open -a Docker`. Open Docker and try again."
    );
  });

  it("shows nothing extra when the start succeeds", async () => {
    render(
      <StartRuntimeForm runtime={docker} action={() => Promise.resolve({})} />
    );
    fireEvent.click(screen.getByRole("button", { name: /start docker/iu }));
    await new Promise((resolve) => {
      setTimeout(resolve, 0);
    });
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
});
