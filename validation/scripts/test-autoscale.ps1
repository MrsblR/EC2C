Param(
  # URL base del servicio a probar (obligatorio)
  [Parameter(Mandatory=$true)][string]$BaseUrl,

  # Namespace donde se encuentra desplegada la app (por defecto: 'app')
  [string]$Namespace = 'app',

  # Carpeta donde se guardarán los resultados de la prueba (por defecto: 'validation/out')
  [string]$OutDir = 'validation/out'
)


# Si ocurre un error en cualquier parte del script, detener la ejecución
$ErrorActionPreference = 'Stop'

# Crear el directorio de salida (si no existe)
# -ItemType Directory : crea una carpeta
# -Force : no lanza error si ya existe
# -Out-Null : evita mostrar el resultado por consola
New-Item -ItemType Directory -Force -Path $OutDir | Out-Null


# -----------------------------
# Ejecutar prueba de carga con k6
# -----------------------------

# Ejecuta el contenedor oficial de Grafana k6 para generar tráfico hacia la app
# --rm : elimina el contenedor al finalizar
# -e BASE_URL=$BaseUrl : pasa la URL como variable de entorno dentro del contenedor
# -v ${PWD}:/work : monta el directorio actual en /work dentro del contenedor
# -w /work : define el directorio de trabajo dentro del contenedor
# validation/k6/autoscale.js : script de k6 que define el escenario de carga
# --summary-export : exporta los resultados a un archivo JSON
docker run --rm `
  -e BASE_URL=$BaseUrl `
  -v ${PWD}:/work `
  -w /work `
  grafana/k6 run validation/k6/autoscale.js `
  --summary-export $OutDir/autoscale-summary.json


# -----------------------------
# Monitorear el HPA durante 2 minutos
# -----------------------------
Write-Host " HPA (120s)..."

# Guardar la hora de inicio
$start = Get-Date

# Ejecuta el monitoreo cada 10 segundos durante 120 segundos (2 min)
do {
  # Muestra el estado del Horizontal Pod Autoscaler (réplicas deseadas, actuales, CPU, etc.)
  kubectl get hpa -n $Namespace

  # Espera 10 segundos antes de volver a consultar
  Start-Sleep -Seconds 10

# Calcula el tiempo transcurrido y repite mientras sea menor a 120 segundos
} while ((New-TimeSpan -Start $start -End (Get-Date)).TotalSeconds -lt 120)


# -----------------------------
# Mostrar resultados finales
# -----------------------------

# Muestra el estado actual de los deployments (cuántas réplicas se escalaron)
kubectl get deploy -n $Namespace

# Muestra el detalle del HPA (targets, métricas, límites, estado)
kubectl get hpa -n $Namespace -o wide


# -----------------------------
# Mensaje final
# -----------------------------
Write-Host "Autoscale test terminado. Resumen en $OutDir/autoscale-summary.json"
