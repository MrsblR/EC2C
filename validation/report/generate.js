import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const baseDir = path.dirname(fileURLToPath(import.meta.url));
const outDir = path.resolve(baseDir, '../out');
const files = fs.readdirSync(outDir).filter(f => f.endsWith('-summary.json'));

const results = files.map(f => {
  const data = JSON.parse(fs.readFileSync(path.join(outDir, f), 'utf8'));
  const name = f.replace('-summary.json', '');
  const metrics = data.metrics || {};
  const p95 = metrics.http_req_duration?.percentiles?.['95'] || 0;
  const avg = metrics.http_req_duration?.avg || 0;
  const rps = metrics.http_reqs?.rate || 0;
  const err = metrics.http_req_failed?.rate || 0;
  return { name, p95, avg, rps, err };
});

const html = `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8"/>
  <title>Validation Report</title>
  <script src="https://cdn.plot.ly/plotly-2.35.2.min.js"></script>
  <style> body{font-family:system-ui, Arial; margin:20px;} .grid{display:grid; grid-template-columns:1fr; gap:24px;} h1{margin:0 0 8px;} </style>
</head>
<body>
  <h1>Validation Report</h1>
  <p>Archivos: ${files.join(', ') || 'N/A'}</p>
  <div class="grid">
    <div id="p95"></div>
    <div id="rps"></div>
    <div id="err"></div>
  </div>
  <script>
    const data = ${JSON.stringify(results)};
    const names = data.map(d=>d.name);
    Plotly.newPlot('p95', [{x:names,y:data.map(d=>d.p95), type:'bar'}], {title:'Latency p95 (ms)'});
    Plotly.newPlot('rps', [{x:names,y:data.map(d=>d.rps), type:'bar'}], {title:'Requests per second'});
    Plotly.newPlot('err', [{x:names,y:data.map(d=>d.err), type:'bar'}], {title:'Error rate'});
  </script>
</body>
</html>`;

fs.writeFileSync(path.join(outDir, 'report.html'), html);
console.log('Report generated at validation/out/report.html');
