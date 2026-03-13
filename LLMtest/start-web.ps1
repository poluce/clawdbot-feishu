param(
  [int]$Port = 3418
)

$ErrorActionPreference = "Stop"

Set-Location (Resolve-Path (Join-Path $PSScriptRoot ".."))

function Test-RepoDependency {
  param(
    [Parameter(Mandatory = $true)]
    [string]$PackagePath
  )

  return Test-Path (Join-Path (Get-Location) $PackagePath)
}

function Ensure-RepoDependencies {
  $required = @(
    "node_modules/tsx",
    "node_modules/@larksuiteoapi/node-sdk",
    "node_modules/openclaw"
  )

  $missing = $required | Where-Object { -not (Test-RepoDependency -PackagePath $_) }
  if ($missing.Count -eq 0) {
    return
  }

  Write-Host "Missing repo dependencies for LLMtest web bench. Running npm ci --ignore-scripts ..."
  npm ci --ignore-scripts
  if ($LASTEXITCODE -ne 0) {
    throw "npm ci --ignore-scripts failed with exit code $LASTEXITCODE"
  }
}

Ensure-RepoDependencies

Write-Host "Starting clawdbot-feishu LLMtest web bench on port $Port ..."
npx --no-install tsx .\LLMtest\web\server.ts --port $Port
