import Link from "next/link";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { gitHubClient } from "@/github/github";
import { keychain } from "@/keychain";
import { loadEnvironment } from "@/repository-config/environment";
import {
  type PackageManifest,
  inferRepositoryConfig,
} from "@/repository-config/infer-config";
import { settings } from "@/settings/settings";
import { ConfigForm } from "./config-form";

export const dynamic = "force-dynamic";

const readManifest = async (
  organisation: string,
  repository: string
): Promise<PackageManifest> => {
  const client = await gitHubClient();
  if (client === undefined) {
    return {};
  }
  const repositories = await client.listRepositories(organisation),
    branch = repositories.find(
      (candidate) => candidate.name === repository
    )?.defaultBranch;
  if (branch === undefined) {
    return {};
  }
  const text = await client.readFile(
    organisation,
    repository,
    "package.json",
    branch
  );
  try {
    return text === undefined ? {} : (JSON.parse(text) as PackageManifest);
  } catch {
    return {};
  }
};

export default async function RepositoryConfigPage({
  params,
}: {
  params: Promise<{ repository: string }>;
}) {
  const { repository } = await params,
    organisation = settings().getOrganisation(),
    saved = settings().getRepositoryConfig(repository),
    manifest =
      organisation === undefined
        ? {}
        : await readManifest(organisation, repository),
    config = saved ?? {
      ...inferRepositoryConfig(manifest),
      useDotEnvLocal: false,
    },
    environmentCount = Object.keys(
      loadEnvironment(keychain, repository)
    ).length;

  return (
    <main className="mx-auto w-full max-w-lg p-8">
      <h1 className="mb-6 text-2xl font-semibold tracking-tight">
        Configure <span className="font-mono">{repository}</span>
      </h1>
      <Card>
        <CardHeader>
          <CardTitle>Repository Config</CardTitle>
          <CardDescription>
            How each Instance of this Repository is built and started.
            Pre-filled from the package manifest; saved once and reused.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <ConfigForm
            config={config}
            environmentCount={environmentCount}
            manifest={manifest}
            repository={repository}
            saved={saved !== undefined}
          />
        </CardContent>
      </Card>
      <p className="mt-6 text-sm">
        <Link href="/compare" className="underline">
          Back to Compare
        </Link>
      </p>
    </main>
  );
}
