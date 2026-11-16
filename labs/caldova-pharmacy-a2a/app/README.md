# Caldova Pharmacy application

This npm workspace contains the external platform gateway, React pharmacy portal,
Orders API, Medication Risk API, shared contracts, and shared runtime platform
utilities. Orders and Risk use independent PostgreSQL connection strings and
schemas; no seed data is installed.

## Commands

```bash
npm ci
npm run lint
npm run typecheck
npm test
npm run build
```

Services apply their own ordered SQL migrations under a PostgreSQL advisory lock
at startup. Set the values in `.env.example`, then run `dev:risk`, `dev:orders`,
`dev:gateway`, and `dev:portal` in separate terminals. The production gateway
serves the portal build from `PORTAL_DIST_PATH`.

Images use the application directory as build context:

```bash
docker build -f apps/risk/Dockerfile -t caldova-risk .
docker build -f apps/orders/Dockerfile -t caldova-orders .
docker build -f apps/gateway/Dockerfile -t caldova-gateway .
```
