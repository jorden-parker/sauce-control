/** The subset of `fetch` the client needs, so tests can supply a fake GitHub. */
export type FetchLike = (
  url: string,
  init?: { headers?: Record<string, string> }
) => Promise<Response>;

export interface Repository {
  defaultBranch: string;
  name: string;
}

export interface GitHubClient {
  /** Every branch name of one Repository. */
  listBranches: (organisation: string, repository: string) => Promise<string[]>;
  /** Every Repository in the Organisation, sorted by name. */
  listRepositories: (organisation: string) => Promise<Repository[]>;
}

const API = "https://api.github.com",
  NEXT_LINK = /<([^>]+)>;\s*rel="next"/u;

interface RepositoryResponse {
  default_branch: string;
  name: string;
}

interface BranchResponse {
  name: string;
}

const nextPage = (response: Response): string | undefined =>
    NEXT_LINK.exec(response.headers.get("link") ?? "")?.[1],
  errorMessage = async (response: Response): Promise<string> => {
    try {
      const body = (await response.json()) as { message?: string };
      return body.message ?? response.statusText;
    } catch {
      return response.statusText;
    }
  };

export const createGitHubClient = (
  fetch: FetchLike,
  token: string
): GitHubClient => {
  const headers = {
      accept: "application/vnd.github+json",
      authorization: `Bearer ${token}`,
    },
    /** Collects every page of a list endpoint by following `Link: rel="next"`; pages are sequential because each names the next. */
    getPages = async <T>(url: string, collected: T[]): Promise<T[]> => {
      const response = await fetch(url, { headers });
      if (!response.ok) {
        throw new Error(
          `GitHub responded ${response.status}: ${await errorMessage(response)}`
        );
      }
      const page = (await response.json()) as T[],
        items = [...collected, ...page],
        next = nextPage(response);
      return next === undefined ? items : getPages(next, items);
    },
    getAll = <T>(path: string): Promise<T[]> =>
      getPages<T>(`${API}${path}`, []);

  return {
    listBranches: async (organisation, repository) => {
      const branches = await getAll<BranchResponse>(
        `/repos/${encodeURIComponent(organisation)}/${encodeURIComponent(repository)}/branches?per_page=100`
      );
      return branches.map((branch) => branch.name);
    },
    listRepositories: async (organisation) => {
      const repositories = await getAll<RepositoryResponse>(
        `/orgs/${encodeURIComponent(organisation)}/repos?per_page=100&sort=full_name`
      );
      return repositories.map((repository) => ({
        defaultBranch: repository.default_branch,
        name: repository.name,
      }));
    },
  };
};
