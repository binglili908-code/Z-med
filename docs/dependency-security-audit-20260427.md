# Dependency Security Audit - 2026-04-27

## Scope

Reviewed npm dependency advisories reported by:

```bash
npm audit --json
npm audit --omit=dev --json
npm audit fix --dry-run --json
```

This review only touched package dependencies and lockfile resolution. It did
not change application database schema, Supabase RPCs, or production data.

## Initial Findings

Full dependency tree:

- 8 total advisories
- 3 high
- 5 moderate

Production dependency tree only:

- 5 total advisories
- 1 high
- 4 moderate

The production-relevant issues were:

- `next@15.5.8`: multiple Next.js denial-of-service / request handling
  advisories.
- `next -> postcss@8.4.31`: PostCSS CSS stringify XSS advisory.
- `resend@6.9.4 -> svix -> uuid`: transitive advisory from `uuid`.

The development-only issues were:

- `brace-expansion`
- `flatted`
- `picomatch`

## Changes Applied

Upgraded direct dependencies:

- `next`: `15.5.8` -> `15.5.15`
- `eslint-config-next`: `15.5.8` -> `15.5.15`
- `resend`: `^6.9.4` -> `^6.12.2`
- `postcss`: `^8.4.47` -> `^8.5.12`

Added npm override:

```json
{
  "overrides": {
    "resend": {
      "svix": "1.92.2"
    }
  }
}
```

Reason: latest `resend@6.12.2` still declared `svix@1.90.0`, while the npm
advisory marks `svix` versions through `1.91.1` as affected through `uuid`.
`svix@1.92.2` removes that vulnerable `uuid` dependency.

Ran non-force audit repair:

```bash
npm audit fix
```

This resolved the remaining development-only transitive advisories without
major upgrades.

## Current Residual Audit Output

After the fixes:

```bash
npm audit --omit=dev
```

still reports:

- 2 moderate advisories
- both are `next -> postcss@8.4.31`

This is currently a Next.js upstream dependency declaration issue:

- `next@15.5.15` is the latest Next 15 release.
- latest `next@16.2.4` also declares internal `postcss@8.4.31`.
- npm's suggested automatic fix is `npm audit fix --force`, which would install
  `next@9.3.3`. That is a breaking downgrade and is not acceptable for this app.

An attempted npm override for `next -> postcss@8.5.12` was rejected by npm as an
invalid dependency tree, so it was not kept.

## Risk Assessment

Resolved:

- High Next.js DoS advisories fixed by moving from `15.5.8` to `15.5.15`.
- Resend/Svix/UUID advisory fixed by upgrading Resend and overriding Svix to
  `1.92.2`.
- Development-only advisories fixed by non-force `npm audit fix`.

Remaining:

- Moderate PostCSS advisory under Next internals.
- Current app does not accept user-supplied CSS and stringify it through
  PostCSS in a user-facing workflow, so this is not an immediate application
  exploit path from current code.
- Keep monitoring Next releases and npm advisory behavior. Do not run
  `npm audit fix --force` for this item unless a deliberate Next migration or
  rollback plan exists.

## Verification

Passed after dependency changes:

```bash
npm test
npm run lint -- --max-warnings=0
npm run build
```

Build result used:

- `next@15.5.15`

## Follow-Up

- Re-run `npm audit --omit=dev` after the next Next.js patch release.
- If Next publishes a patch that moves internal PostCSS to `>=8.5.10`, upgrade
  Next and remove the residual audit note.
- Keep the `resend -> svix` override until Resend itself depends on a fixed
  Svix release.
