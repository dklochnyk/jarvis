// A digital brain: ~200 neurons in a brain-shaped cloud, wired to their neighbours.
// Signals travel along the wires and cascade; how busy it is depends on what Jarvis is doing.
(function (root) {
  function rng(seed) {
    let a = seed >>> 0;
    return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  }
  const gauss = (r) => Math.sqrt(-2 * Math.log(r() + 1e-9)) * Math.cos(6.2831853 * r());

  function build(seed = 7, N = 170) {
    const r = rng(seed), nodes = [];
    const dir = () => { const x = gauss(r), y = gauss(r), z = gauss(r), l = Math.hypot(x, y, z) || 1; return [x / l, y / l, z / l]; };
    // two hemispheres with a gap between them
    while (nodes.length < N) {
      const h = nodes.length % 2 ? 1 : -1, d = dir();
      const fold = 1 + 0.07 * Math.sin(5 * d[0] + 3 * d[2]) * Math.sin(4 * d[1]);
      const k = (0.86 + 0.14 * r()) * fold;
      let x = h * 0.22 + d[0] * 0.30 * k, y = d[1] * 0.36 * k - 0.03, z = d[2] * 0.52 * k;
      if (h * x < 0.025) x = h * 0.025;
      if (y > 0.16) y = 0.16 + (y - 0.16) * 0.45;   // flatter underside
      nodes.push({ x, y, z, g: 0 });
    }
    for (let i = 0; i < 26; i++) {              // cerebellum
      const d = dir(), k = 0.85 + 0.15 * r();
      nodes.push({ x: d[0] * 0.20 * k, y: 0.27 + d[1] * 0.10 * k, z: -0.40 + d[2] * 0.13 * k, g: 0 });
    }
    for (let i = 0; i < 8; i++) {               // brain stem
      const t = i / 7;
      nodes.push({ x: (r() - 0.5) * 0.04, y: 0.2 + t * 0.34, z: -0.12 - t * 0.08 + (r() - 0.5) * 0.04, g: 0 });
    }
    const edges = [], seen = new Set(), adj = nodes.map(() => []);
    nodes.forEach((a, i) => {
      const near = nodes.map((b, j) => [j, (a.x - b.x) ** 2 + (a.y - b.y) ** 2 + (a.z - b.z) ** 2]).filter(([j, d]) => j !== i && d < 0.085)
        .sort((p, q) => p[1] - q[1]).slice(0, 3);
      for (const [j] of near) {
        const key = i < j ? i + ',' + j : j + ',' + i;
        if (seen.has(key)) continue;
        seen.add(key); edges.push([i, j]);
        adj[i].push(edges.length - 1); adj[j].push(edges.length - 1);
      }
    });
    return { nodes, edges, adj };
  }

  const RATES = {
    loading: [8, 0.5], idle: [2.4, 0.4], listening: [5, 0.55], thinking: [26, 0.8], speaking: [7, 0.55], error: [14, 0.4],
  };

  class Brain {
    constructor(seed) {
      Object.assign(this, build(seed));
      this.pulses = []; this.acc = 0; this.fired = 0; this.px = new Float32Array(this.nodes.length * 3);
    }
    spawnFrom(node, avoidEdge) {
      const list = this.adj[node].filter((e) => e !== avoidEdge);
      if (!list.length || this.pulses.length > 90) return;
      const e = list[(Math.random() * list.length) | 0];
      this.pulses.push({ e, from: this.edges[e][0] === node ? 0 : 1, p: 0, sp: 2 + Math.random() * 2 });
    }
    update(dt, state, lv) {
      const [rate0, cas] = RATES[state] || RATES.idle;
      const rate = rate0 + ((state === 'listening' || state === 'speaking') ? lv * 45 : 0);
      this.acc += rate * dt;
      while (this.acc >= 1) { this.acc -= 1; this.spawnFrom((Math.random() * this.nodes.length) | 0); }
      for (const n of this.nodes) n.g = Math.max(0, n.g - dt * 2.2);
      const keep = [];
      for (const p of this.pulses) {
        p.p += p.sp * dt;
        if (p.p < 1) { keep.push(p); continue; }
        const to = this.edges[p.e][p.from ? 0 : 1];
        this.nodes[to].g = 1; this.fired++;
        if (Math.random() < cas) this.spawnFrom(to, p.e);
        if (state === 'thinking' && Math.random() < 0.3) this.spawnFrom(to, p.e);
      }
      this.pulses = keep;  // (signals born during this loop were advanced and kept above)
    }
    get firing() { return this.nodes.reduce((n, a) => n + (a.g > 0.3 ? 1 : 0), 0); }

    draw(ctx, cx, cy, R, t, c, alpha) {
      const yaw = t * 0.28, pitch = 0.2 + 0.08 * Math.sin(t * 0.3);
      const cyw = Math.cos(yaw), syw = Math.sin(yaw), cp = Math.cos(pitch), sp = Math.sin(pitch);
      const S = (R * 1.62) / 1.0, P = this.px, nodes = this.nodes;
      for (let i = 0; i < nodes.length; i++) {
        const n = nodes[i];
        const x1 = n.x * cyw + n.z * syw, z1 = -n.x * syw + n.z * cyw;
        const y2 = n.y * cp - z1 * sp, z2 = n.y * sp + z1 * cp;
        const f = 1.7 / (1.7 - z2 * 0.9);
        P[i * 3] = cx + x1 * S * f; P[i * 3 + 1] = cy + y2 * S * f; P[i * 3 + 2] = z2;
      }
      const col = (a) => `rgba(${c[0] | 0},${c[1] | 0},${c[2] | 0},${a})`;
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      // wires: far ones dim, near ones brighter
      for (let pass = 0; pass < 2; pass++) {
        ctx.beginPath();
        for (const [a, b] of this.edges) {
          const near = (P[a * 3 + 2] + P[b * 3 + 2]) > 0;
          if (near !== (pass === 1)) continue;
          ctx.moveTo(P[a * 3], P[a * 3 + 1]); ctx.lineTo(P[b * 3], P[b * 3 + 1]);
        }
        ctx.strokeStyle = col((pass ? 0.34 : 0.13) * alpha); ctx.lineWidth = pass ? 0.9 : 0.6; ctx.stroke();
      }
      // neurons
      const u = Math.max(0.55, R / 62);
      for (let i = 0; i < nodes.length; i++) {
        const d = (P[i * 3 + 2] + 0.56) / 1.12, g = nodes[i].g;
        const r = (0.8 + 1.0 * d + g * 1.5) * u;
        ctx.fillStyle = g > 0.05 ? `rgba(${255 * g * 0.5 + c[0] * (1 - g * 0.5) | 0},${255 * g * 0.5 + c[1] * (1 - g * 0.5) | 0},${255 * g * 0.5 + c[2] * (1 - g * 0.5) | 0},${Math.min(1, (0.35 + 0.35 * d + g) * alpha)})` : col((0.22 + 0.4 * d) * alpha);
        ctx.beginPath(); ctx.arc(P[i * 3], P[i * 3 + 1], r, 0, 6.2832); ctx.fill();
      }
      // travelling signals with a short tail
      for (const p of this.pulses) {
        const [a, b] = this.edges[p.e], s = p.from ? b : a, e = p.from ? a : b;
        const x = P[s * 3] + (P[e * 3] - P[s * 3]) * p.p, y = P[s * 3 + 1] + (P[e * 3 + 1] - P[s * 3 + 1]) * p.p;
        const q = Math.max(0, p.p - 0.28);
        ctx.strokeStyle = col(0.7 * alpha); ctx.lineWidth = 1.4 * u;
        ctx.beginPath(); ctx.moveTo(P[s * 3] + (P[e * 3] - P[s * 3]) * q, P[s * 3 + 1] + (P[e * 3 + 1] - P[s * 3 + 1]) * q); ctx.lineTo(x, y); ctx.stroke();
        ctx.fillStyle = `rgba(255,255,255,${0.95 * alpha})`; ctx.beginPath(); ctx.arc(x, y, 1.5 * u, 0, 6.2832); ctx.fill();
      }
      ctx.restore();
    }
  }

  const api = { build, Brain, rng };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.BrainViz = api;
})(typeof window !== 'undefined' ? window : globalThis);
