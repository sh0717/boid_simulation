import { performance } from 'node:perf_hooks';
import { mkdir, writeFile } from 'node:fs/promises';
import os from 'node:os';
import { BoidSimulation } from '../src/simulation/boids.js';
import { FIXED_DT } from '../src/config.js';

function run(count, method, scenario) {
  const free = scenario === 'free-flight';
  const simulation = new BoidSimulation({
    count,
    predator: !free,
    goal: !free,
    cohesion: free ? 0 : 0.85,
    alignment: free ? 0 : 1.2,
    searchType: method === 'kd-tree' ? 'kd-tree' : 'grid',
  });
  if (method === 'all-pairs') simulation.search = { kind: 'all-pairs' };
  for (let i = 0; i < 120; i++) simulation.step(FIXED_DT);
  const timings = [];
  let checks = 0;
  for (let i = 0; i < 360; i++) {
    const start = performance.now();
    simulation.step(FIXED_DT);
    timings.push(performance.now() - start);
    checks += simulation.metrics.neighborChecks;
  }
  timings.sort((a, b) => a - b);
  return {
    agents: count,
    scenario,
    method,
    backend: simulation.backend,
    meanMs: +(timings.reduce((a, b) => a + b, 0) / timings.length).toFixed(3),
    p95Ms: +timings[Math.floor(timings.length * 0.95)].toFixed(3),
    meanDistanceChecks: Math.round(checks / timings.length),
  };
}
const rows = [];
for (const count of [320, 1200])
  for (const scenario of ['free-flight', 'flocking'])
    for (const method of ['all-pairs', 'grid', 'kd-tree']) rows.push(run(count, method, scenario));
const result = {
  environment: {
    node: process.version,
    cpu: os.cpus()[0].model.trim(),
    platform: `${process.platform} ${process.arch}`,
  },
  conditions:
    'seed 22823; radius 10; FOV 360; 120 warm-up + 360 measured fixed 1/60 s steps; full C++20 WASM CPU step INCLUDING search rebuild and JS bridge; free-flight disables goal/predator/cohesion/alignment; flocking uses defaults with predator enabled; identical C++ rules for every search strategy',
  results: rows,
};
await mkdir(new URL('../artifacts/', import.meta.url), { recursive: true });
await writeFile(
  new URL('../artifacts/cpp-benchmark.json', import.meta.url),
  JSON.stringify(result, null, 2),
);
console.log(JSON.stringify(result, null, 2));
