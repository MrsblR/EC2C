"use strict";
const k8s = require('@pulumi/kubernetes');

const name = 'app';

// Namespace
const ns = new k8s.core.v1.Namespace('ns', {
  metadata: { name }
});

// ConfigMap with DB init SQL
const initSql = new k8s.core.v1.ConfigMap('db-init', {
  metadata: { namespace: ns.metadata.name },
  data: {
    'init.sql': require('fs').readFileSync('../db/init.sql', 'utf8')
  }
});

// PersistentVolume (hostPath) and PVC for local persistence (no-cost demo)
const pv = new k8s.core.v1.PersistentVolume('postgres-pv', {
  metadata: { name: 'postgres-pv' },
  spec: {
    capacity: { storage: '1Gi' },
    accessModes: ['ReadWriteOnce'],
    persistentVolumeReclaimPolicy: 'Retain',
    storageClassName: 'hostpath',
    hostPath: { path: '/data/postgres', type: 'DirectoryOrCreate' },
    nodeAffinity: { // allow bind on any node
      required: { nodeSelectorTerms: [{ matchExpressions: [{ key: 'kubernetes.io/os', operator: 'In', values: ['linux'] }] }] }
    }
  }
});

const pvc = new k8s.core.v1.PersistentVolumeClaim('postgres-pvc', {
  metadata: { namespace: ns.metadata.name, name: 'postgres-pvc' },
  spec: {
    accessModes: ['ReadWriteOnce'],
    resources: { requests: { storage: '1Gi' } },
    volumeName: pv.metadata.name,
    storageClassName: 'hostpath'
  }
});

// Secrets for DB
const dbUser = 'postgres';
const dbPass = 'postgres';
const dbName = 'postgres';

const dbSecret = new k8s.core.v1.Secret('db-secret', {
  metadata: { namespace: ns.metadata.name },
  stringData: {
    POSTGRES_USER: dbUser,
    POSTGRES_PASSWORD: dbPass,
    POSTGRES_DB: dbName
  }
});

// PostgreSQL Deployment (simple, 1 réplica, con PVC)
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
        containers: [
          {
            name: 'postgres',
            image: 'postgres:15-alpine',
            ports: [{ containerPort: 5432 }],
            envFrom: [{ secretRef: { name: dbSecret.metadata.name } }],
            volumeMounts: [
              { name: 'data', mountPath: '/var/lib/postgresql/data' },
              { name: 'init', mountPath: '/docker-entrypoint-initdb.d' }
            ],
            resources: {
              requests: { cpu: '100m', memory: '128Mi' },
              limits: { cpu: '500m', memory: '512Mi' }
            },
            livenessProbe: { tcpSocket: { port: 5432 }, initialDelaySeconds: 10, periodSeconds: 10 },
            readinessProbe: { exec: { command: ['pg_isready','-U', dbUser] }, initialDelaySeconds: 5, periodSeconds: 10 }
          }
        ],
        volumes: [
          { name: 'data', persistentVolumeClaim: { claimName: pvc.metadata.name } },
          { name: 'init', configMap: { name: initSql.metadata.name } }
        ]
      }
    }
  }
});

const dbSvc = new k8s.core.v1.Service('db', {
  metadata: { namespace: ns.metadata.name, name: 'db' },
  spec: {
    type: 'ClusterIP',
    selector: dbLabels,
    ports: [{ name: 'pg', port: 5432, targetPort: 5432 }]
  }
});

// NetworkPolicy: solo permite a backend hablar con db
new k8s.networking.v1.NetworkPolicy('db-allow-backend', {
  metadata: { namespace: ns.metadata.name },
  spec: {
    podSelector: { matchLabels: dbLabels },
    policyTypes: ['Ingress'],
    ingress: [
      {
        from: [ { podSelector: { matchLabels: { app: 'backend' } } } ],
        ports: [ { protocol: 'TCP', port: 5432 } ]
      }
    ]
  }
});

// Backend
const backendLabels = { app: 'backend' };
const backend = new k8s.apps.v1.Deployment('backend', {
  metadata: { namespace: ns.metadata.name },
  spec: {
    replicas: 3,
    selector: { matchLabels: backendLabels },
    template: {
      metadata: { labels: backendLabels },
      spec: {
        topologySpreadConstraints: [
          { maxSkew: 1, topologyKey: 'kubernetes.io/hostname', whenUnsatisfiable: 'ScheduleAnyway', labelSelector: { matchLabels: backendLabels } }
        ],
        containers: [
          {
            name: 'backend',
            image: 'app-backend:local',
            imagePullPolicy: 'IfNotPresent',
            ports: [{ containerPort: 3000 }],
            env: [
              { name: 'DATABASE_URL', value: `postgres://${dbUser}:${dbPass}@db.${name}.svc.cluster.local:5432/${dbName}` },
              { name: 'NODE_ENV', value: 'production' }
            ],
            resources: {
              requests: { cpu: '100m', memory: '128Mi' },
              limits: { cpu: '500m', memory: '512Mi' }
            },
            readinessProbe: { httpGet: { path: '/api/health', port: 3000 }, initialDelaySeconds: 5, periodSeconds: 10 },
            livenessProbe: { httpGet: { path: '/api/health', port: 3000 }, initialDelaySeconds: 10, periodSeconds: 10 }
          }
        ]
      }
    },
    strategy: { type: 'RollingUpdate', rollingUpdate: { maxSurge: 1, maxUnavailable: 0 } }
  }
});

const backendSvc = new k8s.core.v1.Service('backend', {
  metadata: { namespace: ns.metadata.name, name: 'backend' },
  spec: {
    type: 'ClusterIP',
    selector: backendLabels,
    ports: [{ name: 'http', port: 3000, targetPort: 3000 }]
  }
});

// Frontend
const frontendLabels = { app: 'frontend' };
const frontend = new k8s.apps.v1.Deployment('frontend', {
  metadata: { namespace: ns.metadata.name },
  spec: {
    replicas: 3,
    selector: { matchLabels: frontendLabels },
    template: {
      metadata: { labels: frontendLabels },
      spec: {
        topologySpreadConstraints: [
          { maxSkew: 1, topologyKey: 'kubernetes.io/hostname', whenUnsatisfiable: 'ScheduleAnyway', labelSelector: { matchLabels: frontendLabels } }
        ],
        containers: [
          {
            name: 'frontend',
            image: 'app-frontend:local2',
            imagePullPolicy: 'IfNotPresent',
            ports: [{ containerPort: 80 }],
            resources: {
              requests: { cpu: '50m', memory: '64Mi' },
              limits: { cpu: '300m', memory: '256Mi' }
            },
            readinessProbe: { httpGet: { path: '/', port: 80 }, initialDelaySeconds: 5, periodSeconds: 10 },
            livenessProbe: { httpGet: { path: '/', port: 80 }, initialDelaySeconds: 10, periodSeconds: 10 }
          }
        ]
      }
    },
    strategy: { type: 'RollingUpdate', rollingUpdate: { maxSurge: 1, maxUnavailable: 0 } }
  }
});

const frontendSvc = new k8s.core.v1.Service('frontend', {
  metadata: { namespace: ns.metadata.name, name: 'frontend' },
  spec: {
    type: 'ClusterIP',
    selector: frontendLabels,
    ports: [{ name: 'http', port: 80, targetPort: 80 }]
  }
});

// Ingress (requiere ingress-nginx)
const ingress = new k8s.networking.v1.Ingress('ingress', {
  metadata: {
    namespace: ns.metadata.name,
    annotations: {
      'kubernetes.io/ingress.class': 'nginx'
    }
  },
  spec: {
    rules: [
      {
        host: 'app.localtest.me',
        http: {
          paths: [
            {
              path: '/',
              pathType: 'Prefix',
              backend: { service: { name: frontendSvc.metadata.name, port: { number: 80 } } }
            }
          ]
        }
      }
    ]
  }
});

// PDBs
new k8s.policy.v1.PodDisruptionBudget('pdb-backend', {
  metadata: { namespace: ns.metadata.name },
  spec: {
    minAvailable: 2,
    selector: { matchLabels: backendLabels }
  }
});

new k8s.policy.v1.PodDisruptionBudget('pdb-frontend', {
  metadata: { namespace: ns.metadata.name },
  spec: {
    minAvailable: 2,
    selector: { matchLabels: frontendLabels }
  }
});

// HPA (CPU-based; metrics-server requerido)
new k8s.autoscaling.v2.HorizontalPodAutoscaler('hpa-backend', {
  metadata: { namespace: ns.metadata.name },
  spec: {
    scaleTargetRef: { apiVersion: 'apps/v1', kind: 'Deployment', name: backend.metadata.name },
    minReplicas: 3,
    maxReplicas: 10,
    metrics: [ { type: 'Resource', resource: { name: 'cpu', target: { type: 'Utilization', averageUtilization: 70 } } } ]
  }
});

new k8s.autoscaling.v2.HorizontalPodAutoscaler('hpa-frontend', {
  metadata: { namespace: ns.metadata.name },
  spec: {
    scaleTargetRef: { apiVersion: 'apps/v1', kind: 'Deployment', name: frontend.metadata.name },
    minReplicas: 3,
    maxReplicas: 10,
    metrics: [ { type: 'Resource', resource: { name: 'cpu', target: { type: 'Utilization', averageUtilization: 60 } } } ]
  }
});

exports.namespace = ns.metadata.name;
exports.frontendUrl = 'http://app.localtest.me/';
