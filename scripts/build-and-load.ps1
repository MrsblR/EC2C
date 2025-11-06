Param(
  [ValidateSet('kind','docker-desktop')]
  [string]$Provider = 'kind',
  [string]$ClusterName = 'demo'
)

$ErrorActionPreference = "Stop"

Write-Host "Building Docker images..."
docker build -t app-backend:local ./backend
docker build -t app-frontend:local ./frontend

if ($Provider -eq 'kind') {
  Write-Host "Loading images into kind cluster '$ClusterName'..."
  kind load docker-image app-backend:local --name $ClusterName
  kind load docker-image app-frontend:local --name $ClusterName
} else {
  Write-Host "Using Docker Desktop Kubernetes: images available locally."
}

Write-Host "Done. Now run: cd infra; npm install; pulumi up"

