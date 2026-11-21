import crypto from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { AppDatabase } from '../db/database.js';
import type { GitHubIssueSummary, GitHubPrSummary, GitHubRepo } from '../domain/types.js';
import type { AuditService } from './auditService.js';
import type { RealtimeHub } from './realtime.js';

const execFileAsync = promisify(execFile);

export class GitHubService {
  constructor(
    private readonly appDb: AppDatabase,
    private readonly audit: AuditService,
    private readonly realtime: RealtimeHub,
  ) {}

  private mapRepo(r: Record<string, unknown>): GitHubRepo {
    return {
      id: String(r.id),
      fullName: String(r.full_name),
      defaultBranch: String(r.default_branch || 'main'),
      localPath: r.local_path ? String(r.local_path) : null,
      protectedBranches: JSON.parse(String(r.protected_branches_json || '["main","master"]')),
      reviewPolicy: (r.review_policy as GitHubRepo['reviewPolicy']) || 'cross_provider_required',
      connectedAt: String(r.connected_at),
      lastSyncedAt: r.last_synced_at ? String(r.last_synced_at) : null,
    };
  }

  public listRepos(): GitHubRepo[] {
    const rows = this.appDb.db.prepare('SELECT * FROM github_repos ORDER BY connected_at ASC').all();
    return rows.map((r) => this.mapRepo(r));
  }

  public getRepo(id: string): GitHubRepo | null {
    const row = this.appDb.db.prepare('SELECT * FROM github_repos WHERE id = ?').get(id);
    return row ? this.mapRepo(row) : null;
  }

  public connectRepo(input: {
    fullName: string;
    defaultBranch?: string;
    localPath?: string | null;
    protectedBranches?: string[];
    reviewPolicy?: 'standard' | 'cross_provider_required';
  }): GitHubRepo {
    const clean = input.fullName.trim().replace(/^https?:\/\/github\.com\//i, '').replace(/\.git$/i, '').replace(/^\/+|\/+$/g, '');
    if (!/^[^/\s]+\/[^/\s]+$/.test(clean)) {
      throw new Error('Repository must be in "owner/repo" format (e.g. alakrim/Colab-Agents).');
    }

    const now = new Date().toISOString();
    const id = `gh-${crypto.randomUUID().slice(0, 8)}`;
    this.appDb.db
      .prepare(
        `INSERT INTO github_repos (
          id, full_name, default_branch, local_path, protected_branches_json, review_policy, connected_at, last_synced_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, NULL)`,
      )
      .run(
        id,
        clean,
        (input.defaultBranch || 'main').trim(),
        input.localPath?.trim() || null,
        JSON.stringify(input.protectedBranches ?? ['main', 'master']),
        input.reviewPolicy ?? 'cross_provider_required',
        now,
      );

    const repo = this.getRepo(id)!;
    this.audit.record({
      actorType: 'human',
      actorId: 'human-exec',
      actorName: 'Executive Supervisor',
      category: 'org',
      action: 'github.repo_connected',
      targetType: 'github_repo',
      targetId: repo.id,
      summary: `Connected GitHub project "${repo.fullName}" (review policy: ${repo.reviewPolicy}).`,
    });
    this.realtime.broadcast('github:updated', repo);
    return repo;
  }

  public updateRepo(
    id: string,
    patch: Partial<Pick<GitHubRepo, 'defaultBranch' | 'localPath' | 'protectedBranches' | 'reviewPolicy'>>,
  ): GitHubRepo {
    const cur = this.getRepo(id);
    if (!cur) throw new Error(`GitHub repo ${id} not found.`);
    const next = {
      ...cur,
      defaultBranch: patch.defaultBranch ?? cur.defaultBranch,
      localPath: patch.localPath !== undefined ? patch.localPath : cur.localPath,
      protectedBranches: patch.protectedBranches ?? cur.protectedBranches,
      reviewPolicy: patch.reviewPolicy ?? cur.reviewPolicy,
    };

    this.appDb.db
      .prepare(
        `UPDATE github_repos SET default_branch = ?, local_path = ?, protected_branches_json = ?, review_policy = ? WHERE id = ?`,
      )
      .run(next.defaultBranch, next.localPath, JSON.stringify(next.protectedBranches), next.reviewPolicy, id);

    const updated = this.getRepo(id)!;
    this.realtime.broadcast('github:updated', updated);
    return updated;
  }

  public removeRepo(id: string): void {
    this.appDb.db.prepare('DELETE FROM github_repos WHERE id = ?').run(id);
    this.realtime.broadcast('github:updated', { id, deleted: true });
  }

  /**
   * Read-only live sync with GitHub via authenticated `gh` CLI when available on the host.
   * Never fabricates issues or PRs — transparently reports gh availability if offline/unauthenticated.
   */
  public async fetchLiveRepoState(id: string): Promise<{
    repo: GitHubRepo;
    ghAvailable: boolean;
    error?: string;
    issues: GitHubIssueSummary[];
    pullRequests: GitHubPrSummary[];
  }> {
    const repo = this.getRepo(id);
    if (!repo) throw new Error(`GitHub repo ${id} not found.`);

    try {
      const [issuesOut, prsOut] = await Promise.all([
        execFileAsync(
          'gh',
          [
            'issue',
            'list',
            '-R',
            repo.fullName,
            '--state',
            'open',
            '--limit',
            '20',
            '--json',
            'number,title,state,url,labels,author,updatedAt',
          ],
          { timeout: 10000 },
        ),
        execFileAsync(
          'gh',
          [
            'pr',
            'list',
            '-R',
            repo.fullName,
            '--state',
            'open',
            '--limit',
            '20',
            '--json',
            'number,title,state,url,headRefName,baseRefName,isDraft,reviewDecision,author,updatedAt',
          ],
          { timeout: 10000 },
        ),
      ]);

      const rawIssues = JSON.parse(issuesOut.stdout || '[]') as Array<Record<string, unknown>>;
      const rawPrs = JSON.parse(prsOut.stdout || '[]') as Array<Record<string, unknown>>;

      const issues: GitHubIssueSummary[] = rawIssues.map((i) => ({
        number: Number(i.number),
        title: String(i.title),
        state: String(i.state),
        url: String(i.url),
        labels: Array.isArray(i.labels) ? i.labels.map((l) => String((l as { name?: string }).name || '')) : [],
        author: String((i.author as { login?: string } | undefined)?.login || 'unknown'),
        updatedAt: String(i.updatedAt || ''),
      }));

      const pullRequests: GitHubPrSummary[] = rawPrs.map((p) => ({
        number: Number(p.number),
        title: String(p.title),
        state: String(p.state),
        url: String(p.url),
        headRefName: String(p.headRefName || ''),
        baseRefName: String(p.baseRefName || repo.defaultBranch),
        isDraft: Boolean(p.isDraft),
        reviewDecision: String(p.reviewDecision || 'REVIEW_REQUIRED'),
        author: String((p.author as { login?: string } | undefined)?.login || 'unknown'),
        updatedAt: String(p.updatedAt || ''),
      }));

      const now = new Date().toISOString();
      this.appDb.db.prepare('UPDATE github_repos SET last_synced_at = ? WHERE id = ?').run(now, id);

      return {
        repo: this.getRepo(id)!,
        ghAvailable: true,
        issues,
        pullRequests,
      };
    } catch (err) {
      return {
        repo,
        ghAvailable: false,
        error:
          err instanceof Error
            ? `GitHub CLI read-only sync unavailable (${err.message.split('\n')[0]}). Connect gh locally to sync live issues & PRs.`
            : 'GitHub CLI unavailable.',
        issues: [],
        pullRequests: [],
      };
    }
  }

  public suggestAgentBranch(agentName: string, title: string, issueNumber?: number | null): string {
    const cleanAgent = agentName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'agent';
    const cleanSlug = title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 28) || 'work';
    return issueNumber ? `agent/${cleanAgent}/issue-${issueNumber}-${cleanSlug}` : `agent/${cleanAgent}/${cleanSlug}`;
  }
}
