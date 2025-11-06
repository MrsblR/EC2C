Param(
  [string]$Namespace = 'app'
)

$ErrorActionPreference = 'Stop'

Write-Host "Spawning temporary pod without backend label..."
kubectl run netpol-tester --rm -i --restart=Never -n $Namespace --image=busybox:1.36 -- /bin/sh -c "nc -zvw3 db 5432"; if ($LASTEXITCODE -eq 0) { throw "FAIL: unexpected access to DB from non-backend pod" } else { Write-Host "OK: access blocked as expected" }

Write-Host "Testing access from a backend pod..."
$b = (kubectl get pods -n $Namespace -l app=backend -o jsonpath='{.items[0].metadata.name}')
kubectl exec -n $Namespace $b -- sh -c "nc -zvw3 db 5432"; if ($LASTEXITCODE -ne 0) { throw "FAIL: backend could not reach DB" } else { Write-Host "OK: backend reaches DB" }

