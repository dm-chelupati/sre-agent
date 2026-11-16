targetScope = 'subscription'

@description('Azure region used for all Caldova Pharmacy resources.')
param location string = 'westus2'

@description('Short environment name used in resource names and tags.')
@allowed([
  'dev'
  'test'
  'staging'
  'prod'
  'showcase'
])
param environmentName string = 'showcase'

@description('Workload name used in resource names and tags.')
@minLength(3)
@maxLength(24)
param workloadName string = 'caldova-pharmacy'

@description('Email address that receives Azure Monitor alerts.')
param alertEmailAddress string

@description('Administrator login for the Orders PostgreSQL server.')
param ordersDatabaseAdministratorLogin string = 'caldova_orders_admin'

@description('Administrator password for the Orders PostgreSQL server. Supply through a secure deployment parameter.')
@secure()
@minLength(12)
param ordersDatabaseAdministratorPassword string

@description('Administrator login for the Medication Risk PostgreSQL server.')
param riskDatabaseAdministratorLogin string = 'caldova_risk_admin'

@description('Administrator password for the Medication Risk PostgreSQL server. Supply through a secure deployment parameter.')
@secure()
@minLength(12)
param riskDatabaseAdministratorPassword string

@description('PostgreSQL Flexible Server compute SKU.')
param postgresSkuName string = 'Standard_D2ds_v5'

@description('PostgreSQL Flexible Server major version.')
@allowed([
  '16'
  '17'
])
param postgresVersion string = '16'

@description('Immutable ACR image tag for the platform gateway.')
param platformImageTag string

@description('Immutable ACR image tag for the Orders service.')
param ordersImageTag string

@description('Immutable ACR image tag for the Medication Risk service.')
param riskImageTag string

@description('ACR repository containing the platform gateway image.')
param platformImageRepository string = 'caldova/platform-gateway'

@description('ACR repository containing the Orders service image.')
param ordersImageRepository string = 'caldova/orders'

@description('ACR repository containing the Medication Risk service image.')
param riskImageRepository string = 'caldova/medication-risk'

@description('Deploy Container Apps after the referenced images have been pushed to ACR.')
param deployApplications bool = true

@description('Additional tags applied to every resource group and supported resource.')
param tags object = {}

var uniqueSuffix = take(uniqueString(subscription().id, workloadName, environmentName, location), 6)
var compactWorkloadName = toLower(replace(workloadName, '-', ''))
var containerAppNamePrefix = '${take(compactWorkloadName, 7)}-${environmentName}'
var keyVaultWorkloadToken = take(compactWorkloadName, 8)
var locationToken = take(toLower(replace(location, ' ', '')), 4)
var commonTags = union(tags, {
  Workload: workloadName
  Environment: environmentName
  ManagedBy: 'Bicep'
})

var platformResourceGroupName = '${workloadName}-${environmentName}-platform-rg'
var ordersResourceGroupName = '${workloadName}-${environmentName}-orders-rg'
var riskResourceGroupName = '${workloadName}-${environmentName}-risk-rg'

var registryName = take('${compactWorkloadName}${environmentName}${uniqueSuffix}acr', 50)
var workspaceName = '${workloadName}-${environmentName}-logs'
var appInsightsName = '${workloadName}-${environmentName}-appi'
var containerAppsEnvironmentName = '${workloadName}-${environmentName}-cae'
var virtualNetworkName = '${workloadName}-${environmentName}-vnet'
var actionGroupName = '${workloadName}-${environmentName}-operations'

var platformIdentityName = '${workloadName}-${environmentName}-gateway-id'
var ordersIdentityName = '${workloadName}-${environmentName}-orders-id'
var riskIdentityName = '${workloadName}-${environmentName}-risk-id'

var ordersServerName = take('${compactWorkloadName}-${environmentName}-orders-${uniqueSuffix}-psql', 63)
var riskServerName = take('${compactWorkloadName}-${environmentName}-risk-${uniqueSuffix}-psql', 63)
var ordersVaultName = '${keyVaultWorkloadToken}ord${locationToken}${uniqueSuffix}kv'
var riskVaultName = '${keyVaultWorkloadToken}risk${locationToken}${uniqueSuffix}kv'

resource platformResourceGroup 'Microsoft.Resources/resourceGroups@2024-03-01' = {
  name: platformResourceGroupName
  location: location
  tags: union(commonTags, {
    Component: 'platform'
    Owner: 'platform-team'
  })
}

resource ordersResourceGroup 'Microsoft.Resources/resourceGroups@2024-03-01' = {
  name: ordersResourceGroupName
  location: location
  tags: union(commonTags, {
    Component: 'orders'
    Owner: 'orders-team'
  })
}

resource riskResourceGroup 'Microsoft.Resources/resourceGroups@2024-03-01' = {
  name: riskResourceGroupName
  location: location
  tags: union(commonTags, {
    Component: 'medication-risk'
    Owner: 'risk-team'
  })
}

module platform './modules/platform.bicep' = {
  scope: platformResourceGroup
  params: {
    location: location
    tags: union(commonTags, {
      Component: 'platform'
      Owner: 'platform-team'
    })
    registryName: registryName
    workspaceName: workspaceName
    appInsightsName: appInsightsName
    containerAppsEnvironmentName: containerAppsEnvironmentName
    virtualNetworkName: virtualNetworkName
    platformIdentityName: platformIdentityName
    actionGroupName: actionGroupName
    actionGroupShortName: take('${environmentName}-caldova', 12)
    alertEmailAddress: alertEmailAddress
  }
}

module ordersData './modules/team-data.bicep' = {
  scope: ordersResourceGroup
  params: {
    location: location
    tags: union(commonTags, {
      Component: 'orders'
      Owner: 'orders-team'
    })
    teamName: 'Orders'
    identityName: ordersIdentityName
    keyVaultName: ordersVaultName
    postgresServerName: ordersServerName
    databaseName: 'orders'
    administratorLogin: ordersDatabaseAdministratorLogin
    administratorPassword: ordersDatabaseAdministratorPassword
    postgresVersion: postgresVersion
    postgresSkuName: postgresSkuName
    delegatedSubnetResourceId: platform.outputs.ordersDatabaseSubnetId
    virtualNetworkResourceId: platform.outputs.virtualNetworkId
    privateDnsZoneName: 'orders.${uniqueSuffix}.postgres.database.azure.com'
    logAnalyticsWorkspaceResourceId: platform.outputs.logAnalyticsWorkspaceId
    actionGroupResourceId: platform.outputs.actionGroupId
  }
}

module riskData './modules/team-data.bicep' = {
  scope: riskResourceGroup
  params: {
    location: location
    tags: union(commonTags, {
      Component: 'medication-risk'
      Owner: 'risk-team'
    })
    teamName: 'Medication Risk'
    identityName: riskIdentityName
    keyVaultName: riskVaultName
    postgresServerName: riskServerName
    databaseName: 'medicationrisk'
    administratorLogin: riskDatabaseAdministratorLogin
    administratorPassword: riskDatabaseAdministratorPassword
    postgresVersion: postgresVersion
    postgresSkuName: postgresSkuName
    delegatedSubnetResourceId: platform.outputs.riskDatabaseSubnetId
    virtualNetworkResourceId: platform.outputs.virtualNetworkId
    privateDnsZoneName: 'risk.${uniqueSuffix}.postgres.database.azure.com'
    logAnalyticsWorkspaceResourceId: platform.outputs.logAnalyticsWorkspaceId
    actionGroupResourceId: platform.outputs.actionGroupId
  }
}

module registryRbac './modules/acr-rbac.bicep' = {
  scope: platformResourceGroup
  params: {
    registryName: platform.outputs.registryName
    principalIds: [
      platform.outputs.platformIdentityPrincipalId
      ordersData.outputs.identityPrincipalId
      riskData.outputs.identityPrincipalId
    ]
  }
}

module ordersApp './modules/container-app.bicep' = if (deployApplications) {
  scope: ordersResourceGroup
  params: {
    location: location
    tags: union(commonTags, {
      Component: 'orders'
      Owner: 'orders-team'
    })
    appName: '${containerAppNamePrefix}-orders'
    targetPort: 8081
    externalIngress: false
    minReplicas: 2
    maxReplicas: 10
    cpu: '0.5'
    memory: '1Gi'
    imageRepository: ordersImageRepository
    imageTag: ordersImageTag
    containerAppsEnvironmentResourceId: platform.outputs.containerAppsEnvironmentId
    identityResourceId: ordersData.outputs.identityResourceId
    registryName: platform.outputs.registryName
    platformResourceGroupName: platformResourceGroupName
    appInsightsName: platform.outputs.appInsightsName
    actionGroupResourceId: platform.outputs.actionGroupId
    environmentVariables: [
      {
        name: 'ORDERS_DATABASE_URL'
        secretRef: 'database-url'
      }
      {
        name: 'RISK_BASE_URL'
        value: 'https://${riskApp!.outputs.fqdn}'
      }
    ]
    keyVaultSecrets: [
      {
        name: 'database-url'
        keyVaultUrl: ordersData.outputs.databaseCredentialSecretUri
        identity: ordersData.outputs.identityResourceId
      }
    ]
  }
  dependsOn: [
    registryRbac
  ]
}

module riskApp './modules/container-app.bicep' = if (deployApplications) {
  scope: riskResourceGroup
  params: {
    location: location
    tags: union(commonTags, {
      Component: 'medication-risk'
      Owner: 'risk-team'
    })
    appName: '${containerAppNamePrefix}-medication-risk'
    targetPort: 8082
    externalIngress: false
    minReplicas: 2
    maxReplicas: 10
    cpu: '0.5'
    memory: '1Gi'
    imageRepository: riskImageRepository
    imageTag: riskImageTag
    containerAppsEnvironmentResourceId: platform.outputs.containerAppsEnvironmentId
    identityResourceId: riskData.outputs.identityResourceId
    registryName: platform.outputs.registryName
    platformResourceGroupName: platformResourceGroupName
    appInsightsName: platform.outputs.appInsightsName
    actionGroupResourceId: platform.outputs.actionGroupId
    environmentVariables: [
      {
        name: 'RISK_DATABASE_URL'
        secretRef: 'database-url'
      }
    ]
    keyVaultSecrets: [
      {
        name: 'database-url'
        keyVaultUrl: riskData.outputs.databaseCredentialSecretUri
        identity: riskData.outputs.identityResourceId
      }
    ]
  }
  dependsOn: [
    registryRbac
  ]
}

module platformGateway './modules/container-app.bicep' = if (deployApplications) {
  scope: platformResourceGroup
  params: {
    location: location
    tags: union(commonTags, {
      Component: 'platform-gateway'
      Owner: 'platform-team'
    })
    appName: '${containerAppNamePrefix}-gateway'
    targetPort: 8080
    externalIngress: true
    minReplicas: 2
    maxReplicas: 20
    cpu: '1.0'
    memory: '2Gi'
    imageRepository: platformImageRepository
    imageTag: platformImageTag
    containerAppsEnvironmentResourceId: platform.outputs.containerAppsEnvironmentId
    identityResourceId: platform.outputs.platformIdentityResourceId
    registryName: platform.outputs.registryName
    platformResourceGroupName: platformResourceGroupName
    appInsightsName: platform.outputs.appInsightsName
    actionGroupResourceId: platform.outputs.actionGroupId
    environmentVariables: [
      {
        name: 'ORDERS_BASE_URL'
        value: 'https://${ordersApp!.outputs.fqdn}'
      }
    ]
    keyVaultSecrets: []
  }
  dependsOn: [
    registryRbac
    ordersApp
    riskApp
  ]
}

output resourceGroups object = {
  platform: platformResourceGroup.name
  orders: ordersResourceGroup.name
  risk: riskResourceGroup.name
}

output containerRegistry object = {
  name: platform.outputs.registryName
  resourceId: platform.outputs.registryId
  loginServer: platform.outputs.registryLoginServer
}

output containerImages object = {
  platformGateway: '${platform.outputs.registryLoginServer}/${platformImageRepository}:${platformImageTag}'
  orders: '${platform.outputs.registryLoginServer}/${ordersImageRepository}:${ordersImageTag}'
  medicationRisk: '${platform.outputs.registryLoginServer}/${riskImageRepository}:${riskImageTag}'
}

output applications object = {
  deployed: deployApplications
  platformGatewayName: deployApplications ? platformGateway!.outputs.appName : ''
  platformGatewayUrl: deployApplications ? 'https://${platformGateway!.outputs.fqdn}' : ''
  ordersName: deployApplications ? ordersApp!.outputs.appName : ''
  ordersInternalFqdn: deployApplications ? ordersApp!.outputs.fqdn : ''
  medicationRiskName: deployApplications ? riskApp!.outputs.appName : ''
  medicationRiskInternalFqdn: deployApplications ? riskApp!.outputs.fqdn : ''
}

output databases object = {
  orders: {
    serverResourceId: ordersData.outputs.postgresServerResourceId
    fullyQualifiedDomainName: ordersData.outputs.postgresServerFqdn
    databaseName: ordersData.outputs.databaseName
  }
  medicationRisk: {
    serverResourceId: riskData.outputs.postgresServerResourceId
    fullyQualifiedDomainName: riskData.outputs.postgresServerFqdn
    databaseName: riskData.outputs.databaseName
  }
}

output monitoring object = {
  logAnalyticsWorkspaceResourceId: platform.outputs.logAnalyticsWorkspaceId
  applicationInsightsResourceId: platform.outputs.appInsightsId
  actionGroupResourceId: platform.outputs.actionGroupId
}

output managedIdentities object = {
  platformGateway: platform.outputs.platformIdentityResourceId
  orders: ordersData.outputs.identityResourceId
  medicationRisk: riskData.outputs.identityResourceId
}
