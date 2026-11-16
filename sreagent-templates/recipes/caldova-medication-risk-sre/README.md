# caldova-medication-risk-sre

Application-team SRE Agent for Caldova Pharmacy medication-safety decisions. It accepts A2A work only from the Caldova platform agent.

## Create

```bash
./bin/new-agent.sh --recipe caldova-medication-risk-sre --non-interactive \
  --subscription <subscription-id> \
  --set lawId=<risk-law-resource-id> \
  --set appInsightsId=<risk-app-insights-resource-id> \
  --set appInsightsAppId=<risk-app-insights-app-id> \
  -o caldova-medication-risk-sre/
```

```bash
./bin/deploy.sh caldova-medication-risk-sre/
./bicep/apply-extras.sh <subscription-id> caldova-agents-rg caldova-medication-risk-sre caldova-medication-risk-sre/
```

This recipe contains no skills, knowledge documents, or diagnostic instructions.
