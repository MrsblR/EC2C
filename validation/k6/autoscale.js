import http from 'k6/http';
import { sleep } from 'k6';

export const options = {
  scenarios: {
    ramp_api: {
      executor: 'ramping-vus',
      startVUs: 1,
      stages: [
        { duration: '30s', target: 20 },
        { duration: '60s', target: 100 },
        { duration: '60s', target: 200 },
        { duration: '30s', target: 0 },
      ],
      gracefulRampDown: '10s',
    },
  },
  thresholds: {
    http_req_failed: ['rate<0.05'],
    http_req_duration: ['p(95)<800'],
  },
};

const BASE = __ENV.BASE_URL || 'http://app.localtest.me';

export default function () {
  // Alternar entre endpoints para mover un poco la CPU del backend
  const n = Math.random();
  if (n < 0.2) {
    http.get(`${BASE}/api/health`);
  } else if (n < 0.6) {
    http.get(`${BASE}/api/todos`);
  } else {
    http.post(`${BASE}/api/todos`, JSON.stringify({ title: `k6 ${Date.now()}` }), { headers: { 'Content-Type': 'application/json' } });
  }
  sleep(0.1);
}

