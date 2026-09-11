import { describe, expect, it, vi } from "vitest";
import { StartupProgressTracker } from "./startup-progress";

describe("startup progress", () => {
  it("tracks the two Instances independently and freezes elapsed time on cancellation", () => {
    const changed = vi.fn(),
      progress = new StartupProgressTracker(
        "one",
        "web",
        { base: "main", target: "feature" },
        changed
      );
    progress.begin("base", "clone");
    progress.begin("target", "clone");
    progress.begin("base", "container");
    const snapshot = progress.snapshot();
    expect(
      snapshot.steps.find(
        (step) => step.scope === "base" && step.key === "clone"
      )?.state
    ).toBe("complete");
    expect(
      snapshot.steps.find(
        (step) => step.scope === "target" && step.key === "clone"
      )?.state
    ).toBe("active");
    progress.finish("cancelled", "Comparison startup cancelled.");
    const cancelled = progress.snapshot();
    progress.begin("target", "container");
    progress.finish("ready", "Comparison ready.");
    expect(progress.snapshot()).toEqual(cancelled);
    expect(cancelled.endedAt).toBeTypeOf("number");
    expect(
      cancelled.steps.filter((step) => step.state === "active")
    ).toHaveLength(0);
    expect(changed).toHaveBeenCalled();
  });
  it("retains bounded messages without losing completed step timing", () => {
    const progress = new StartupProgressTracker(
      "one",
      "web",
      { base: "main", target: "feature" },
      () => {}
    );
    progress.begin("comparison", "discovery");
    for (let count = 1; count <= 500; count++) {
      progress.detail("comparison", "discovery", `${count} Pages visited.`);
    }
    progress.begin("comparison", "affected");
    const snapshot = progress.snapshot();
    expect(snapshot.messages).toHaveLength(300);
    expect(
      snapshot.steps.find((step) => step.key === "discovery")
    ).toMatchObject({ endedAt: expect.any(Number), state: "complete" });
    snapshot.messages.length = 0;
    expect(progress.snapshot().messages).toHaveLength(300);
  });
});
