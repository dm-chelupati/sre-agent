# Caldova Pharmacy Azure infrastructure

`main.bicep` is a subscription-scope deployment that creates isolated platform, Orders, and Medication Risk resource groups. It provisions:

- Premium Azure Container Registry with managed-identity image pulls
- A zone-redundant, VNet-integrated Container Apps environment
- An external platform gateway and internal-only Orders and Medication Risk apps
- Separate private PostgreSQL Flexible Servers and databases owned by each service team
- Per-application user-assigned managed identities, Key Vault-backed database credentials, and least-privilege RBAC
- Log Analytics, workspace-based Application Insights, diagnostic settings, an alert action group, and service alerts

## Deploy

The committed deployment parameters target the fresh `showcase` environment in `westus2`.

Set secure values without writing them to source:

```bash
export CALDOVA_ALERT_EMAIL='operations@example.com'
export CALDOVA_ORDERS_DB_PASSWORD='<strong-password>'
export CALDOVA_RISK_DB_PASSWORD='<different-strong-password>'
```

Validate and deploy the shared platform and data tier first:

```bash
az deployment sub what-if \
  --location westus2 \
  --template-file main.bicep \
  --parameters main.bicepparam

az deployment sub create \
  --location westus2 \
  --template-file main.bicep \
  --parameters main.bicepparam
```

Build and push the three repositories shown by the `containerImages` deployment output. Replace each placeholder tag in `main.bicepparam` with its immutable build tag, set `deployApplications = true`, then run the deployment again. No registry admin credentials are required; CI should authenticate to ACR with a federated workload identity.
