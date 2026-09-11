import { expect, it } from "vitest";
import { nodeCommandRunner } from "./command-runner";

it("delivers trusted stdout before exit and aborts the command", async () => {
  const controller = new AbortController(),
    chunks: string[] = [],
    result = nodeCommandRunner.run(
      process.execPath,
      [
        "-e",
        String.raw`process.stdout.write('installing\n'); setInterval(() => {}, 1000)`,
      ],
      {
        onStdout: (chunk) => {
          chunks.push(chunk);
          controller.abort();
        },
        signal: controller.signal,
        timeoutMs: 30_000,
      }
    );
  await expect(result).rejects.toMatchObject({ name: "AbortError" });
  expect(chunks.join("")).toBe("installing\n");
});
