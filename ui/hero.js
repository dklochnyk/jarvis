// The hero: a big anatomical digital brain (~800 neurons) with lobes, folds, cerebellum, brain stem and deep
// structures. Different regions light up for different stages (listening, thinking, planning, executing,
// responding), signals cascade along the wiring, and labelled leader lines point at the active regions.
(function (root) {
  const TAU = Math.PI * 2;
  const rng = (a) => () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  const gauss = (r) => Math.sqrt(-2 * Math.log(r() + 1e-9)) * Math.cos(TAU * r());

  // x = front(+)/back(-), y = up(+)/down(-), z = left/right. Two hemispheres sit either side of z = 0.
  const LOBES = {
    frontal:   { c: [0.52, 0.14], r: [0.50, 0.54, 0.40], w: 0.34 },
    parietal:  { c: [-0.02, 0.34], r: [0.52, 0.44, 0.40], w: 0.30 },
    occipital: { c: [-0.70, 0.06], r: [0.30, 0.38, 0.36], w: 0.14 },
    temporal:  { c: [0.14, -0.30], r: [0.52, 0.26, 0.40], w: 0.22 },
  };
  const HEMI_Z = 0.43;
  const REGIONS = ['pfc', 'motor', 'broca', 'parietal', 'temporal', 'occipital', 'cerebellum', 'hippo', 'deep', 'stem'];

  const inside = (l, h, x, y, z) => ((x - l.c[0]) / l.r[0]) ** 2 + ((y - l.c[1]) / l.r[1]) ** 2 + ((z - h * HEMI_Z) / l.r[2]) ** 2;

  function classify(lobe, x, y) {
    if (lobe === 'frontal') return x > 0.5 ? 'pfc' : y > 0.3 ? 'motor' : 'broca';
    if (lobe === 'parietal') return x > 0.12 && y > 0.4 ? 'motor' : 'parietal';
    if (lobe === 'temporal') return x > 0.42 && y > -0.2 ? 'broca' : 'temporal';
    return 'occipital';
  }

  function build(seed = 21) {
    const r = rng(seed), nodes = [];
    const add = (x, y, z, region) => nodes.push({ x, y, z, region, g: 0, sg: 0 });
    const names = Object.keys(LOBES);
    const pick = () => { let u = r(), acc = 0; for (const n of names) { acc += LOBES[n].w; if (u <= acc) return n; } return names[0]; };

    for (let h of [-1, 1]) {
      let n = 0;
      while (n < 270) {
        const name = pick(), l = LOBES[name];
        const dx = gauss(r), dy = gauss(r), dz = gauss(r), m = Math.hypot(dx, dy, dz) || 1;
        const k = 0.96 + 0.07 * r();
        let x = l.c[0] + (dx / m) * l.r[0] * k, y = l.c[1] + (dy / m) * l.r[1] * k, z = h * HEMI_Z + (dz / m) * l.r[2] * k;
        const fold = 1 + 0.05 * Math.sin(11 * x + 4 * y) * Math.sin(9 * z + 5 * y) + 0.02 * Math.sin(23 * x + 17 * z);
        x = l.c[0] + (x - l.c[0]) * fold; y = l.c[1] + (y - l.c[1]) * fold; z = h * HEMI_Z + (z - h * HEMI_Z) * fold;
        if (names.some((o) => o !== name && inside(LOBES[o], h, x, y, z) < 0.86)) continue;   // buried inside a neighbour
        if (h * z < 0.04) z = h * 0.04;                                                         // keep the fissure open
        add(x, y, z, classify(name, x, y)); n++;
      }
    }
    for (let i = 0; i < 80; i++) {                     // cerebellum: banded, with a ridged look
      const dx = gauss(r), dy = gauss(r), dz = gauss(r), m = Math.hypot(dx, dy, dz) || 1;
      let y = -0.46 + (dy / m) * 0.2; y = Math.round(y * 22) / 22 + (r() - 0.5) * 0.01;
      add(-0.62 + (dx / m) * 0.30, y, (dz / m) * 0.46, 'cerebellum');
    }
    for (let i = 0; i < 26; i++) { const t = i / 25; add(-0.2 - 0.14 * t + (r() - 0.5) * 0.05, -0.4 - 0.55 * t, (r() - 0.5) * 0.16, 'stem'); }
    for (let h of [-1, 1]) for (let i = 0; i < 18; i++) {   // hippocampus: a curved bundle deep on each side
      const t = i / 17; add(-0.25 + t * 0.7, -0.08 - 0.13 * Math.sin(t * Math.PI), h * (0.16 + 0.1 * t) + (r() - 0.5) * 0.04, 'hippo');
    }
    let d = 0;                                          // deep white matter
    while (d < 130) {
      const x = -0.8 + r() * 1.6, y = -0.4 + r() * 0.9, z = (r() * 2 - 1) * 0.6, h = z >= 0 ? 1 : -1;
      if (!names.some((o) => inside(LOBES[o], h, x, y, z) < 0.5)) continue;
      add(x, y, z, 'deep'); d++;
    }

    const edges = [], seen = new Set(), adj = nodes.map(() => []);
    const link = (i, j) => { const key = i < j ? i + ',' + j : j + ',' + i; if (seen.has(key)) return; seen.add(key); edges.push([i, j]); adj[i].push(edges.length - 1); adj[j].push(edges.length - 1); };
    nodes.forEach((a, i) => {
      const near = [];
      nodes.forEach((b, j) => { if (j === i) return; const dd = (a.x - b.x) ** 2 + (a.y - b.y) ** 2 + (a.z - b.z) ** 2; if (dd < 0.055) near.push([j, dd]); });
      near.sort((p, q) => p[1] - q[1]).slice(0, a.region === 'deep' || a.region === 'hippo' ? 4 : 3).forEach(([j]) => link(i, j));
    });
    // corpus callosum: bridges between the two hemispheres
    const L = nodes.map((n, i) => [n, i]).filter(([n]) => n.z < -0.03 && n.z > -0.3 && n.region !== 'cerebellum' && n.region !== 'stem');
    const Rr = nodes.map((n, i) => [n, i]).filter(([n]) => n.z > 0.03 && n.z < 0.3 && n.region !== 'cerebellum' && n.region !== 'stem');
    for (let k = 0; k < 28; k++) {
      const [a, i] = L[(r() * L.length) | 0];
      let best = -1, bd = 9;
      for (const [b, j] of Rr) { const dd = (a.x - b.x) ** 2 + (a.y - b.y) ** 2; if (dd < bd) { bd = dd; best = j; } }
      if (best >= 0) link(i, best);
    }
    const members = {}; REGIONS.forEach((g) => (members[g] = []));
    nodes.forEach((n, i) => members[n.region].push(i));
    return { nodes, edges, adj, members };
  }

  // stage -> how strongly each region is working
  const TARGET = {
    idle:       { all: 0.22 },
    loading:    { all: 0.5 },
    listening:  { temporal: 1, occipital: 0.3, deep: 0.5, hippo: 0.3, all: 0.18 },
    thinking:   { pfc: 1, parietal: 0.8, deep: 0.6, hippo: 0.4, all: 0.2 },
    planning:   { pfc: 1, hippo: 1, deep: 0.7, parietal: 0.4, all: 0.2 },
    executing:  { motor: 1, cerebellum: 1, stem: 0.6, parietal: 0.5, pfc: 0.3, all: 0.18 },
    responding: { broca: 1, temporal: 0.6, motor: 0.3, pfc: 0.4, all: 0.18 },
    error:      { all: 0.7 },
  };

  // label slots: which region, text, side of the brain, vertical position (fraction of radius)
  const SLOTS = [
    ['pfc', 'PREFRONTAL CORTEX', 'PLANNING · REASONING', 1, -0.62],
    ['motor', 'MOTOR CORTEX', 'EXECUTING ACTIONS', 1, -0.98],
    ['broca', "BROCA'S AREA", 'SPEECH', 1, 0.0],
    ['temporal', 'TEMPORAL LOBE', 'HEARING · LANGUAGE', 1, 0.62],
    ['parietal', 'PARIETAL LOBE', 'ANALYSIS', -1, -0.78],
    ['occipital', 'VISUAL CORTEX', 'SCREEN AWARENESS', -1, -0.18],
    ['hippo', 'HIPPOCAMPUS', 'MEMORY', -1, 0.42],
    ['cerebellum', 'CEREBELLUM', 'COORDINATION', -1, 0.88],
  ];

  class Hero {
    constructor(seed) {
      Object.assign(this, build(seed));
      this.w = {}; REGIONS.forEach((g) => (this.w[g] = 0.2));
      this.pulses = []; this.rings = []; this.acc = 0; this.P = new Float32Array(this.nodes.length * 3);
      this.anchor = {}; this.energy = 0;
    }
    spawn(node, avoid) {
      const list = this.adj[node].filter((e) => e !== avoid);
      if (!list.length || this.pulses.length > 230) return;
      const e = list[(Math.random() * list.length) | 0];
      this.pulses.push({ e, from: this.edges[e][0] === node ? 0 : 1, p: 0, sp: 1.6 + Math.random() * 2.2 });
    }
    update(dt, phase, lv, bass) {
      const tgt = TARGET[phase || 'idle'] || TARGET.idle;
      let sum = 0;
      for (const g of REGIONS) {
        let want = tgt[g] != null ? tgt[g] : tgt.all;
        if (g === 'temporal' && bass) want = Math.max(want, 0.4 + bass * 0.6);   // music lights the auditory cortex
        this.w[g] += (want - this.w[g]) * Math.min(1, dt * 4);
        sum += this.w[g] * this.members[g].length;
      }
      this.energy = sum / this.nodes.length;
      const rate = 4 + 90 * this.energy * this.energy + lv * 40;
      this.acc += rate * dt;
      while (this.acc >= 1) {
        this.acc -= 1;
        let u = Math.random() * sum, node = 0;
        outer: for (const g of REGIONS) { const wt = this.w[g] * this.members[g].length; if (u <= wt) { node = this.members[g][(Math.random() * this.members[g].length) | 0]; break outer; } u -= wt; }
        this.spawn(node);
      }
      for (const n of this.nodes) { n.g = Math.max(0, n.g - dt * 2.0); }
      const keep = [];
      for (const p of this.pulses) {
        p.p += p.sp * dt;
        if (p.p < 1) { keep.push(p); continue; }
        const to = this.edges[p.e][p.from ? 0 : 1], nd = this.nodes[to];
        nd.g = 1;
        if (this.rings.length < 36 && Math.random() < 0.18) this.rings.push({ i: to, age: 0 });
        const cas = 0.42 + 0.4 * this.w[nd.region];
        if (Math.random() < cas) this.spawn(to, p.e);
        if (this.w[nd.region] > 0.8 && Math.random() < 0.25) this.spawn(to, p.e);
      }
      this.pulses = keep;
      this.rings = this.rings.filter((q) => (q.age += dt) < 0.7);
    }
    get firing() { let n = 0; for (const a of this.nodes) if (a.g > 0.3) n++; return n; }

    draw(ctx, cx, cy, R, t, c, alpha, labelsOn) {
      const yaw = -0.12 + 0.42 * Math.sin(t * 0.22), pitch = 0.1 + 0.05 * Math.sin(t * 0.31);
      const cyw = Math.cos(yaw), syw = Math.sin(yaw), cp = Math.cos(pitch), sp = Math.sin(pitch);
      const P = this.P, nodes = this.nodes, sums = {};
      const scanY = cy + Math.sin(t * 0.55) * R * 0.62;
      for (let i = 0; i < nodes.length; i++) {
        const n = nodes[i];
        const x1 = n.x * cyw + n.z * syw, z1 = -n.x * syw + n.z * cyw;
        const y2 = n.y * cp - z1 * sp, z2 = n.y * sp + z1 * cp;
        const f = 1 / (1 - z2 * 0.22);
        P[i * 3] = cx + x1 * R * f; P[i * 3 + 1] = cy - y2 * R * f; P[i * 3 + 2] = z2;
        n.sg = Math.max(0, 1 - Math.abs(P[i * 3 + 1] - scanY) / (R * 0.05));
        const s = sums[n.region] || (sums[n.region] = [0, 0, 0]); s[0] += P[i * 3]; s[1] += P[i * 3 + 1]; s[2]++;
      }
      for (const k in sums) this.anchor[k] = [sums[k][0] / sums[k][2], sums[k][1] / sums[k][2]];
      const col = (a, cc = c) => `rgba(${cc[0] | 0},${cc[1] | 0},${cc[2] | 0},${a})`;
      ctx.save(); ctx.globalCompositeOperation = 'lighter';

      // region glows
      for (const g of REGIONS) {
        const w = this.w[g]; if (w < 0.45 || !this.anchor[g] || g === 'deep' || g === 'stem') continue;
        const [ax, ay] = this.anchor[g], rr = R * 0.42;
        const gr = ctx.createRadialGradient(ax, ay, 0, ax, ay, rr);
        gr.addColorStop(0, col(0.22 * w * alpha)); gr.addColorStop(1, col(0));
        ctx.fillStyle = gr; ctx.beginPath(); ctx.arc(ax, ay, rr, 0, TAU); ctx.fill();
      }
      // wiring (far / near)
      const E = this.edges;
      for (let pass = 0; pass < 2; pass++) {
        ctx.beginPath();
        for (let k = 0; k < E.length; k++) {
          const a = E[k][0], b = E[k][1], near = P[a * 3 + 2] + P[b * 3 + 2] > 0;
          if (near !== (pass === 1)) continue;
          ctx.moveTo(P[a * 3], P[a * 3 + 1]); ctx.lineTo(P[b * 3], P[b * 3 + 1]);
        }
        ctx.strokeStyle = col((pass ? 0.30 : 0.11) * alpha); ctx.lineWidth = pass ? 0.9 : 0.6; ctx.stroke();
      }
      // neurons in four brightness buckets (one fill each)
      const bk = [[], [], [], []], u = Math.max(0.8, R / 190);
      for (let i = 0; i < nodes.length; i++) {
        const n = nodes[i], d = (P[i * 3 + 2] + 0.9) / 1.8;
        const v = (0.18 + 0.3 * d) + 0.45 * this.w[n.region] + n.g * 0.9 + n.sg * 0.7;
        bk[v < 0.45 ? 0 : v < 0.8 ? 1 : v < 1.2 ? 2 : 3].push(i);
      }
      const sty = [[0.45, 1.1], [0.65, 1.5], [0.9, 2.1], [1, 2.9]];
      bk.forEach((list, b) => {
        if (!list.length) return;
        ctx.beginPath();
        for (const i of list) { const rr = sty[b][1] * u; ctx.moveTo(P[i * 3] + rr, P[i * 3 + 1]); ctx.arc(P[i * 3], P[i * 3 + 1], rr, 0, TAU); }
        ctx.fillStyle = b === 3 ? `rgba(${(c[0] + 255) / 2 | 0},${(c[1] + 255) / 2 | 0},${(c[2] + 255) / 2 | 0},${sty[b][0] * alpha})` : col(sty[b][0] * alpha);
        ctx.fill();
      });
      // synapse flashes
      ctx.lineWidth = 1;
      for (const q of this.rings) { ctx.strokeStyle = col((1 - q.age / 0.7) * 0.6 * alpha); ctx.beginPath(); ctx.arc(P[q.i * 3], P[q.i * 3 + 1], (2 + q.age * 20) * u, 0, TAU); ctx.stroke(); }
      // travelling signals
      for (const p of this.pulses) {
        const [a, b] = this.edges[p.e], s = p.from ? b : a, e = p.from ? a : b;
        const sx = P[s * 3], sy = P[s * 3 + 1], ex = P[e * 3], ey = P[e * 3 + 1];
        const x = sx + (ex - sx) * p.p, y = sy + (ey - sy) * p.p, q = Math.max(0, p.p - 0.3);
        ctx.strokeStyle = col(0.7 * alpha); ctx.lineWidth = 1.5 * u;
        ctx.beginPath(); ctx.moveTo(sx + (ex - sx) * q, sy + (ey - sy) * q); ctx.lineTo(x, y); ctx.stroke();
        ctx.fillStyle = `rgba(255,255,255,${0.95 * alpha})`; ctx.beginPath(); ctx.arc(x, y, 1.7 * u, 0, TAU); ctx.fill();
      }
      // scan line
      const sl = ctx.createLinearGradient(cx - R * 1.15, 0, cx + R * 1.15, 0);
      sl.addColorStop(0, col(0)); sl.addColorStop(0.5, col(0.55 * alpha)); sl.addColorStop(1, col(0));
      ctx.strokeStyle = sl; ctx.lineWidth = 1.4; ctx.beginPath(); ctx.moveTo(cx - R * 1.15, scanY); ctx.lineTo(cx + R * 1.15, scanY); ctx.stroke();
      ctx.restore();

      if (labelsOn) this.drawLabels(ctx, cx, cy, R, c, alpha);
    }

    drawLabels(ctx, cx, cy, R, c, alpha) {
      ctx.save(); ctx.textBaseline = 'middle';
      const col = (a) => `rgba(${c[0] | 0},${c[1] | 0},${c[2] | 0},${a})`;
      for (const [reg, title, sub, side, dy] of SLOTS) {
        const a = this.anchor[reg]; if (!a) continue;
        const act = Math.max(0, Math.min(1, (this.w[reg] - 0.25) / 0.75));
        const lx = cx + side * R * 1.38, ly = cy + dy * R * 0.5 + (dy < 0 ? -R * 0.12 : R * 0.08);
        const ex = lx - side * 26;
        ctx.strokeStyle = col((0.22 + 0.6 * act) * alpha); ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(ex - side * 18 * 0 + side * 0, ly); ctx.lineTo(lx, ly); ctx.stroke();
        ctx.fillStyle = col((0.5 + 0.5 * act) * alpha); ctx.beginPath(); ctx.arc(a[0], a[1], 2.5 + act * 2, 0, TAU); ctx.fill();
        ctx.strokeStyle = col((0.3 + 0.6 * act) * alpha); ctx.beginPath(); ctx.arc(a[0], a[1], 6 + act * 3, 0, TAU); ctx.stroke();
        ctx.textAlign = side > 0 ? 'left' : 'right';
        const tx = lx + side * 8;
        ctx.font = '600 11px Consolas, monospace'; ctx.fillStyle = col((0.6 + 0.4 * act) * alpha); ctx.fillText(title, tx, ly - 7);
        ctx.font = '10px Consolas, monospace'; ctx.fillStyle = col((0.4 + 0.5 * act) * alpha); ctx.fillText(sub + (act > 0.7 ? '  ● ACTIVE' : ''), tx, ly + 7);
      }
      ctx.restore();
    }
  }

  const api = { build, Hero, REGIONS, SLOTS, TARGET };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.HeroViz = api;
})(typeof window !== 'undefined' ? window : globalThis);
