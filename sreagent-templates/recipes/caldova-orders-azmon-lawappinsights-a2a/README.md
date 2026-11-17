# caldova-orders-azmon-lawappinsights-a2a

Application-team SRE Agent for Caldova Pharmacy prescription ordering and fulfillment. It accepts A2A work only from the Caldova platform agent.

## Create

```bash
./bin/new-agent.sh --recipe caldova-orders-azmon-lawappinsights-a2a --non-interactive \
  --subscription <subscription-id> \
  --set lawId=<orders-law-resource-id> \
  --set appInsightsId=<orders-app-insights-resource-id> \
  --set appInsightsAppId=<orders-app-insights-app-id> \
  -o caldova-orders-sre/
```

```bash
./bin/deploy.sh caldova-orders-sre/
./bicep/apply-extras.sh <subscription-id> caldova-agents-rg caldova-orders-sre caldova-orders-sre/
```

This recipe contains no skills, knowledge documents, or diagnostic instructions.
