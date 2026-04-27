# Type Boundary Principles - 2026-04-27

We should use generated Supabase types, but we should not let database details take over the whole app.

## What Database Types Are For

Use generated Supabase types at the database boundary:

- `src/lib/supabase/*`
- `src/server/repositories/*`
- narrow mapper functions that convert database rows into app-facing DTOs

This helps catch wrong table names, wrong column names, and RPC argument mistakes early.

## What Database Types Are Not For

Do not pass raw database row shapes deep into:

- React components
- email templates
- feed ranking logic
- public API response contracts
- user-facing DTOs in `src/shared/contracts/*`

Those layers should use stable app contracts, even if the database changes behind them.

## Why This Matters

If the app uses database row types everywhere, a small schema change can ripple through unrelated UI and business logic.

The safer pattern is:

```text
Supabase row -> repository mapper -> app DTO -> UI/API/email
```

That gives us the benefit of database type safety without making the whole app overly dependent on database structure.

## Practical Rule

When adding generated `Database` types later:

1. Type the Supabase clients with `createClient<Database>()`.
2. Keep repository return types explicit.
3. Keep existing `src/shared/contracts/*` DTOs as the public shape.
4. Convert database rows to DTOs in mapper functions.
5. Do not import generated table row types directly into components unless there is a very narrow reason.

