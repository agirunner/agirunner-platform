# TODO — Fix review issues for built-in worker roles (PR #44)

- [ ] Review current branch diff and confirm issue #45/#46/#47 scope in code/tests
- [ ] Implement runtime prohibited-operations guard in `createBuiltInTaskHandler`
- [ ] Add/adjust unit test proving docker-exec capability is rejected with clear error
- [ ] Differentiate `modelPreference` values across all built-in roles config
- [ ] Add integer min/max range test coverage for output validator
- [ ] Run quality gates: `pnpm build && pnpm test && pnpm lint`
- [ ] Commit changes with conventional commit message referencing issues #45/#46/#47
- [ ] Push to `feature/built-in-worker-roles`
- [ ] Update PR #44 with a comment summarizing fixes
