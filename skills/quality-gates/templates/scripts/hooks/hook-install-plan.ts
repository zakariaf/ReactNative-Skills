// scripts/hooks/hook-install-plan.ts
// Decides whether npm's "prepare" installs the lefthook git hooks (install-git-hooks.ts acts on it):
// only when this package folder is the git top level. A package without a repository (npm ci in a
// Docker build context or an EAS no-VCS upload) needs no hooks, and a package nested in a larger
// repository (an example app, a reference app under tools/) must not write hooks into the enclosing
// repository, whose own root installs them.

/** What `git rev-parse --show-toplevel` answered in the package folder (real paths). */
export type GitTopLevel =
  | { readonly found: true; readonly topLevel: string }
  | { readonly found: false; readonly detail: string };

export type HookInstallPlan =
  { readonly install: true } | { readonly install: false; readonly reason: string };

function withoutTrailingSeparator(dir: string): string {
  return dir.length > 1 ? dir.replace(/[\\/]+$/u, '') : dir;
}

/** Install only when the package root is the git top level; otherwise say why the install is skipped. */
export function planHookInstall(packageRoot: string, git: GitTopLevel): HookInstallPlan {
  if (!git.found) {
    return {
      install: false,
      reason: `${packageRoot} is not in a git repository (${git.detail}); a checkout without .git needs no git hooks`,
    };
  }
  if (withoutTrailingSeparator(git.topLevel) === withoutTrailingSeparator(packageRoot)) {
    return { install: true };
  }
  return {
    install: false,
    reason: `${packageRoot} is not the top level of the git repository ${git.topLevel}; that repository's root installs its own hooks`,
  };
}
