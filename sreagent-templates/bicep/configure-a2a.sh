#!/usr/bin/env bash

set -euo pipefail

SUB="${1:?subscription-id required}"
RG="${2:?resource-group required}"
AGENT="${3:?agent-name required}"
FILE="${4:?extras file required}"

command -v az >/dev/null || { echo "az is required" >&2; exit 1; }
command -v curl >/dev/null || { echo "curl is required" >&2; exit 1; }
command -v jq >/dev/null || { echo "jq is required" >&2; exit 1; }
[[ -f "$FILE" ]] || { echo "extras file not found: $FILE" >&2; exit 1; }

A2A_COUNT=$(jq '((.a2a.incoming // []) | length) + ((.a2a.outgoing // []) | length)' "$FILE")
[[ "$A2A_COUNT" -gt 0 ]] || exit 0

API_VERSION="2025-05-01-preview"
DP_RESOURCE="59f0a04a-b322-4310-adc9-39ac41e9631e"
A2A_CALLER_ROLE_ID="40c75cfd-e05f-496e-ab43-b82ca3eb3a16"
A2A_STANDARD_USER_ROLE_ID="2d84a65a-63b2-4343-bbb6-31105d857bc1"
CURRENT_AGENT_ID="/subscriptions/${SUB}/resourceGroups/${RG}/providers/Microsoft.App/agents/${AGENT}"
TMP_DIR=$(mktemp -d)
trap 'rm -rf "$TMP_DIR"' EXIT

urlencode() {
  jq -nr --arg value "$1" '$value | @uri'
}

resolve_agent_id() {
  local ref="$1" label="$2"
  local resource_id ref_sub ref_rg ref_name
  resource_id=$(echo "$ref" | jq -r '.resourceId // empty')
  if [[ -n "$resource_id" ]]; then
    printf '%s' "$resource_id"
    return
  fi

  ref_sub=$(echo "$ref" | jq -r --arg default "$SUB" '.subscriptionId // $default')
  ref_rg=$(echo "$ref" | jq -r '.resourceGroup // empty')
  ref_name=$(echo "$ref" | jq -r '.name // empty')
  if [[ -z "$ref_rg" || -z "$ref_name" ]]; then
    echo "${label} must specify resourceId or resourceGroup and name" >&2
    return 1
  fi
  printf '/subscriptions/%s/resourceGroups/%s/providers/Microsoft.App/agents/%s' "$ref_sub" "$ref_rg" "$ref_name"
}

get_agent() {
  local resource_id="$1"
  az rest --method GET --url "https://management.azure.com${resource_id}?api-version=${API_VERSION}" -o json
}

get_dp_token() {
  az account get-access-token --resource "$DP_RESOURCE" --query accessToken -o tsv
}

ensure_role_assignment() {
  local principal_id="$1" role_id="$2"
  local list_url assignments existing assignment_id role_definition_id body
  list_url="https://management.azure.com${CURRENT_AGENT_ID}/providers/Microsoft.Authorization/roleAssignments?api-version=2022-04-01&\$filter=principalId%20eq%20'${principal_id}'"
  assignments=$(az rest --method GET --url "$list_url" -o json)
  existing=$(echo "$assignments" | jq --arg roleId "$role_id" \
    '[.value[]? | select((.properties.roleDefinitionId | ascii_downcase) | endswith($roleId))] | length')
  if [[ "$existing" -gt 0 ]]; then
    return 0
  fi

  assignment_id=$(printf '%04x%04x-%04x-%04x-%04x-%04x%04x%04x' \
    "$RANDOM" "$RANDOM" "$RANDOM" "$RANDOM" "$RANDOM" "$RANDOM" "$RANDOM" "$RANDOM")
  role_definition_id="/subscriptions/${SUB}/providers/Microsoft.Authorization/roleDefinitions/${role_id}"
  body=$(jq -nc \
    --arg roleDefinitionId "$role_definition_id" \
    --arg principalId "$principal_id" \
    '{properties: {roleDefinitionId: $roleDefinitionId, principalId: $principalId, principalType: "ServicePrincipal"}}')
  az rest \
    --method PUT \
    --url "https://management.azure.com${CURRENT_AGENT_ID}/providers/Microsoft.Authorization/roleAssignments/${assignment_id}?api-version=2022-04-01" \
    --body "$body" \
    --output none
}

A2A_RESPONSE_BODY=""
A2A_RESPONSE_ETAG=""
a2a_request() {
  local method="$1" url="$2" body="${3:-}" etag="${4:-}"
  local token body_file headers_file http_code error_message
  local -a curl_args
  token=$(get_dp_token)
  body_file="${TMP_DIR}/body-$RANDOM.json"
  headers_file="${TMP_DIR}/headers-$RANDOM.txt"
  curl_args=(-sS -X "$method" "$url" -H "Authorization: Bearer ${token}" -D "$headers_file" -o "$body_file" -w '%{http_code}')
  if [[ -n "$etag" ]]; then
    curl_args+=(-H "If-Match: ${etag}")
  fi
  if [[ -n "$body" ]]; then
    curl_args+=(-H "Content-Type: application/json" --data "$body")
  fi
  http_code=$(curl "${curl_args[@]}")

  if [[ ! "$http_code" =~ ^2 ]]; then
    error_message=$(jq -r '.error.message // .message // empty' "$body_file" 2>/dev/null || true)
    [[ -n "$error_message" ]] || error_message=$(cat "$body_file")
    echo "A2A ${method} ${url} failed with HTTP ${http_code}: ${error_message}" >&2
    return 1
  fi

  A2A_RESPONSE_BODY=$(cat "$body_file")
  A2A_RESPONSE_ETAG=$(awk 'tolower($1) == "etag:" {sub(/\r$/, "", $2); print $2; exit}' "$headers_file")
}

CURRENT_AGENT=$(get_agent "$CURRENT_AGENT_ID")
CURRENT_ENDPOINT=$(echo "$CURRENT_AGENT" | jq -r '.properties.agentEndpoint // empty')
[[ -n "$CURRENT_ENDPOINT" ]] || { echo "Agent endpoint unavailable for ${CURRENT_AGENT_ID}" >&2; exit 1; }
CURRENT_ENDPOINT="${CURRENT_ENDPOINT%/}"
CURRENT_UAMI_CLIENT_ID=$(echo "$CURRENT_AGENT" | jq -r '.identity.userAssignedIdentities | to_entries[0].value.clientId // empty')
[[ -n "$CURRENT_UAMI_CLIENT_ID" ]] || { echo "User-assigned identity unavailable for ${CURRENT_AGENT_ID}" >&2; exit 1; }

echo "a2a: ${A2A_COUNT}"

incoming_count=$(jq '(.a2a.incoming // []) | length' "$FILE")
if [[ "$incoming_count" -gt 0 ]]; then
  for i in $(seq 0 $((incoming_count - 1))); do
    entry=$(jq -c --argjson i "$i" '.a2a.incoming[$i]' "$FILE")
    caller_ref=$(echo "$entry" | jq -c '.caller // {}')
    caller_id=$(resolve_agent_id "$caller_ref" "a2a.incoming[$i].caller")
    caller_agent=$(get_agent "$caller_id")
    caller_system_principal_id=$(echo "$caller_agent" | jq -r '.identity.principalId // empty')
    caller_uami_id=$(echo "$caller_agent" | jq -r '.identity.userAssignedIdentities | to_entries[0].key // empty')
    caller_uami_principal_id=$(echo "$caller_agent" | jq -r '.identity.userAssignedIdentities | to_entries[0].value.principalId // empty')
    [[ -n "$caller_system_principal_id" ]] || { echo "System-assigned identity unavailable for ${caller_id}" >&2; exit 1; }
    [[ -n "$caller_uami_id" && -n "$caller_uami_principal_id" ]] || { echo "User-assigned identity unavailable for ${caller_id}" >&2; exit 1; }
    caller_sub=$(echo "$caller_id" | cut -d/ -f3)
    caller_tenant_id=$(az account show --subscription "$caller_sub" --query tenantId -o tsv)
    caller_display_name=$(echo "$entry" | jq -r '.callerDisplayName // empty')
    handler=$(echo "$entry" | jq -r '.handler // "meta_agent"')
    enabled=$(echo "$entry" | jq -r '.enabled // true')
    caller_identities=$(jq -nc \
      --arg systemPrincipalId "$caller_system_principal_id" \
      --arg systemResourceId "$caller_id" \
      --arg uamiPrincipalId "$caller_uami_principal_id" \
      --arg uamiResourceId "$caller_uami_id" \
      '[
        {objectId: $systemPrincipalId, type: "systemAssigned", resourceId: $systemResourceId},
        {objectId: $uamiPrincipalId, type: "userAssigned", resourceId: $uamiResourceId}
      ]')

    while IFS=$'\t' read -r caller_object_id identity_type identity_resource_id; do
    connection_key="$(printf '%s' "$caller_tenant_id" | tr '[:upper:]' '[:lower:]')_$(printf '%s' "$caller_object_id" | tr '[:upper:]' '[:lower:]')"

    body=$(jq -nc \
      --arg tenantId "$caller_tenant_id" \
      --arg objectId "$caller_object_id" \
      --arg identityType "$identity_type" \
      --arg resourceId "$identity_resource_id" \
      --arg handler "$handler" \
      --arg displayName "$caller_display_name" \
      --argjson enabled "$enabled" \
      '{
        caller: {
          tenantId: $tenantId,
          objectId: $objectId,
          managedIdentityReference: {type: $identityType, resourceId: $resourceId}
        },
        handler: $handler,
        callerDisplayName: (if $displayName == "" then null else $displayName end),
        enabled: $enabled
      }')

    a2a_request GET "${CURRENT_ENDPOINT}/api/v2/a2a/incoming-connections"
    existing_etag=$(echo "$A2A_RESPONSE_BODY" | jq -r \
      --arg tenant "$caller_tenant_id" --arg object "$caller_object_id" \
      '.value[]? | select((.caller.tenantId | ascii_downcase) == ($tenant | ascii_downcase) and (.caller.objectId | ascii_downcase) == ($object | ascii_downcase)) | .etag' | head -1)
    incoming_url="${CURRENT_ENDPOINT}/api/v2/a2a/incoming-connections/$(urlencode "$connection_key")"
    if [[ -n "$existing_etag" ]]; then
      a2a_request PUT "$incoming_url" "$body" "$existing_etag"
    else
      token=$(get_dp_token)
      body_file="${TMP_DIR}/incoming-$i-${identity_type}.json"
      http_code=$(curl -sS -X PUT "$incoming_url" \
        -H "Authorization: Bearer ${token}" \
        -H "Content-Type: application/json" \
        -H "If-None-Match: *" \
        --data "$body" \
        -o "$body_file" -w '%{http_code}')
      if [[ ! "$http_code" =~ ^2 ]]; then
        echo "A2A incoming connection creation failed with HTTP ${http_code}: $(cat "$body_file")" >&2
        exit 1
      fi
    fi
      if [[ "$enabled" == "true" ]]; then
        ensure_role_assignment "$caller_object_id" "$A2A_CALLER_ROLE_ID"
        ensure_role_assignment "$caller_object_id" "$A2A_STANDARD_USER_ROLE_ID"
      fi
    done < <(echo "$caller_identities" | jq -r '.[] | [.objectId, .type, .resourceId] | @tsv')
    echo "  ok incoming/${caller_display_name:-${caller_id##*/}} (system + user-assigned identities)"
  done
fi

outgoing_count=$(jq '(.a2a.outgoing // []) | length' "$FILE")
if [[ "$outgoing_count" -gt 0 ]]; then
  for i in $(seq 0 $((outgoing_count - 1))); do
    entry=$(jq -c --argjson i "$i" '.a2a.outgoing[$i]' "$FILE")
    name=$(echo "$entry" | jq -r '.name // empty')
    [[ -n "$name" ]] || { echo "a2a.outgoing[$i].name is required" >&2; exit 1; }
    description=$(echo "$entry" | jq -r '.description // ""')
    enabled=$(echo "$entry" | jq -r '.enabled // true')
    target_ref=$(echo "$entry" | jq -c '.target // {}')
    target_id=$(resolve_agent_id "$target_ref" "a2a.outgoing[$i].target")
    target_agent=$(get_agent "$target_id")
    target_endpoint=$(echo "$target_agent" | jq -r '.properties.agentEndpoint // empty')
    [[ -n "$target_endpoint" ]] || { echo "Agent endpoint unavailable for ${target_id}" >&2; exit 1; }
    target_endpoint="${target_endpoint%/}"
    identity=$(echo "$entry" | jq -c '.authentication.identity // null')
    auth_kind=$(echo "$entry" | jq -r '.authentication.kind // "managedIdentity"')
    if [[ "$auth_kind" == "managedIdentity" && "$identity" == "null" ]]; then
      identity=$(jq -nc --arg clientId "$CURRENT_UAMI_CLIENT_ID" '{type: "client_id", value: $clientId}')
    fi
    if [[ "$auth_kind" == "managedIdentity" ]] && ! echo "$identity" | jq -e '.type == "client_id" and (.value | type == "string" and length > 0)' >/dev/null; then
      echo "a2a.outgoing[$i].authentication.identity must select a managed identity by client_id" >&2
      exit 1
    fi

    body=$(jq -nc \
      --arg name "$name" \
      --arg description "$description" \
      --arg agentCardUrl "${target_endpoint}/.well-known/agent-card.json" \
      --arg kind "$auth_kind" \
      --argjson identity "$identity" \
      --argjson enabled "$enabled" \
      '{
        name: $name,
        description: $description,
        agentCardUrl: $agentCardUrl,
        enabled: $enabled,
        authentication: {kind: $kind, identity: $identity}
      }')

    a2a_request GET "${CURRENT_ENDPOINT}/api/v2/a2a/outgoing-connections"
    connection_id=$(echo "$A2A_RESPONSE_BODY" | jq -r --arg name "$name" '.[]? | select(.name == $name) | .id' | head -1)
    if [[ -n "$connection_id" ]]; then
      connection_url="${CURRENT_ENDPOINT}/api/v2/a2a/outgoing-connections/$(urlencode "$connection_id")"
      a2a_request GET "$connection_url"
      etag="$A2A_RESPONSE_ETAG"
      [[ -n "$etag" ]] || { echo "A2A outgoing connection ${name} did not return an ETag" >&2; exit 1; }
      a2a_request PUT "$connection_url" "$body" "$etag"
    else
      a2a_request POST "${CURRENT_ENDPOINT}/api/v2/a2a/outgoing-connections" "$body"
      connection_id=$(echo "$A2A_RESPONSE_BODY" | jq -r '.id // empty')
    fi

    etag="$A2A_RESPONSE_ETAG"
    [[ -n "$connection_id" && -n "$etag" ]] || { echo "A2A outgoing connection ${name} did not return an id and ETag" >&2; exit 1; }
    test_url="${CURRENT_ENDPOINT}/api/v2/a2a/outgoing-connections/$(urlencode "$connection_id")/test"
    a2a_request POST "$test_url" "" "$etag"
    if ! echo "$A2A_RESPONSE_BODY" | jq -e '.discovery.agentCard != null and .discovery.lastError == null' >/dev/null; then
      test_error=$(echo "$A2A_RESPONSE_BODY" | jq -r '.discovery.lastError // .validationError // "agent card discovery did not complete"')
      echo "A2A outgoing connection ${name} test failed: ${test_error}" >&2
      exit 1
    fi
    echo "  ok outgoing/${name} (tested)"
  done
fi
