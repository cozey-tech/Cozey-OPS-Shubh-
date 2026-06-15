# Inventory Dashboard

Office stock monitor for Cozey's Canadian fulfillment centres (Royalmount, Langley,
Windsor). Low-stock, restock intelligence, incoming POs, and cross-FC transfer views
over COS production inventory.

- **Frontend:** Create React App (`src/`), served as a static SPA.
- **Backend:** one Vercel serverless function (`api/inventory.js`).
- **Data:** read-only COS Neon database via the `cos_mcp_reader` role, querying the
  masked `mcp.v_*` views only. The app never writes.

## Architecture

```
src/App.js            React UI (tabs, filters, CSV export)
api/inventory.js      GET /api/inventory — all read queries
api/_cosPool.js       pooled, TLS-verified, read-only COS connection
api/_auth.js          CORS scoping (+ office-secret helper for future writes)
```

`api/_cosPool.js` and `api/_auth.js` mirror the conventions in the sibling
`warehouse-dashboard-` repo: a singleton `pg.Pool`, verified TLS, `BEGIN READ ONLY`
+ `statement_timeout`, transient-error retry, and a `SELECT`/`WITH`-only guard.

## Security model

- **Access gate:** the API is read-only with no per-request auth. The production
  gate is **Vercel Deployment Protection** (password/SSO) — enable it before
  connecting production data.
- **CORS** is scoped to `DASHBOARD_ORIGIN` (no `*`).
- All user input is **bound as query parameters** or validated against allowlists
  — no string interpolation into SQL.
- TLS certificate verification is **on** (Neon's cert is publicly trusted).
- DB errors are logged server-side; clients get a generic message.

## Local development

```bash
npm install
cp .env.example .env.local   # fill in DATABASE_MCP_URL
npm start                    # CRA dev server (proxy /api to `vercel dev` if testing the API)
```

To exercise the API locally, run `vercel dev` (Vercel CLI) so the function in `api/`
is served. Set `PGSSL=disable` only when pointing at a local Postgres.

## Environment variables

See [.env.example](.env.example). Required: `DATABASE_MCP_URL`, `DASHBOARD_ORIGIN`.

## Deploy

Vercel project. Set the env vars in **Production + Preview**, enable Deployment
Protection, and push. `vercel.json` rewrites `/api/*` to the functions and
everything else to the SPA.
