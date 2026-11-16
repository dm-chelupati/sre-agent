# caldova-platform-sre

Shared-platform SRE Agent for Caldova Pharmacy. It observes the portal and gateway, then can delegate one task to either application-team agent and synthesize the returned result.

## Create

```bash
./bin/new-agent.sh --recipe caldova-platform-sre --non-interactive \
  --subscription <subscription-id> \
  --set lawId=<platform-law-resource-id> \
  --set appInsightsId=<platform-app-insights-resource-id> \
  --set appInsightsAppId=<platform-app-insights-app-id> \
  -o caldova-platform-sre/
```

Deploy all three Caldova agents before applying extras so the target agent cards and managed identities are available.

```bash
./bin/deploy.sh caldova-platform-sre/
./bicep/apply-extras.sh <subscription-id> caldova-agents-rg caldova-platform-sre caldova-platform-sre/
```

This recipe contains no skills, knowledge documents, or diagnostic instructions.
