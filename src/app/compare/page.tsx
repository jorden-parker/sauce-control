import Link from "next/link";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { gitHubClient } from "@/github/github";
import { settings } from "@/settings/settings";
import { ComparisonForm } from "./comparison-form";

export const dynamic = "force-dynamic";

const Blocker = ({ children }: { children: React.ReactNode }) => (
  <p className="text-sm text-muted-foreground">
    {children}{" "}
    <Link href="/settings" className="underline">
      Open Settings
    </Link>
  </p>
);

export default async function ComparePage() {
  const organisation = settings().getOrganisation(),
    client = await gitHubClient(),
    repositories =
      organisation !== undefined && client !== undefined
        ? await client.listRepositories(organisation)
        : [];

  return (
    <main className="mx-auto w-full max-w-lg p-8">
      <h1 className="mb-6 text-2xl font-semibold tracking-tight">Compare</h1>
      <Card>
        <CardHeader>
          <CardTitle>Choose what to compare</CardTitle>
          <CardDescription>
            A Repository from{" "}
            <span className="font-mono">
              {organisation ?? "your Organisation"}
            </span>
            , the Target Branch under review, and the Base Branch to compare
            against.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {organisation === undefined ? (
            <Blocker>Save a GitHub Organisation first.</Blocker>
          ) : client === undefined ? (
            <Blocker>
              No GitHub credential found. Log in with{" "}
              <span className="font-mono">gh</span> or paste a personal access
              token.
            </Blocker>
          ) : (
            <ComparisonForm
              repositories={repositories}
              saved={settings().getComparisonSelection()}
            />
          )}
        </CardContent>
      </Card>
    </main>
  );
}
