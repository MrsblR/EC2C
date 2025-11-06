Param(
  [string]$ClusterName = "demo",
  [switch]$Recreate
)

$ErrorActionPreference = "Stop"

if ($Recreate) {
  Write-Host "Deleting kind cluster if exists..."
  kind delete cluster --name $ClusterName | Out-Null
}

Write-Host "Creating kind cluster '$ClusterName' (1 control-plane + 2 workers) ..."
@"
kind: Cluster
apiVersion: kind.x-k8s.io/v1alpha4
name: $ClusterName
nodes:
- role: control-plane
  kubeadmConfigPatches:
  - |
    kind: ClusterConfiguration
    apiServer:
      extraArgs:
        service-node-port-range: "1-65535"
  extraPortMappings:
  - containerPort: 80
    hostPort: 80
    protocol: TCP
  - containerPort: 443
    hostPort: 443
    protocol: TCP
- role: worker
- role: worker
"@ | Set-Content -Path kind-config.yaml

kind create cluster --config kind-config.yaml | Out-Null
Remove-Item kind-config.yaml -Force

kubectl cluster-info

Write-Host "Installing ingress-nginx..."
kubectl apply -f https://raw.githubusercontent.com/kubernetes/ingress-nginx/main/deploy/static/provider/kind/deploy.yaml | Out-Null
kubectl wait --namespace ingress-nginx \
  --for=condition=ready pod \
  --selector=app.kubernetes.io/component=controller \
  --timeout=120s

Write-Host "Installing metrics-server..."
kubectl apply -f https://github.com/kubernetes-sigs/metrics-server/releases/latest/download/components.yaml | Out-Null
kubectl -n kube-system rollout status deploy/metrics-server -w --timeout=120s

Write-Host "kind cluster ready. Test: http://app.localtest.me (después del deploy)"

