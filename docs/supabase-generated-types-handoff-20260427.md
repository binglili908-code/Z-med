# Supabase Generated Types Handoff - 2026-04-27

Goal: reduce guessing around Supabase table fields, view fields, and RPC return shapes.

This task must be coordinated with the DB owner. Do not change tables, RPCs, or DDL as part of this step.

## What We Added

- `npm run db:types`
- `src/scripts/generate-supabase-types.ts`

The script generates:

```text
src/lib/supabase/database.types.ts
```

It does not print API keys, database passwords, or service role keys.

## What The DB Owner Should Do

Option A: use this repo script.

1. Make sure Supabase CLI is logged in on the machine running the command.
2. Set `SUPABASE_PROJECT_REF`, or make sure `NEXT_PUBLIC_SUPABASE_URL` is present in `.env.local`.
3. Run:

```bash
npm run db:types
```

Option B: use Supabase Dashboard.

1. Open the project dashboard.
2. Go to API docs / generated TypeScript types.
3. Download or copy the generated TypeScript file.
4. Save it as:

```text
src/lib/supabase/database.types.ts
```

## Acceptance Check

After the generated file exists, run:

```bash
npm test
npm run lint -- --max-warnings=0
npm run build
```

Then the application code can be updated in a separate step to use:

```ts
createClient<Database>(...)
```

That follow-up should be done after the generated file reflects the real database schema. Until then, we should not create fake table/RPC types.

