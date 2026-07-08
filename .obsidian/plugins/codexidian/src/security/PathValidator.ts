export interface PathValidationResult {
  allowed: boolean;
  reason?: string;
}

type Operation = "read" | "write";

export class PathValidator {
  private readonly blockedPatterns: string[];

  constructor(blockedPatterns: string[]) {
    this.blockedPatterns = blockedPatterns
      .map((pattern) => this.normalizePattern(pattern))
      .filter((pattern): pattern is string => Boolean(pattern));
  }

  isBlocked(path: string): boolean {
    return this.getMatchedPattern(path) !== null;
  }

  validate(path: string, operation: Operation): PathValidationResult {
    const matchedPattern = this.getMatchedPattern(path);
    if (!matchedPattern) {
      return { allowed: true };
    }

    return {
      allowed: false,
      reason: `Path matches security blocklist (${matchedPattern}) for ${operation}.`,
    };
  }

  private getMatchedPattern(path: string): string | null {
    const normalizedPath = this.normalizePath(path);
    if (!normalizedPath) {
      return null;
    }

    const baseName = normalizedPath.split("/").pop() ?? normalizedPath;
    for (const pattern of this.blockedPatterns) {
      if (this.matchesPattern(normalizedPath, baseName, pattern)) {
        return pattern;
      }
    }
    return null;
  }

  private matchesPattern(path: string, baseName: string, pattern: string): boolean {
    if (pattern.includes("*")) {
      const regex = this.wildcardToRegex(pattern);
      if (pattern.includes("/")) {
        return regex.test(path);
      }
      return regex.test(baseName) || regex.test(path);
    }

    if (pattern.endsWith("/")) {
      const prefix = `${pattern.replace(/\/+$/, "")}/`;
      return path.startsWith(prefix) || path.includes(`/${prefix}`);
    }

    if (pattern.includes("/")) {
      return path === pattern || path.startsWith(`${pattern}/`);
    }

    return baseName === pattern || path === pattern || path.endsWith(`/${pattern}`);
  }

  private wildcardToRegex(pattern: string): RegExp {
    const escaped = pattern
      .replace(/[|\\{}()[\]^$+?.]/g, "\\$&")
      .replace(/\*/g, ".*");
    return new RegExp(`^${escaped}$`, "i");
  }

  private normalizePattern(pattern: string): string | null {
    const trimmed = pattern.trim();
    if (!trimmed) {
      return null;
    }
    const normalized = trimmed
      .replace(/\\/g, "/")
      .replace(/\/{2,}/g, "/")
      .replace(/^\/+/, "")
      .toLowerCase();
    return normalized || null;
  }

  private normalizePath(path: string): string {
    return path
      .trim()
      .replace(/\\/g, "/")
      .replace(/^\.\//, "")
      .replace(/\/{2,}/g, "/")
      .replace(/^\/+/, "")
      .toLowerCase();
  }
}
