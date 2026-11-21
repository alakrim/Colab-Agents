import type { AgentNode, PermissionKey } from './types.js';

export const SENSITIVE_FILE_PATTERNS = [
  'config/security/**',
  'security/**',
  '.env*',
  '**/secrets/**',
  'package.json',
  'ARCHITECTURE.md',
];

function globToRegex(glob: string): RegExp {
  const normalized = glob.replace(/^\/+/, '').trim();
  let regexStr = '^';
  let i = 0;
  while (i < normalized.length) {
    const ch = normalized[i];
    if (ch === '*' && normalized[i + 1] === '*') {
      if (normalized[i + 2] === '/') {
        regexStr += '(?:.*/)?';
        i += 3;
      } else {
        regexStr += '.*';
        i += 2;
      }
    } else if (ch === '*') {
      regexStr += '[^/]*';
      i += 1;
    } else if (ch === '?') {
      regexStr += '[^/]';
      i += 1;
    } else if ('\\^$.|+()[]{}'.includes(ch)) {
      regexStr += '\\' + ch;
      i += 1;
    } else {
      regexStr += ch;
      i += 1;
    }
  }
  regexStr += '$';
  return new RegExp(regexStr);
}

export function matchesAnyGlob(filePath: string, globs: string[]): boolean {
  const clean = filePath.replace(/^\/+/, '').replace(/\\/g, '/');
  return globs.some((g) => g.trim().length > 0 && globToRegex(g).test(clean));
}

export function hasPermission(agent: AgentNode, permission: PermissionKey): boolean {
  return agent.permissions.includes(permission);
}

export function canAccessFilePath(
  agent: AgentNode,
  filePath: string,
): { allowed: boolean; reason?: string } {
  const clean = filePath.replace(/^\/+/, '').replace(/\\/g, '/');

  if (clean.includes('..') || clean.startsWith('/')) {
    return { allowed: false, reason: 'Path traversal or absolute paths are strictly forbidden.' };
  }

  if (agent.restrictedPathGlobs.length > 0 && matchesAnyGlob(clean, agent.restrictedPathGlobs)) {
    return {
      allowed: false,
      reason: `Agent ${agent.name} is restricted from accessing path "${clean}".`,
    };
  }

  if (
    agent.allowedPathGlobs.length > 0 &&
    !agent.allowedPathGlobs.includes('**') &&
    !matchesAnyGlob(clean, agent.allowedPathGlobs)
  ) {
    return {
      allowed: false,
      reason: `Path "${clean}" is outside ${agent.name}'s allowed path scopes (${agent.allowedPathGlobs.join(', ')}).`,
    };
  }

  return { allowed: true };
}

export function isSensitivePath(filePath: string): boolean {
  return matchesAnyGlob(filePath, SENSITIVE_FILE_PATTERNS);
}
