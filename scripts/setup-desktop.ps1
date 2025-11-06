Param(
  [switch]$InstallMetricsServer = $true,
  [switch]$InstallIngress = $true
)

$ErrorActionPreference = "Stop"

Write-Host "Checking current context..."
$ctx = & kubectl config current-context
if (-not $ctx -or -not $ctx.Contains('docker-desktop')) {
  Write-Error "El contexto actual de kubectl no es 'docker-desktop'. Asegúrate de habilitar Kubernetes en Docker Desktop y seleccionarlo con 'kubectl config use-context docker-desktop'."
}

if ($InstallMetricsServer) {
  Write-Host "Installing metrics-server..."
  kubectl apply -f https://github.com/kubernetes-sigs/metrics-server/releases/latest/download/components.yaml | Out-Null
  kubectl -n kube-system rollout status deploy/metrics-server -w --timeout=180s
}

if ($InstallIngress) {
  Write-Host "Installing ingress-nginx (LoadBalancer on Docker Desktop)..."
  kubectl apply -f https://raw.githubusercontent.com/kubernetes/ingress-nginx/main/deploy/static/provider/cloud/deploy.yaml | Out-Null
  kubectl -n ingress-nginx rollout status deploy/ingress-nginx-controller -w --timeout=300s
  Write-Host "ingress-nginx instalado. Si el EXTERNAL-IP queda en <pending>, Docker Desktop suele exponerlo en localhost igualmente."
}

Write-Host "Listo. Puedes ejecutar 'pulumi up' ahora."

