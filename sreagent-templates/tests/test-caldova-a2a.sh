#!/usr/bin/env bash

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TMP_DIR=$(mktemp -d)
trap 'rm -rf "$TMP_DIR"' EXIT

for recipe in caldova-platform-sre caldova-orders-sre caldova-medication-risk-sre; do
  recipe_dir="${ROOT}/recipes/${recipe}"
  for required in README.md agent.json connectors.json expected-config.json roles.yaml a2a.json; do
    [[ -f "${recipe_dir}/${required}" ]] || { echo "Missing ${recipe}/${required}" >&2; exit 1; }
  done
  jq -e '.toggles.enableA2A == true' "${recipe_dir}/agent.json" >/dev/null
  jq -e '.skills == 0 and .subagents == 0 and ."common-prompts" == 0' "${recipe_dir}/expected-config.json" >/dev/null
  [[ ! -d "${recipe_dir}/config/skills" ]] || { echo "${recipe} must not include diagnostic skills" >&2; exit 1; }
done

jq -e '
  (.incoming | length) == 0
  and ([.outgoing[].target.name] | sort) == ["caldova-medication-risk-sre", "caldova-orders-sre"]
' "${ROOT}/recipes/caldova-platform-sre/a2a.json" >/dev/null

for recipe in caldova-orders-sre caldova-medication-risk-sre; do
  jq -e '
    (.incoming | length) == 1
    and .incoming[0].caller.name == "caldova-platform-sre"
    and (.outgoing | length) == 0
  ' "${ROOT}/recipes/${recipe}/a2a.json" >/dev/null
done

mkdir -p "${TMP_DIR}/bin" "${TMP_DIR}/state"

cat > "${TMP_DIR}/bin/az" <<'AZ'
#!/usr/bin/env bash
set -euo pipefail

if [[ "$1 $2" == "account get-access-token" ]]; then
  echo "mock-token"
  exit 0
fi
if [[ "$1 $2" == "account show" ]]; then
  echo "72f988bf-86f1-41af-91ab-2d7cd011db47"
  exit 0
fi
if [[ "$1 $2 $3" == "role assignment create" ]]; then
  principal=""
  role=""
  scope=""
  while [[ $# -gt 0 ]]; do
    case "$1" in
      --assignee-object-id) principal="$2"; shift 2 ;;
      --role) role="$2"; shift 2 ;;
      --scope) scope="$2"; shift 2 ;;
      *) shift ;;
    esac
  done
  printf '%s|%s|%s\n' "$principal" "$role" "$scope" >> "${MOCK_STATE_DIR}/role-assignments"
  exit 0
fi
if [[ "$1" == "rest" ]]; then
  url=""
  method="GET"
  body=""
  while [[ $# -gt 0 ]]; do
    case "$1" in
      --url) url="$2"; shift 2 ;;
      --method) method="$2"; shift 2 ;;
      --body) body="$2"; shift 2 ;;
      *) shift ;;
    esac
  done
  if [[ "$url" == *"/Microsoft.Authorization/roleAssignments"* ]]; then
    if [[ "$method" == "GET" ]]; then
      echo '{"value":[]}'
    else
      printf '%s' "$body" | jq -r '[.properties.principalId, .properties.roleDefinitionId] | join("|")' >> "${MOCK_STATE_DIR}/role-assignments"
      echo '{}'
    fi
    exit 0
  fi
  agent_name=$(printf '%s' "$url" | sed -E 's#.*agents/([^?]+).*#\1#')
  printf '{"identity":{"principalId":"11111111-2222-3333-4444-555555555555","userAssignedIdentities":{"/subscriptions/test-sub/resourceGroups/caldova-agents-rg/providers/Microsoft.ManagedIdentity/userAssignedIdentities/mock-uami":{"clientId":"66666666-7777-8888-9999-000000000000","principalId":"aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee"}}},"properties":{"agentEndpoint":"https://%s.example"}}\n' "$agent_name"
  exit 0
fi

echo "Unexpected az invocation: $*" >&2
exit 1
AZ

cat > "${TMP_DIR}/bin/curl" <<'CURL'
#!/usr/bin/env bash
set -euo pipefail

method="GET"
url=""
output=""
headers_file=""
body=""
headers=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    -X) method="$2"; shift 2 ;;
    -H) headers="${headers}${2}\n"; shift 2 ;;
    -D) headers_file="$2"; shift 2 ;;
    -o) output="$2"; shift 2 ;;
    --data) body="$2"; shift 2 ;;
    -w) shift 2 ;;
    -sS) shift ;;
    http*) url="$1"; shift ;;
    *) shift ;;
  esac
done

response='{}'
etag='"etag-1"'
case "${method} ${url}" in
  "GET "*"/api/v2/a2a/incoming-connections")
    response='{"value":[]}'
    ;;
  "PUT "*"/api/v2/a2a/incoming-connections/"*)
    printf '%b' "$headers" | grep -F 'If-None-Match: *' >/dev/null
    printf '%s' "$body" | jq -e '
      (.caller.managedIdentityReference.type == "systemAssigned"
        or .caller.managedIdentityReference.type == "userAssigned")
      and .handler == "meta_agent"
      and .enabled == true
    ' >/dev/null
    printf '%s' "$body" | jq -r '.caller.managedIdentityReference.type' >> "${MOCK_STATE_DIR}/incoming-types"
    response='{"etag":"incoming-etag"}'
    ;;
  "GET "*"/api/v2/a2a/outgoing-connections")
    response='[]'
    ;;
  "POST "*"/api/v2/a2a/outgoing-connections")
    printf '%s' "$body" | jq -e '
      .agentCardUrl == "https://caldova-orders-sre.example/.well-known/agent-card.json"
      and .authentication.kind == "managedIdentity"
      and .authentication.identity.type == "client_id"
      and .authentication.identity.value == "66666666-7777-8888-9999-000000000000"
      and .enabled == true
    ' >/dev/null
    touch "${MOCK_STATE_DIR}/outgoing-created"
    response='{"id":"connection-1"}'
    ;;
  "POST "*"/api/v2/a2a/outgoing-connections/connection-1/test")
    printf '%b' "$headers" | grep -F 'If-Match: "etag-1"' >/dev/null
    touch "${MOCK_STATE_DIR}/outgoing-tested"
    response='{"discovery":{"agentCard":{"name":"caldova-orders-sre"},"lastError":null}}'
    ;;
  *)
    echo "Unexpected curl invocation: ${method} ${url}" >&2
    exit 1
    ;;
esac

[[ -z "$output" ]] || printf '%s' "$response" > "$output"
[[ -z "$headers_file" ]] || printf 'HTTP/1.1 200 OK\r\nETag: %s\r\n\r\n' "$etag" > "$headers_file"
printf '200'
CURL

chmod +x "${TMP_DIR}/bin/az" "${TMP_DIR}/bin/curl"

cat > "${TMP_DIR}/platform.extras.json" <<'JSON'
{
  "a2a": {
    "incoming": [],
    "outgoing": [
      {
        "name": "caldova-orders-sre",
        "description": "Caldova Prescription Orders team agent.",
        "target": {
          "resourceGroup": "caldova-agents-rg",
          "name": "caldova-orders-sre"
        },
        "enabled": true,
        "authentication": {
          "kind": "managedIdentity",
          "identity": null
        }
      }
    ]
  }
}
JSON

cat > "${TMP_DIR}/orders.extras.json" <<'JSON'
{
  "a2a": {
    "incoming": [
      {
        "caller": {
          "resourceGroup": "caldova-agents-rg",
          "name": "caldova-platform-sre"
        },
        "callerDisplayName": "Caldova Platform SRE",
        "handler": "meta_agent",
        "enabled": true
      }
    ],
    "outgoing": []
  }
}
JSON

PATH="${TMP_DIR}/bin:${PATH}" MOCK_STATE_DIR="${TMP_DIR}/state" \
  bash "${ROOT}/bicep/configure-a2a.sh" test-sub caldova-agents-rg caldova-platform-sre "${TMP_DIR}/platform.extras.json"
PATH="${TMP_DIR}/bin:${PATH}" MOCK_STATE_DIR="${TMP_DIR}/state" \
  bash "${ROOT}/bicep/configure-a2a.sh" test-sub caldova-agents-rg caldova-orders-sre "${TMP_DIR}/orders.extras.json"

for marker in incoming-types role-assignments outgoing-created outgoing-tested; do
  [[ -f "${TMP_DIR}/state/${marker}" ]] || { echo "Missing mock request marker: ${marker}" >&2; exit 1; }
done

[[ "$(sort -u "${TMP_DIR}/state/incoming-types" | paste -sd, -)" == "systemAssigned,userAssigned" ]]
[[ "$(wc -l < "${TMP_DIR}/state/role-assignments" | tr -d ' ')" == "4" ]]
grep -F '11111111-2222-3333-4444-555555555555|/subscriptions/test-sub/providers/Microsoft.Authorization/roleDefinitions/40c75cfd-e05f-496e-ab43-b82ca3eb3a16' "${TMP_DIR}/state/role-assignments" >/dev/null
grep -F '11111111-2222-3333-4444-555555555555|/subscriptions/test-sub/providers/Microsoft.Authorization/roleDefinitions/2d84a65a-63b2-4343-bbb6-31105d857bc1' "${TMP_DIR}/state/role-assignments" >/dev/null
grep -F 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee|/subscriptions/test-sub/providers/Microsoft.Authorization/roleDefinitions/40c75cfd-e05f-496e-ab43-b82ca3eb3a16' "${TMP_DIR}/state/role-assignments" >/dev/null
grep -F 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee|/subscriptions/test-sub/providers/Microsoft.Authorization/roleDefinitions/2d84a65a-63b2-4343-bbb6-31105d857bc1' "${TMP_DIR}/state/role-assignments" >/dev/null

echo "Caldova A2A validation passed"
