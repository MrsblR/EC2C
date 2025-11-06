Param(
  [Parameter(Mandatory=$true)][string]$BaseUrl,
  [string]$Namespace = 'app'
)

$ErrorActionPreference = 'Stop'

Write-Host "Creating a new TODO..."
$title = "persist-" + [DateTimeOffset]::UtcNow.ToUnixTimeSeconds()
$body = @{ title = $title } | ConvertTo-Json -Compress
$create = Invoke-WebRequest -UseBasicParsing "$BaseUrl/api/todos" -Method POST -ContentType 'application/json' -Body $body
$item = $create.Content | ConvertFrom-Json
Write-Host "Created id=$($item.id)"

Write-Host "Restarting DB pod to validate persistence..."
$dbPod = (kubectl get pods -n $Namespace -l app=db -o jsonpath='{.items[0].metadata.name}')
kubectl delete pod -n $Namespace $dbPod --wait=true
kubectl wait --for=condition=ready pod -l app=db -n $Namespace --timeout=180s

Write-Host "Validating item still exists after DB restart..."
$found = $false
for ($i=0; $i -lt 40; $i++) {
  try {
    $list = (Invoke-WebRequest -UseBasicParsing "$BaseUrl/api/todos").Content | ConvertFrom-Json
    if ($list | Where-Object { $_.id -eq $item.id -and $_.title -eq $title }) { $found = $true; break }
  } catch { Start-Sleep -Seconds 3 }
  Start-Sleep -Seconds 3
}
if ($found) { Write-Host "OK: item persisted across DB restart" } else { throw "FAIL: item not found after DB restart" }
