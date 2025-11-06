Param(
  [Parameter(Mandatory=$true)][string]$BaseUrl,
  [string]$Namespace = 'app',
  [int]$Seconds = 60,
  [string]$OutDir = 'validation/out'
)

$ErrorActionPreference = 'Stop'
New-Item -ItemType Directory -Force -Path $OutDir | Out-Null

Write-Host "Starting k6 steady load for $Seconds seconds..."
$script = @"
import http from 'k6/http';
import { sleep } from 'k6';
export const options = { vus: 20, duration: '${Seconds}s', thresholds: { http_req_failed: ['rate<0.05'] } };
export default function () { http.get('${BaseUrl}/api/health'); sleep(0.1); }
"@
$k6file = Join-Path $OutDir "ha.js"
Set-Content -Path $k6file -Value $script

$repoRoot = (Resolve-Path ".").Path
$containerK6 = "/work/validation/out/ha.js"
Start-Job -ScriptBlock { param($hostDir,$containerScript,$out) docker run --rm -v $hostDir`:/work -w /work grafana/k6 run $containerScript --summary-export $out } -ArgumentList $repoRoot, $containerK6, (Join-Path $OutDir 'ha-summary.json') | Out-Null

Start-Sleep -Seconds 5
Write-Host "Deleting one frontend pod..."
$f = (kubectl get pods -n $Namespace -l app=frontend -o jsonpath='{.items[0].metadata.name}')
kubectl delete pod -n $Namespace $f --wait=false

Start-Sleep -Seconds ([Math]::Max([int]($Seconds/2), 10))
Write-Host "Deleting one backend pod..."
$b = (kubectl get pods -n $Namespace -l app=backend -o jsonpath='{.items[0].metadata.name}')
kubectl delete pod -n $Namespace $b --wait=false

Write-Host "Waiting for k6 job to finish..."
Get-Job | Wait-Job | Receive-Job | Out-Null
kubectl get deploy -n $Namespace
kubectl get pods -n $Namespace

Write-Host "HA test complete. Summary at $OutDir/ha-summary.json"
