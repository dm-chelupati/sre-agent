targetScope = 'resourceGroup'

param location string
param tags object
param appName string
param targetPort int
param externalIngress bool
param minReplicas int
param maxReplicas int

@allowed([
  '0.25'
  '0.5'
  '0.75'
  '1.0'
  '1.25'
  '1.5'
  '1.75'
  '2.0'
])
param cpu string

@allowed([
  '0.5Gi'
  '1Gi'
  '1.5Gi'
  '2Gi'
  '3Gi'
  '3.5Gi'
  '4Gi'
])
param memory string

param imageRepository string
param imageTag string
param containerAppsEnvironmentResourceId string
param identityResourceId string
param registryName string
param platformResourceGroupName string
param appInsightsName string
param actionGroupResourceId string
param environmentVariables array
param keyVaultSecrets array

resource registry 'Microsoft.ContainerRegistry/registries@2023-07-01' existing = {
  scope: resourceGroup(platformResourceGroupName)
  name: registryName
}

resource appInsights 'Microsoft.Insights/components@2020-02-02' existing = {
  scope: resourceGroup(platformResourceGroupName)
  name: appInsightsName
}

resource containerApp 'Microsoft.App/containerApps@2024-03-01' = {
  name: appName
  location: location
  tags: tags
  identity: {
    type: 'UserAssigned'
    userAssignedIdentities: {
      '${identityResourceId}': {}
    }
  }
  properties: {
    environmentId: containerAppsEnvironmentResourceId
    workloadProfileName: 'Consumption'
    configuration: {
      activeRevisionsMode: 'Single'
      maxInactiveRevisions: 10
      ingress: {
        allowInsecure: false
        external: externalIngress
        targetPort: targetPort
        transport: 'auto'
        traffic: [
          {
            latestRevision: true
            weight: 100
          }
        ]
      }
      registries: [
        {
          server: registry.properties.loginServer
          identity: identityResourceId
        }
      ]
      secrets: keyVaultSecrets
    }
    template: {
      containers: [
        {
          name: 'app'
          image: '${registry.properties.loginServer}/${imageRepository}:${imageTag}'
          env: concat(
            [
              {
                name: 'APPLICATIONINSIGHTS_CONNECTION_STRING'
                value: appInsights.properties.ConnectionString
              }
            ],
            environmentVariables
          )
          resources: {
            cpu: json(cpu)
            memory: memory
          }
          probes: [
            {
              type: 'Startup'
              httpGet: {
                path: '/health/ready'
                port: targetPort
                scheme: 'HTTP'
              }
              initialDelaySeconds: 5
              periodSeconds: 5
              failureThreshold: 30
              timeoutSeconds: 3
            }
            {
              type: 'Readiness'
              httpGet: {
                path: '/health/ready'
                port: targetPort
                scheme: 'HTTP'
              }
              initialDelaySeconds: 5
              periodSeconds: 10
              failureThreshold: 3
              successThreshold: 1
              timeoutSeconds: 3
            }
            {
              type: 'Liveness'
              httpGet: {
                path: '/health/live'
                port: targetPort
                scheme: 'HTTP'
              }
              initialDelaySeconds: 30
              periodSeconds: 30
              failureThreshold: 3
              timeoutSeconds: 3
            }
          ]
        }
      ]
      scale: {
        minReplicas: minReplicas
        maxReplicas: maxReplicas
        rules: [
          {
            name: 'http-concurrency'
            http: {
              metadata: {
                concurrentRequests: '50'
              }
            }
          }
        ]
      }
    }
  }
}

resource restartAlert 'Microsoft.Insights/metricAlerts@2018-03-01' = {
  name: '${appName}-restart-count'
  location: 'global'
  tags: tags
  properties: {
    description: 'Container restart count is elevated for ${appName}.'
    severity: 2
    enabled: true
    autoMitigate: true
    scopes: [
      containerApp.id
    ]
    evaluationFrequency: 'PT5M'
    windowSize: 'PT15M'
    criteria: {
      'odata.type': 'Microsoft.Azure.Monitor.SingleResourceMultipleMetricCriteria'
      allOf: [
        {
          name: 'RestartCount'
          criterionType: 'StaticThresholdCriterion'
          metricName: 'RestartCount'
          metricNamespace: 'Microsoft.App/containerApps'
          operator: 'GreaterThan'
          threshold: 3
          timeAggregation: 'Total'
        }
      ]
    }
    actions: [
      {
        actionGroupId: actionGroupResourceId
      }
    ]
  }
}

output appName string = containerApp.name
output appResourceId string = containerApp.id
output fqdn string = containerApp.properties.configuration.ingress.fqdn
