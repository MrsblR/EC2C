Proyecto: App 3 Contenedores (Frontend, Backend, DB) con Kubernetes, Pulumi y Docker

Resumen
- Arquitectura three-tier: Frontend (Nginx) → Backend (Node.js/Express) → DB (PostgreSQL).
- Balanceo + tolerancia a fallos: 3 réplicas para frontend y backend, Ingress NGINX, Service ClusterIP, RollingUpdate, probes, PDB.
- Autoscalado: HPA basado en CPU (requiere metrics-server en el clúster).
- Persistencia: PV+PVC para PostgreSQL y script de init SQL.
- Seguridad/Red: NetworkPolicy para permitir acceso a DB solo desde backend.
- Despliegue sin costo: clúster local (Docker Desktop Kubernetes o kind).

Estructura
- `frontend/`: Nginx + `index.html` (fetch a `/api/todos`) + reverse proxy `/api` → backend:3000
- `backend/`: Node.js + Express + pg. Rutas: `GET /api/health`, `GET /api/todos`, `POST /api/todos`
- `db/init.sql`: crea tabla `todos(id SERIAL, title TEXT, done BOOLEAN DEFAULT FALSE)`
- `infra/`: Pulumi (Node.js) que crea Namespace, ConfigMap, PV/PVC, Deployments, Services, Ingress, HPA, PDB, NetworkPolicy.
- `scripts/`: helpers para crear clúster kind y cargar imágenes.

Requisitos locales
- Windows con Docker Desktop (ya instalado) y Pulumi (ya instalado).
- Kubernetes local: habilitar Kubernetes en Docker Desktop (recomendado, sin costo). Alternativa: kind (también sin costo).
- kubectl configurado (usa el contexto de tu clúster local).

Despliegue rápido (local, sin costo)
1) Elegir clúster local:
   - Docker Desktop Kubernetes: habilitar Kubernetes en Docker Desktop (Settings → Kubernetes) y esperar que el contexto esté activo.
   - o kind: `powershell.exe -ExecutionPolicy Bypass -File scripts/create-kind.ps1`
     (crea clúster 3 nodos, instala ingress-nginx y metrics-server)

Despliegue 100% IaC en GCP (requiere costos)
1) Prerrequisitos
   - gcloud instalado y autenticado: `gcloud auth application-default login`
   - Config Pulumi GCP: `pulumi config set gcp:project <tu-proyecto>` y `pulumi config set gcp:region us-central1`
   - Imágenes en un registro accesible (recomendado Docker Hub público para no pagar):
     - Backend: `docker tag app-backend:local docker.io/<user>/app-backend:latest && docker push docker.io/<user>/app-backend:latest`
     - Frontend: `docker tag app-frontend:local2 docker.io/<user>/app-frontend:latest && docker push docker.io/<user>/app-frontend:latest`

2) Preparar stack Pulumi
   - `cd infra-gcp && npm install`
   - `pulumi login` (puede ser `--local`, pero GCP recomendado en Pulumi Cloud)
   - `pulumi stack init dev` (si no existe)
   - `pulumi config set location us-central1`
   - `pulumi config set clusterName demo-autopilot`
   - `pulumi config set imageBackend docker.io/<user>/app-backend:latest`
   - `pulumi config set imageFrontend docker.io/<user>/app-frontend:latest`
   - (opcional) `pulumi config set --secret dbPass <password>`

3) Desplegar todo por IaC
   - `pulumi up` (crea GKE Autopilot, kubeconfig y despliega los recursos K8s)

4) Acceso a la app
   - `pulumi stack output ingressIp` te mostrará la IP externa del Ingress GCE
   - Abre `http://<ingressIp>/`

Notas GCP
- GKE Autopilot cobra por uso de recursos; destruye con `pulumi destroy` al terminar para evitar costos.
- Persistencia usa PVC dinámico con Persistent Disk.
- HPA usa métricas administradas por GKE.

2) Construir imágenes y cargarlas en el clúster local:
   - Docker Desktop Kubernetes: `powershell.exe -ExecutionPolicy Bypass -File scripts/build-and-load.ps1 -Provider docker-desktop`
   - kind: `powershell.exe -ExecutionPolicy Bypass -File scripts/build-and-load.ps1 -Provider kind`

2.1) (Docker Desktop) Instalar metrics-server e ingress-nginx:
   - `powershell.exe -ExecutionPolicy Bypass -File scripts/setup-desktop.ps1`

3) Desplegar infraestructura con Pulumi:
   - `cd infra`
   - `npm install`
   - `pulumi stack init dev` (solo primera vez; si existe, omite)
   - `pulumi up` (acepta los cambios)

4) Acceder a la app
   - Con Ingress NGINX: http://app.localtest.me/
   - Si el Ingress aún no está listo, usar `kubectl port-forward svc/frontend -n app 8080:80` y abrir http://localhost:8080/

Notas operativas
- HPA requiere metrics-server. El script de kind lo instala. En Docker Desktop suele venir habilitado o puedes instalarlo con `kubectl apply -f https://github.com/kubernetes-sigs/metrics-server/releases/latest/download/components.yaml`.
- Persistencia: se define PV hostPath para entorno local (no gastar $$$). En nube pública se recomienda StorageClass dinámico.
- Alta disponibilidad real de DB en local es compleja. Para no incurrir costo se entrega PostgreSQL único con PVC (SPOF). En producción, usaría Cloud SQL/AlloyDB o un operador (p. ej. Crunchy/Bitnami) con réplicas.

Justificación de herramientas
- Kubernetes: orquestación, despliegue declarativo, rolling updates, HPA, Service/Ingress, probes, PDB — facilita escalabilidad y tolerancia a fallos.
- Pulumi: Infraestructura como código en TypeScript/JavaScript, reusabilidad, configuración, y diffs claros. Permite versionar y reproducir el entorno.
- Docker: empaquetado de apps, portabilidad y rapidez en builds locales.
- kind / Docker Desktop Kubernetes: clúster local rápido, sin costo, ideal para pruebas y demo.

Escalabilidad y HA
- Réplicas=3 para frontend y backend, `PodDisruptionBudget` para mantener disponibilidad en actualizaciones.
- `readinessProbe`/`livenessProbe` para evicción automática de pods no saludables.
- `HorizontalPodAutoscaler` para escalar por CPU.
- Ingress NGINX balancea tráfico a `frontend`, y este hace proxy a `backend`.
- `NetworkPolicy` restringe acceso a DB solo desde `backend`.

Pruebas
- Backend con Jest+supertest: prueba de `/api/health` y flujo básico de todos con mock del cliente `pg`.

Comandos útiles
- Ver pods: `kubectl get pods -n app -o wide`
- Logs backend: `kubectl logs -n app deploy/backend`
- Probar API: `kubectl port-forward -n app svc/backend 3000:3000` y `curl http://localhost:3000/api/health`
