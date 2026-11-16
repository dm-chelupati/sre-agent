using './main.bicep'

param location = 'westus2'
param environmentName = 'showcase'
param alertEmailAddress = readEnvironmentVariable('CALDOVA_ALERT_EMAIL')
param ordersDatabaseAdministratorPassword = readEnvironmentVariable('CALDOVA_ORDERS_DB_PASSWORD')
param riskDatabaseAdministratorPassword = readEnvironmentVariable('CALDOVA_RISK_DB_PASSWORD')
param platformImageTag = 'replace-with-immutable-tag'
param ordersImageTag = 'replace-with-immutable-tag'
param riskImageTag = 'replace-with-immutable-tag'
param deployApplications = false
param tags = {
  BusinessUnit: 'Pharmacy'
  DataClassification: 'Confidential'
}
