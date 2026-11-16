[CmdletBinding()]
param(
    [Parameter(Mandatory)][Alias('SubscriptionId')][string]$Subscription,
    [Parameter(Mandatory)][string]$ResourceGroup,
    [Parameter(Mandatory)][string]$AgentName,
    [Parameter(Mandatory)][string]$ExtrasFile
)

$ErrorActionPreference = 'Stop'
$ApiVersion = '2025-05-01-preview'
$DpResource = '59f0a04a-b322-4310-adc9-39ac41e9631e'
$A2ACallerRoleId = '40c75cfd-e05f-496e-ab43-b82ca3eb3a16'
$A2AStandardUserRoleId = '2d84a65a-63b2-4343-bbb6-31105d857bc1'
$CurrentAgentId = "/subscriptions/$Subscription/resourceGroups/$ResourceGroup/providers/Microsoft.App/agents/$AgentName"

if (-not (Test-Path $ExtrasFile -PathType Leaf)) {
    throw "Extras file not found: $ExtrasFile"
}

$extras = Get-Content $ExtrasFile -Raw | ConvertFrom-Json
$incoming = @($extras.a2a.incoming)
$outgoing = @($extras.a2a.outgoing)
if (($incoming.Count + $outgoing.Count) -eq 0) {
    return
}

function Get-DpToken {
    $token = az account get-access-token --resource $DpResource --query accessToken -o tsv 2>$null
    if ($LASTEXITCODE -ne 0 -or -not $token) {
        throw 'Could not acquire an Azure SRE Agent data-plane token.'
    }
    return $token
}

function Resolve-AgentResourceId {
    param($Reference, [string]$Label)

    if ($Reference.resourceId) {
        return [string]$Reference.resourceId
    }
    $referenceSubscription = if ($Reference.subscriptionId) { [string]$Reference.subscriptionId } else { $Subscription }
    if (-not $Reference.resourceGroup -or -not $Reference.name) {
        throw "$Label must specify resourceId or resourceGroup and name."
    }
    return "/subscriptions/$referenceSubscription/resourceGroups/$($Reference.resourceGroup)/providers/Microsoft.App/agents/$($Reference.name)"
}

function Get-AgentResource {
    param([string]$ResourceId)

    $raw = (az rest --method GET --url "https://management.azure.com$ResourceId`?api-version=$ApiVersion" -o json 2>$null) -join "`n"
    if ($LASTEXITCODE -ne 0 -or -not $raw) {
        throw "Could not read agent resource $ResourceId."
    }
    return $raw | ConvertFrom-Json
}

function Ensure-A2ARoleAssignment {
    param(
        [Parameter(Mandatory)][string]$PrincipalId,
        [Parameter(Mandatory)][string]$RoleId
    )

    $filter = [Uri]::EscapeDataString("principalId eq '$PrincipalId'")
    $listUrl = "https://management.azure.com$CurrentAgentId/providers/Microsoft.Authorization/roleAssignments?api-version=2022-04-01&`$filter=$filter"
    $assignmentsRaw = (az rest --method GET --url $listUrl -o json 2>$null) -join "`n"
    if ($LASTEXITCODE -ne 0 -or -not $assignmentsRaw) {
        throw "Could not read role assignments for $PrincipalId on $CurrentAgentId."
    }
    $roleDefinitionSuffix = "/roleDefinitions/$RoleId"
    $existing = @(
        ($assignmentsRaw | ConvertFrom-Json).value | Where-Object {
            ([string]$_.properties.roleDefinitionId).EndsWith($roleDefinitionSuffix, [StringComparison]::OrdinalIgnoreCase)
        }
    )
    if ($existing.Count -gt 0) {
        return
    }

    $assignmentId = [guid]::NewGuid().ToString()
    $roleDefinitionId = "/subscriptions/$Subscription/providers/Microsoft.Authorization/roleDefinitions/$RoleId"
    $body = [ordered]@{
        properties = [ordered]@{
            roleDefinitionId = $roleDefinitionId
            principalId = $PrincipalId
            principalType = 'ServicePrincipal'
        }
    } | ConvertTo-Json -Depth 5 -Compress
    $null = az rest `
        --method PUT `
        --url "https://management.azure.com$CurrentAgentId/providers/Microsoft.Authorization/roleAssignments/$assignmentId`?api-version=2022-04-01" `
        --body $body `
        --output none
    if ($LASTEXITCODE -ne 0) {
        throw "Could not assign role $RoleId to $PrincipalId on $CurrentAgentId."
    }
}

function Invoke-A2ARequest {
    param(
        [Parameter(Mandatory)][string]$Method,
        [Parameter(Mandatory)][string]$Uri,
        [string]$Body,
        [string]$ETag,
        [switch]$IfNoneMatch
    )

    $headers = @{ Authorization = "Bearer $(Get-DpToken)" }
    if ($ETag) { $headers['If-Match'] = $ETag }
    if ($IfNoneMatch) { $headers['If-None-Match'] = '*' }
    $arguments = @{
        Uri = $Uri
        Method = $Method
        Headers = $headers
        ErrorAction = 'Stop'
    }
    if ($Body) {
        $arguments['Body'] = $Body
        $arguments['ContentType'] = 'application/json'
    }

    try {
        $response = Invoke-WebRequest @arguments
    } catch {
        $detail = $_.ErrorDetails.Message
        if (-not $detail) { $detail = $_.Exception.Message }
        throw "A2A $Method $Uri failed: $detail"
    }

    $responseBody = $null
    if ($response.Content) {
        $responseBody = $response.Content | ConvertFrom-Json
    }
    $etagHeader = @($response.Headers['ETag']) | Select-Object -First 1
    return [pscustomobject]@{
        Body = $responseBody
        ETag = [string]$etagHeader
    }
}

$currentAgent = Get-AgentResource $CurrentAgentId
$currentEndpoint = ([string]$currentAgent.properties.agentEndpoint).TrimEnd('/')
if (-not $currentEndpoint) {
    throw "Agent endpoint unavailable for $CurrentAgentId."
}
$currentUami = @($currentAgent.identity.userAssignedIdentities.PSObject.Properties) | Select-Object -First 1
$currentUamiClientId = [string]$currentUami.Value.clientId
if (-not $currentUamiClientId) {
    throw "User-assigned identity unavailable for $CurrentAgentId."
}

Write-Host "a2a: $($incoming.Count + $outgoing.Count)"

for ($i = 0; $i -lt $incoming.Count; $i++) {
    $entry = $incoming[$i]
    $callerId = Resolve-AgentResourceId $entry.caller "a2a.incoming[$i].caller"
    $callerAgent = Get-AgentResource $callerId
    $callerSystemPrincipalId = [string]$callerAgent.identity.principalId
    $callerUami = @($callerAgent.identity.userAssignedIdentities.PSObject.Properties) | Select-Object -First 1
    $callerUamiId = [string]$callerUami.Name
    $callerUamiPrincipalId = [string]$callerUami.Value.principalId
    if (-not $callerSystemPrincipalId) {
        throw "System-assigned identity unavailable for $callerId."
    }
    if (-not $callerUamiId -or -not $callerUamiPrincipalId) {
        throw "User-assigned identity unavailable for $callerId."
    }
    $callerSubscription = $callerId.Split('/')[2]
    $callerTenantId = az account show --subscription $callerSubscription --query tenantId -o tsv
    if ($LASTEXITCODE -ne 0 -or -not $callerTenantId) {
        throw "Could not resolve tenant for subscription $callerSubscription."
    }
    $handler = if ($entry.handler) { [string]$entry.handler } else { 'meta_agent' }
    $enabled = if ($null -ne $entry.enabled) { [bool]$entry.enabled } else { $true }
    $displayName = if ($entry.callerDisplayName) { [string]$entry.callerDisplayName } else { $null }
    $callerIdentities = @(
        [pscustomobject]@{
            ObjectId = $callerSystemPrincipalId
            Type = 'systemAssigned'
            ResourceId = $callerId
        },
        [pscustomobject]@{
            ObjectId = $callerUamiPrincipalId
            Type = 'userAssigned'
            ResourceId = $callerUamiId
        }
    )

    foreach ($callerIdentity in $callerIdentities) {
        $callerObjectId = [string]$callerIdentity.ObjectId
        $connectionKey = "$($callerTenantId.ToLowerInvariant())_$($callerObjectId.ToLowerInvariant())"
        $incomingUrl = "$currentEndpoint/api/v2/a2a/incoming-connections/$([uri]::EscapeDataString($connectionKey))"

        $body = [ordered]@{
            caller = [ordered]@{
                tenantId = $callerTenantId
                objectId = $callerObjectId
                managedIdentityReference = [ordered]@{
                    type = [string]$callerIdentity.Type
                    resourceId = [string]$callerIdentity.ResourceId
                }
            }
            handler = $handler
            callerDisplayName = $displayName
            enabled = $enabled
        } | ConvertTo-Json -Depth 10 -Compress

        $existingResponse = Invoke-A2ARequest -Method Get -Uri "$currentEndpoint/api/v2/a2a/incoming-connections"
        $existing = @($existingResponse.Body.value) | Where-Object {
            $_.caller.tenantId -eq $callerTenantId -and $_.caller.objectId -eq $callerObjectId
        } | Select-Object -First 1
        if ($existing) {
            $null = Invoke-A2ARequest -Method Put -Uri $incomingUrl -Body $body -ETag ([string]$existing.etag)
        } else {
            $null = Invoke-A2ARequest -Method Put -Uri $incomingUrl -Body $body -IfNoneMatch
        }
        if ($enabled) {
            Ensure-A2ARoleAssignment -PrincipalId $callerObjectId -RoleId $A2ACallerRoleId
            Ensure-A2ARoleAssignment -PrincipalId $callerObjectId -RoleId $A2AStandardUserRoleId
        }
    }
    $label = if ($displayName) { $displayName } else { $callerId.Split('/')[-1] }
    Write-Host "  ok incoming/$label (system + user-assigned identities)"
}

for ($i = 0; $i -lt $outgoing.Count; $i++) {
    $entry = $outgoing[$i]
    $name = [string]$entry.name
    if (-not $name) {
        throw "a2a.outgoing[$i].name is required."
    }
    $targetId = Resolve-AgentResourceId $entry.target "a2a.outgoing[$i].target"
    $targetAgent = Get-AgentResource $targetId
    $targetEndpoint = ([string]$targetAgent.properties.agentEndpoint).TrimEnd('/')
    if (-not $targetEndpoint) {
        throw "Agent endpoint unavailable for $targetId."
    }
    $enabled = if ($null -ne $entry.enabled) { [bool]$entry.enabled } else { $true }
    $kind = if ($entry.authentication.kind) { [string]$entry.authentication.kind } else { 'managedIdentity' }
    $identity = if ($entry.authentication.identity) { $entry.authentication.identity } else { $null }
    if ($kind -eq 'managedIdentity' -and -not $identity) {
        $identity = [ordered]@{
            type = 'client_id'
            value = $currentUamiClientId
        }
    }
    if ($kind -eq 'managedIdentity' -and
        ($identity.type -ne 'client_id' -or -not [string]$identity.value)) {
        throw "a2a.outgoing[$i].authentication.identity must select a managed identity by client_id."
    }
    $body = [ordered]@{
        name = $name
        description = if ($entry.description) { [string]$entry.description } else { '' }
        agentCardUrl = "$targetEndpoint/.well-known/agent-card.json"
        enabled = $enabled
        authentication = [ordered]@{
            kind = $kind
            identity = $identity
        }
    } | ConvertTo-Json -Depth 10 -Compress

    $connections = Invoke-A2ARequest -Method Get -Uri "$currentEndpoint/api/v2/a2a/outgoing-connections"
    $existing = @($connections.Body) | Where-Object { $_.name -eq $name } | Select-Object -First 1
    if ($existing) {
        $connectionId = [string]$existing.id
        $connectionUrl = "$currentEndpoint/api/v2/a2a/outgoing-connections/$([uri]::EscapeDataString($connectionId))"
        $snapshot = Invoke-A2ARequest -Method Get -Uri $connectionUrl
        if (-not $snapshot.ETag) {
            throw "A2A outgoing connection $name did not return an ETag."
        }
        $saved = Invoke-A2ARequest -Method Put -Uri $connectionUrl -Body $body -ETag $snapshot.ETag
    } else {
        $saved = Invoke-A2ARequest -Method Post -Uri "$currentEndpoint/api/v2/a2a/outgoing-connections" -Body $body
        $connectionId = [string]$saved.Body.id
    }

    if (-not $connectionId -or -not $saved.ETag) {
        throw "A2A outgoing connection $name did not return an id and ETag."
    }
    $testUrl = "$currentEndpoint/api/v2/a2a/outgoing-connections/$([uri]::EscapeDataString($connectionId))/test"
    $test = Invoke-A2ARequest -Method Post -Uri $testUrl -ETag $saved.ETag
    if (-not $test.Body.discovery.agentCard -or $test.Body.discovery.lastError) {
        $testError = if ($test.Body.discovery.lastError) {
            [string]$test.Body.discovery.lastError
        } elseif ($test.Body.validationError) {
            [string]$test.Body.validationError
        } else {
            'agent card discovery did not complete'
        }
        throw "A2A outgoing connection $name test failed: $testError"
    }
    Write-Host "  ok outgoing/$name (tested)"
}
