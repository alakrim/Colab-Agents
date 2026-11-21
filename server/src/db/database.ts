import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { SCHEMA_SQL } from './schema.js';

export interface WorkspacePaths {
  dataRoot: string;
  dbPath: string;
  canonicalProjectDir: string;
  sandboxesDir: string;
  recoveryDir: string;
}

export function resolveWorkspacePaths(customRoot?: string): WorkspacePaths {
  const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
  const dataRoot = customRoot
    ? path.resolve(customRoot)
    : path.resolve(process.env.AGENT_COMPANY_DATA_DIR || path.join(repoRoot, 'workspace-data'));

  const canonicalProjectDir = path.join(dataRoot, 'project-files');
  const sandboxesDir = path.join(dataRoot, 'sandboxes');
  const recoveryDir = path.join(dataRoot, 'recovery-drafts');
  const dbPath = path.join(dataRoot, 'agent-company.db');

  fs.mkdirSync(dataRoot, { recursive: true });
  fs.mkdirSync(canonicalProjectDir, { recursive: true });
  fs.mkdirSync(sandboxesDir, { recursive: true });
  fs.mkdirSync(recoveryDir, { recursive: true });

  return { dataRoot, dbPath, canonicalProjectDir, sandboxesDir, recoveryDir };
}

export class AppDatabase {
  public readonly db: DatabaseSync;
  public readonly paths: WorkspacePaths;

  constructor(customRoot?: string) {
    this.paths = resolveWorkspacePaths(customRoot);
    this.db = new DatabaseSync(this.paths.dbPath);
    this.db.exec(SCHEMA_SQL);
  }

  public transaction<T>(fn: () => T): T {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const result = fn();
      this.db.exec('COMMIT');
      return result;
    } catch (err) {
      try {
        this.db.exec('ROLLBACK');
      } catch {
        // ignore rollback error
      }
      throw err;
    }
  }

  public close(): void {
    this.db.close();
  }
}
