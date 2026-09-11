import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { GitHubToken } from "@/github/github-token";
import { saveGitHubToken } from "./actions";

const STATUS: Record<GitHubToken["source"] | "none", string> = {
  gh: "Using your gh CLI login.",
  keychain: "Using the personal access token in your keychain.",
  none: "No credential found. Log in with gh, or paste a token below.",
};

export const GitHubAccessCard = ({
  source,
}: {
  source: GitHubToken["source"] | undefined;
}) => (
  <Card>
    <CardHeader>
      <CardTitle>GitHub access</CardTitle>
      <CardDescription>
        The tool reuses your <span className="font-mono">gh</span> login when it
        can. A pasted token is kept in the OS keychain, never on disk or in
        logs.
      </CardDescription>
    </CardHeader>
    <CardContent>
      <p className="mb-4 text-sm" data-testid="github-token-source">
        {STATUS[source ?? "none"]}
      </p>
      <form action={saveGitHubToken} className="flex flex-col gap-4">
        <div className="flex flex-col gap-2">
          <Label htmlFor="githubToken">Personal access token</Label>
          <Input
            id="githubToken"
            name="githubToken"
            type="password"
            placeholder="ghp_…"
            autoComplete="off"
            required
          />
        </div>
        <Button type="submit" variant="secondary" className="self-start">
          Save token
        </Button>
      </form>
    </CardContent>
  </Card>
);
