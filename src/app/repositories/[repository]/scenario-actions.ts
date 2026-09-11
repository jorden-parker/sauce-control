"use server";

import { revalidatePath } from "next/cache";
import { readSchemaSource } from "@/scenarios/read-schema-source";
import { gitHubClient } from "@/github/github";
import { detectCurrentSchemaSources } from "@/comparison/current-comparison";
import { settings } from "@/settings/settings";

export const attachSchemaSource = async (
  _previous: string,
  data: FormData
): Promise<string> => {
  const repository = String(data.get("repository") ?? "");
  try {
    const file = data.get("upload"),
      urlText = String(data.get("url") ?? "").trim();
    let source;
    const sourceRepository = String(data.get("sourceRepository") ?? "").trim();
    if (sourceRepository) {
      const [organisation, name, extra] = sourceRepository.split("/"),
        path = String(data.get("sourcePath") ?? "").trim();
      if (organisation !== settings().getOrganisation() || !name || extra) {
        return "Choose a Repository within the saved Organisation.";
      }
      if (!path || path.startsWith("/") || path.split("/").includes("..")) {
        return "Enter a relative Schema Source path.";
      }
      const client = await gitHubClient("schema-source");
      if (!client) {
        return "No GitHub credential found.";
      }
      const repositories = await client.listRepositories(organisation),
        branch = repositories.find((item) => item.name === name)?.defaultBranch;
      if (!branch) {
        return "Repository not found in the saved Organisation.";
      }
      const text = await client.readFile(
        organisation,
        name,
        path.split("/").map(encodeURIComponent).join("/"),
        branch
      );
      if (text === undefined) {
        return "Schema Source file not found.";
      }
      source = readSchemaSource(`${sourceRepository}/${path}`, text);
    } else if (urlText) {
      const url = new URL(urlText);
      if (
        !["http:", "https:"].includes(url.protocol) ||
        url.username ||
        url.password
      ) {
        return "Use an HTTP or HTTPS URL without credentials.";
      }
      const response = await fetch(url, {
        cache: "no-store",
        signal: AbortSignal.timeout(10_000),
      });
      if (!response.ok) {
        return "Could not fetch the Schema Source URL.";
      }
      source = readSchemaSource(urlText, await response.text());
    } else {
      if (!(file instanceof File) || file.size === 0) {
        return "Choose a Schema Source file.";
      }
      source = readSchemaSource(file.name, await file.text());
    }
    const store = settings(),
      config = store.getScenarioConfig(repository);
    store.saveScenarioConfig(repository, {
      ...config,
      schemaSources: [
        ...config.schemaSources.filter(({ name }) => name !== source.name),
        source,
      ],
    });
    revalidatePath(`/repositories/${repository}`);
    return "Schema Source attached.";
  } catch {
    return "Could not read the Schema Source. Check that it is a valid OpenAPI document.";
  }
};

export const detectLocalSchemaSources = async (
  _previous: string,
  data: FormData
): Promise<string> => {
  const repository = String(data.get("repository") ?? ""),
    directory = String(data.get("codeDirectory") ?? "").trim(),
    store = settings();
  store.saveCodeDirectory(directory);
  const found = await detectCurrentSchemaSources(repository, directory),
    config = store.getScenarioConfig(repository),
    names = new Set(found.map(({ name }) => name));
  store.saveScenarioConfig(repository, {
    ...config,
    schemaSources: [
      ...config.schemaSources.filter(({ name }) => !names.has(name)),
      ...found,
    ],
  });
  revalidatePath(`/repositories/${repository}`);
  return found.length > 0
    ? `${found.length} Schema Source(s) attached.`
    : "No valid Schema Sources found. Run a Comparison to scan its clones, or choose a Code Directory.";
};

export const saveManualScenario = async (
  _previous: string,
  data: FormData
): Promise<string> => {
  const repository = String(data.get("repository") ?? ""),
    name = String(data.get("name") ?? "").trim();
  if (
    !name ||
    name.length > 80 ||
    ["recorded", "empty", "error", "slow"].includes(name)
  ) {
    return "Choose a unique Scenario name other than recorded, empty, error or slow.";
  }
  try {
    const responses: unknown = JSON.parse(
      String(data.get("responses") ?? "[]")
    );
    if (
      !Array.isArray(responses) ||
      responses.length === 0 ||
      responses.length > 100 ||
      !responses.every((response: unknown) => {
        if (typeof response !== "object" || response === null) {
          return false;
        }
        const item = response as Record<string, unknown>;
        return (
          typeof item.method === "string" &&
          /^[A-Z]+$/u.test(item.method) &&
          typeof item.pathPattern === "string" &&
          item.pathPattern.startsWith("/") &&
          typeof item.status === "number" &&
          Number.isInteger(item.status) &&
          item.status >= 200 &&
          item.status <= 599 &&
          typeof item.delayMs === "number" &&
          Number.isInteger(item.delayMs) &&
          item.delayMs >= 0 &&
          item.delayMs <= 30_000 &&
          typeof item.body === "string" &&
          typeof item.headers === "object" &&
          item.headers !== null &&
          !Array.isArray(item.headers) &&
          Object.entries(item.headers).every(
            ([key, value]) =>
              /^[!#$%&'*+.^_`|~\da-z-]+$/iu.test(key) &&
              typeof value === "string" &&
              !/[\r\n]/u.test(value)
          )
        );
      })
    ) {
      return "Check each Endpoint's method, path, status, headers and delay.";
    }
    const store = settings(),
      config = store.getScenarioConfig(repository);
    store.saveScenarioConfig(repository, {
      ...config,
      manualScenarios: [
        ...config.manualScenarios.filter((scenario) => scenario.name !== name),
        {
          name,
          responses:
            responses as import("@/scenarios/scenarios").ManualScenario["responses"],
        },
      ],
    });
    revalidatePath(`/repositories/${repository}`);
    revalidatePath("/compare");
    return "Scenario saved.";
  } catch {
    return "Could not save the Scenario. Check the response headers are a JSON object.";
  }
};
