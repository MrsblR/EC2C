"use strict";
const pulumi = require('@pulumi/pulumi');
const gcp = require('@pulumi/gcp');
const k8s = require('@pulumi/kubernetes');
const fs = require('fs');

// Config
const cfg = new pulumi.Config();
const location = cfg.get('location') || 'us-central1'; // GKE Autopilot requires region
const clusterName = cfg.get('clusterName') || 'demo-autopilot';
const project = gcp.config.project;
const repoId = cfg.get('repoId') || 'apps';
// Images: default to Artifact Registry in this project/region
const defaultBackend = pulumi.interpolate`${location}-docker.pkg.dev/${project}/${repoId}/app-backend:latest`;
const defaultFrontend = pulumi.interpolate`${location}-docker.pkg.dev/${project}/${repoId}/app-frontend:latest`;
const imageBackend = cfg.get('imageBackend') || defaultBackend; // allow override
const imageFrontend = cfg.get('imageFrontend') || defaultFrontend; // allow override
const dbUser = cfg.get('dbUser') || 'postgres';
const dbPass = cfg.getSecret('dbPass') || pulumi.secret('postgres');
const dbName = cfg.get('dbName') || 'postgres';

// Enable required APIs
const containerApi = new gcp.projects.Service('gke-api', {
  service: 'container.googleapis.com',
  disableOnDestroy: false,
});
const arApi = new gcp.projects.Service('ar-api', {
  service: 'artifactregistry.googleapis.com',
  disableOnDestroy: false,
});

// Artifact Registry repository for images
const repo = new gcp.artifactregistry.Repository('apps', {
  location,
  repositoryId: repoId,
  format: 'DOCKER',
}, { dependsOn: [arApi] });

// GKE Autopilot cluster
const cluster = new gcp.container.Cluster('gke', {
  name: clusterName,
  location,
  enableAutopilot: true,
  deletionProtection: false,
  releaseChannel: { channel: 'REGULAR' },
}, { dependsOn: [containerApi] });

// Build kubeconfig for the created cluster
const kubeconfig = pulumi.all([cluster.name, cluster.endpoint, cluster.masterAuth]).apply(([name, endpoint, auth]) => {
  const context = `${gcp.config.project}_${location}_${name}`;
  return `apiVersion: v1\n` +
    `clusters:\n` +
    `- cluster:\n` +
    `    certificate-authority-data: ${auth.clusterCaCertificate}\n` +
    `    server: https://${endpoint}\n` +
    `  name: ${context}\n` +
    `contexts:\n` +
    `- context:\n` +
    `    cluster: ${context}\n` +
    `    user: ${context}\n` +
    `  name: ${context}\n` +
    `current-context: ${context}\n` +
    `kind: Config\n` +
    `preferences: {}\n` +
    `users:\n` +
    `- name: ${context}\n` +
    `  user:\n` +
    `    exec:\n` +
    `      apiVersion: client.authentication.k8s.io/v1beta1\n` +
    `      command: gke-gcloud-auth-plugin\n` +
    `      installHint: Install gke-gcloud-auth-plugin via gcloud components.\n` +
    `      provideClusterInfo: true\n`;
});

const k8sProv = new k8s.Provider('gke-k8s', { kubeconfig });

// Namespace
const name = 'app';
const ns = new k8s.core.v1.Namespace('ns', { metadata: { name } }, { provider: k8sProv });

// DB init configmap
const initSql = new k8s.core.v1.ConfigMap('db-init', {
  metadata: { namespace: ns.metadata.name },
  data: { 'init.sql': fs.readFileSync('../db/init.sql', 'utf8') }
}, { provider: k8sProv });

// Secret for DB
const dbSecret = new k8s.core.v1.Secret('db-secret', {
  metadata: { namespace: ns.metadata.name },
  stringData: { POSTGRES_USER: dbUser, POSTGRES_PASSWORD: dbPass, POSTGRES_DB: dbName }
}, { provider: k8sProv });

// Dynamic PVC (GKE default StorageClass)
const pvc = new k8s.core.v1.PersistentVolumeClaim('postgres-pvc', {
  metadata: { namespace: ns.metadata.name },
  spec: {
    accessModes: ['ReadWriteOnce'],
    resources: { requests: { storage: '10Gi' } }
  }
}, { provider: k8sProv });

// DB Deployment + Service
const dbLabels = { app: 'db' };
const db = new k8s.apps.v1.Deployment('db', {
  metadata: { namespace: ns.metadata.name },
  spec: {
    replicas: 1,
    selector: { matchLabels: dbLabels },
    strategy: { type: 'Recreate' },
    template: {
      metadata: { labels: dbLabels },
      spec: {
        securityContext: { fsGroup: 999, runAsNonRoot: true },
        containers: [{
          name: 'postgres',
          image: 'postgres:15-alpine',
          ports: [{ containerPort: 5432 }],
          envFrom: [{ secretRef: { name: dbSecret.metadata.name } }],
          env: [ { name: 'PGDATA', value: '/var/lib/postgresql/data/pgdata' } ],
          volumeMounts: [
            { name: 'data', mountPath: '/var/lib/postgresql/data' },
            { name: 'init', mountPath: '/docker-entrypoint-initdb.d' }
          ],
          securityContext: { runAsUser: 999, runAsGroup: 999, allowPrivilegeEscalation: false },
          resources: {
            requests: { cpu: '100m', memory: '256Mi' },
            limits: { cpu: '1', memory: '1Gi' }
          },
          livenessProbe: { tcpSocket: { port: 5432 }, initialDelaySeconds: 10, periodSeconds: 10 },
          readinessProbe: { exec: { command: ['pg_isready','-U', dbUser] }, initialDelaySeconds: 5, periodSeconds: 10 }
        }],
        volumes: [
          { name: 'data', persistentVolumeClaim: { claimName: pvc.metadata.name } },
          { name: 'init', configMap: { name: initSql.metadata.name } }
        ]
      }
    }
  }
}, { provider: k8sProv });

const dbSvc = new k8s.core.v1.Service('db', {
  metadata: { namespace: ns.metadata.name, name: 'db' },
  spec: { type: 'ClusterIP', selector: dbLabels, ports: [{ port: 5432, targetPort: 5432 }] }
}, { provider: k8sProv });

// Network policy: only backend to db
new k8s.networking.v1.NetworkPolicy('db-allow-backend', {
  metadata: { namespace: ns.metadata.name },
  spec: {
    podSelector: { matchLabels: dbLabels },
    policyTypes: ['Ingress'],
    ingress: [{ from: [{ podSelector: { matchLabels: { app: 'backend' } } }], ports: [{ protocol: 'TCP', port: 5432 }] }]
  }
}, { provider: k8sProv });

// Backend
const backendLabels = { app: 'backend' };
const backend = new k8s.apps.v1.Deployment('backend', {
  metadata: { namespace: ns.metadata.name },
  spec: {
    replicas: 3,
    selector: { matchLabels: backendLabels },
    strategy: { type: 'RollingUpdate', rollingUpdate: { maxSurge: 1, maxUnavailable: 0 } },
    template: {
      metadata: { labels: backendLabels },
      spec: {
        topologySpreadConstraints: [ { maxSkew: 1, topologyKey: 'topology.kubernetes.io/zone', whenUnsatisfiable: 'ScheduleAnyway', labelSelector: { matchLabels: backendLabels } } ],
        containers: [{
          name: 'backend',
          image: imageBackend,
          imagePullPolicy: 'Always',
          ports: [{ containerPort: 3000 }],
          env: [
            { name: 'DATABASE_URL', value: pulumi.interpolate`postgres://${dbUser}:${dbPass}@${dbSvc.metadata.name}.${ns.metadata.name}.svc.cluster.local:5432/${dbName}` },
            { name: 'NODE_ENV', value: 'production' }
          ],
          resources: { requests: { cpu: '100m', memory: '128Mi' }, limits: { cpu: '500m', memory: '512Mi' } },
          readinessProbe: { httpGet: { path: '/api/health', port: 3000 }, initialDelaySeconds: 5, periodSeconds: 10 },
          livenessProbe: { httpGet: { path: '/api/health', port: 3000 }, initialDelaySeconds: 10, periodSeconds: 10 }
        }]
      }
    }
  }
}, { provider: k8sProv });

const backendSvc = new k8s.core.v1.Service('backend', {
  metadata: { namespace: ns.metadata.name, name: 'backend' },
  spec: { selector: backendLabels, ports: [{ port: 3000, targetPort: 3000 }] }
}, { provider: k8sProv });

// Frontend
const frontendLabels = { app: 'frontend' };
const frontend = new k8s.apps.v1.Deployment('frontend', {
  metadata: { namespace: ns.metadata.name },
  spec: {
    replicas: 3,
    selector: { matchLabels: frontendLabels },
    strategy: { type: 'RollingUpdate', rollingUpdate: { maxSurge: 1, maxUnavailable: 0 } },
    template: {
      metadata: { labels: frontendLabels },
      spec: {
        topologySpreadConstraints: [ { maxSkew: 1, topologyKey: 'topology.kubernetes.io/zone', whenUnsatisfiable: 'ScheduleAnyway', labelSelector: { matchLabels: frontendLabels } } ],
        containers: [{
          name: 'frontend',
          image: imageFrontend,
          imagePullPolicy: 'Always',
          ports: [{ containerPort: 80 }],
          resources: { requests: { cpu: '50m', memory: '64Mi' }, limits: { cpu: '300m', memory: '256Mi' } },
          readinessProbe: { httpGet: { path: '/', port: 80 }, initialDelaySeconds: 5, periodSeconds: 10 },
          livenessProbe: { httpGet: { path: '/', port: 80 }, initialDelaySeconds: 10, periodSeconds: 10 }
        }]
      }
    }
  }
}, { provider: k8sProv });

const frontendSvc = new k8s.core.v1.Service('frontend', {
  metadata: { namespace: ns.metadata.name, name: 'frontend' },
  spec: { selector: frontendLabels, ports: [{ port: 80, targetPort: 80 }] }
}, { provider: k8sProv });

// Ingress (GCE)
const ingress = new k8s.networking.v1.Ingress('ingress', {
  metadata: {
    namespace: ns.metadata.name,
    annotations: { 'kubernetes.io/ingress.class': 'gce' }
  },
  spec: {
    rules: [{
      http: {
        paths: [{ path: '/', pathType: 'Prefix', backend: { service: { name: frontendSvc.metadata.name, port: { number: 80 } } } }]
      }
    }]
  }
}, { provider: k8sProv });

// PDBs
new k8s.policy.v1.PodDisruptionBudget('pdb-backend', { metadata: { namespace: ns.metadata.name }, spec: { minAvailable: 2, selector: { matchLabels: backendLabels } } }, { provider: k8sProv });
new k8s.policy.v1.PodDisruptionBudget('pdb-frontend', { metadata: { namespace: ns.metadata.name }, spec: { minAvailable: 2, selector: { matchLabels: frontendLabels } } }, { provider: k8sProv });

// HPA
new k8s.autoscaling.v2.HorizontalPodAutoscaler('hpa-backend', {
  metadata: { namespace: ns.metadata.name },
  spec: {
    scaleTargetRef: { apiVersion: 'apps/v1', kind: 'Deployment', name: backend.metadata.name },
    minReplicas: 3,
    maxReplicas: 10,
    metrics: [{ type: 'Resource', resource: { name: 'cpu', target: { type: 'Utilization', averageUtilization: 70 } } }]
  }
}, { provider: k8sProv });
new k8s.autoscaling.v2.HorizontalPodAutoscaler('hpa-frontend', {
  metadata: { namespace: ns.metadata.name },
  spec: {
    scaleTargetRef: { apiVersion: 'apps/v1', kind: 'Deployment', name: frontend.metadata.name },
    minReplicas: 3,
    maxReplicas: 10,
    metrics: [{ type: 'Resource', resource: { name: 'cpu', target: { type: 'Utilization', averageUtilization: 60 } } }]
  }
}, { provider: k8sProv });

exports.kubeconfig = kubeconfig;
exports.ingressIp = ingress.status.loadBalancer.ingress[0].ip;
exports.namespace = ns.metadata.name;
exports.repoUrl = pulumi.interpolate`${location}-docker.pkg.dev/${project}/${repoId}`;
