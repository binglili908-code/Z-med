# GitHub Tooling Candidates - 2026-04-27

This note records GitHub projects worth borrowing from or integrating to reduce guessing around config, API contracts, database fields, and external services.

## Recommended Order

1. Supabase generated database types
   - Goal: stop guessing table and RPC field shapes in application code.
   - Fit: high.
   - Risk: needs DB owner coordination because generated types must reflect the real schema.
   - Suggested next step: ask the DB owner to export a production-compatible `database.types.ts`, then wire Supabase clients to `createClient<Database>()`.

2. MSW
   - Goal: test MiniMax, Resend, PubMed, NCBI, and Unpaywall without calling real services.
   - Fit: high for this project because several bugs came from external API shape and failure cases.
   - Risk: moderate setup cost, but can start with one API.
   - Suggested next step: mock PubMed ESpell and MeSH endpoints first because the new PubMed assist module already has focused tests.

3. ts-rest
   - Goal: define API request and response contracts once, then share them between route handlers and callers.
   - Fit: medium-high, especially for `/api/papers/feed`, subscription, and admin cron endpoints.
   - Risk: larger refactor than env or MSW.
   - Suggested next step: borrow the contract style for one endpoint before adding the full dependency.

4. t3-env
   - Goal: standardize Next.js environment variable validation.
   - Fit: medium now because the project already has a lightweight Zod-based env checker.
   - Risk: adding it immediately may duplicate the custom checker.
   - Suggested next step: keep the current small checker unless client/server env splitting becomes harder.

5. openapi-typescript / orval
   - Goal: generate clients and validation from OpenAPI.
   - Fit: medium if this project later exposes or consumes formal OpenAPI specs.
   - Risk: low value until API specs exist.
   - Suggested next step: revisit after internal API contracts are stabilized.

6. kysely-codegen / PgTyped
   - Goal: generate types for direct SQL query builders or raw SQL files.
   - Fit: low right now because the app mainly uses Supabase client/repositories rather than Kysely/raw SQL.
   - Risk: unnecessary extra layer if introduced too early.
   - Suggested next step: defer unless direct SQL grows.

## Current Decision

The safest near-term path is:

1. Keep the new Zod env checker.
2. Coordinate Supabase generated database types with the DB owner.
3. Add MSW for external API tests.
4. Pilot one API contract pattern before adopting ts-rest broadly.

