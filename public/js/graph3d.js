// 3D identity graph: accounts are glossy spheres placed by a small 3D force
// simulation; strong evidence pulls accounts together. Drag to orbit, hover for evidence.
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { CSS2DRenderer, CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';

const cssVar = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();

function layout(nodes, edges) {
  const n = nodes.length;
  const golden = Math.PI * (3 - Math.sqrt(5));
  const pos = nodes.map((_, i) => {
    const y = n === 1 ? 0 : 1 - (i / (n - 1)) * 2, r = Math.sqrt(1 - y * y), t = golden * i;
    return new THREE.Vector3(Math.cos(t) * r * 3, y * 3, Math.sin(t) * r * 3);
  });
  if (n === 1) return [new THREE.Vector3()];
  const idx = Object.fromEntries(nodes.map((nd, i) => [nd.id, i]));
  const vel = pos.map(() => new THREE.Vector3());
  const tmp = new THREE.Vector3();
  for (let it = 0; it < 500; it++) {
    const cool = 1 - it / 500;
    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        tmp.subVectors(pos[i], pos[j]);
        const d2 = Math.max(tmp.lengthSq(), 0.01);
        tmp.multiplyScalar(4 / d2);
        vel[i].add(tmp); vel[j].sub(tmp);
      }
    }
    for (const e of edges) {
      const a = idx[e.source], b = idx[e.target];
      if (a == null || b == null) continue;
      tmp.subVectors(pos[b], pos[a]);
      const d = tmp.length() || 0.01;
      const rest = 3.2 - 1.1 * e.score; // strong links pull closer, but never into a clump
      tmp.multiplyScalar(((d - rest) / d) * 0.06 * e.score);
      vel[a].add(tmp); vel[b].sub(tmp);
    }
    for (let i = 0; i < n; i++) {
      vel[i].addScaledVector(pos[i], -0.012);
      pos[i].addScaledVector(vel[i], 0.5 * cool);
      vel[i].multiplyScalar(0.6);
    }
  }
  // centre, then scale by RMS radius so one outlier can't squash everyone else
  const c = pos.reduce((acc, p) => acc.add(p), new THREE.Vector3()).divideScalar(n);
  pos.forEach((p) => p.sub(c));
  const rms = Math.sqrt(pos.reduce((s, p) => s + p.lengthSq(), 0) / n) || 1;
  pos.forEach((p) => { p.multiplyScalar(3.2 / rms); if (p.length() > 4.2) p.setLength(4.2); });
  // wide & shallow: the canvas is landscape, and less depth means fewer overlapping labels
  pos.forEach((p) => { p.x *= 1.5; p.z *= 0.55; });
  // final pass: keep every pair at least MIN apart so spheres and labels don't collide
  const MIN = 2.5;
  for (let it = 0; it < 60; it++) {
    let moved = false;
    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        tmp.subVectors(pos[j], pos[i]);
        const d = tmp.length();
        if (d < MIN) {
          if (d < 1e-6) tmp.set(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5);
          tmp.setLength((MIN - d) / 2);
          pos[i].sub(tmp); pos[j].add(tmp);
          moved = true;
        }
      }
    }
    if (!moved) break;
  }
  return pos;
}

/**
 * @param {HTMLElement} container
 * @param {{nodes, edges}} graph
 * @param {{profiles: object[], tipNode: (n, p) => string, tipEdge: (e) => string, showTip: (html, ev) => void, hideTip: () => void}} opts
 */
export function createGraph3D(container, graph, opts) {
  container.innerHTML = '';
  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  container.appendChild(renderer.domElement);
  const labels = new CSS2DRenderer();
  Object.assign(labels.domElement.style, { position: 'absolute', inset: '0', pointerEvents: 'none' });
  container.appendChild(labels.domElement);

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(42, 1, 0.1, 100);
  camera.position.set(0, 1.2, 10.5);
  const controls = new OrbitControls(camera, renderer.domElement);
  Object.assign(controls, { enableDamping: true, dampingFactor: 0.08, enableZoom: false, enablePan: false, rotateSpeed: 0.7 });
  let sway = !reduced; // gentle idle sway until the user grabs the graph
  controls.addEventListener('start', () => { sway = false; });

  scene.add(new THREE.HemisphereLight(0xffffff, 0x445066, 1.6));
  const key = new THREE.DirectionalLight(0xffffff, 2.2);
  key.position.set(5, 8, 6);
  scene.add(key);
  const rim = new THREE.PointLight(0x9085e9, 30, 30);
  rim.position.set(-6, -3, -4);
  scene.add(rim);

  const world = new THREE.Group();
  scene.add(world);
  const nodes = graph.nodes;
  const pos = layout(nodes, graph.edges);
  const byId = Object.fromEntries(nodes.map((n, i) => [n.id, { n, p: pos[i] }]));
  const profiles = Object.fromEntries((opts.profiles || []).map((p) => [p.id, p]));

  const tier = (c) => (c >= 0.75 ? 'high' : c >= 0.45 ? 'mid' : 'low');
  const sphereGeo = new THREE.SphereGeometry(1, 48, 32);
  const nodeMeshes = [];
  const edgeObjs = [];
  const labelEls = [];

  nodes.forEach((n, i) => {
    const r = 0.2 + 0.16 * n.confidence;
    const mat = new THREE.MeshPhysicalMaterial({ roughness: 0.18, metalness: 0.05, clearcoat: 1, clearcoatRoughness: 0.1 });
    const mesh = new THREE.Mesh(sphereGeo, mat);
    mesh.scale.setScalar(r);
    mesh.position.copy(pos[i]);
    mesh.userData = { kind: 'node', node: n, tier: tier(n.confidence), r };
    world.add(mesh);
    nodeMeshes.push(mesh);
    // glass shell around accounts that are likely yours
    if (n.confidence >= 0.75) {
      const shell = new THREE.Mesh(sphereGeo, new THREE.MeshPhysicalMaterial({ transparent: true, opacity: 0.16, roughness: 0, metalness: 0, clearcoat: 1, depthWrite: false }));
      shell.scale.setScalar(r * 1.45);
      shell.position.copy(pos[i]);
      shell.userData.shellOf = mesh;
      world.add(shell);
      mesh.userData.shell = shell;
    }
    const el = document.createElement('div');
    el.className = 'g3d-label';
    const name = document.createElement('span');
    name.textContent = `${n.label.replace(/ \(.*\)$/, '')} · ${Math.round(n.confidence * 100)}%`;
    const sub = document.createElement('small');
    sub.textContent = `@${n.username}`;
    el.append(name, sub);
    const obj = new CSS2DObject(el);
    obj.position.set(0, -(1.0 + 0.6 / r) , 0);
    mesh.add(obj);
    labelEls.push({ el, id: n.id });
  });

  const up = new THREE.Vector3(0, 1, 0);
  graph.edges.forEach((e) => {
    const a = byId[e.source]?.p, b = byId[e.target]?.p;
    if (!a || !b) return;
    const strong = e.score >= 0.5;
    let obj;
    if (strong) {
      const len = a.distanceTo(b);
      const geo = new THREE.CylinderGeometry(1, 1, len, 12, 1, true);
      obj = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ transparent: true, opacity: 0.35 + e.score * 0.5, roughness: 0.4, emissiveIntensity: 0.6 }));
      obj.scale.set(0.02 + e.score * 0.045, 1, 0.02 + e.score * 0.045);
      obj.position.copy(a).add(b).multiplyScalar(0.5);
      obj.quaternion.setFromUnitVectors(up, b.clone().sub(a).normalize());
    } else {
      obj = new THREE.Line(new THREE.BufferGeometry().setFromPoints([a, b]), new THREE.LineDashedMaterial({ dashSize: 0.12, gapSize: 0.12, transparent: true, opacity: 0.6 }));
      obj.computeLineDistances();
    }
    obj.userData = { kind: 'edge', edge: e, strong };
    world.add(obj);
    edgeObjs.push(obj);
  });

  function applyTheme() {
    const col = { high: cssVar('--conf-high'), mid: cssVar('--conf-mid'), low: cssVar('--conf-low') };
    const series = cssVar('--series'), muted = cssVar('--text-muted');
    const dark = document.documentElement.dataset.theme !== 'light';
    nodeMeshes.forEach((m) => {
      const c = new THREE.Color(col[m.userData.tier]);
      m.material.color.copy(c);
      m.material.emissive.copy(c).multiplyScalar(dark ? 0.35 : 0.08);
      m.userData.baseEmissive = m.material.emissive.clone();
      if (m.userData.shell) m.userData.shell.material.color.set(series);
    });
    edgeObjs.forEach((o) => {
      const c = new THREE.Color(o.userData.strong ? series : muted);
      o.material.color.copy(c);
      if (o.material.emissive) o.material.emissive.copy(c).multiplyScalar(dark ? 0.5 : 0.15);
    });
    rim.color.set(dark ? 0x9085e9 : 0x86b6ef);
    render();
  }

  // hover
  const ray = new THREE.Raycaster();
  ray.params.Line.threshold = 0.08;
  const ptr = new THREE.Vector2();
  let hovered = null;
  function setHighlight(target) {
    const connected = new Set();
    if (target?.userData.kind === 'node') {
      connected.add(target.userData.node.id);
      graph.edges.forEach((e) => { if (e.source === target.userData.node.id) connected.add(e.target); if (e.target === target.userData.node.id) connected.add(e.source); });
    }
    nodeMeshes.forEach((m) => {
      const on = !target || target.userData.kind !== 'node' || connected.has(m.userData.node.id);
      m.material.opacity = on ? 1 : 0.35;
      m.material.transparent = !on;
      m.material.emissive.copy(m.userData.baseEmissive).multiplyScalar(m === target ? 2.2 : 1);
    });
    labelEls.forEach(({ el, id }) => el.classList.toggle('dim', !!target && target.userData.kind === 'node' && !connected.has(id)));
    render();
  }
  renderer.domElement.addEventListener('pointermove', (ev) => {
    const rect = renderer.domElement.getBoundingClientRect();
    ptr.set(((ev.clientX - rect.left) / rect.width) * 2 - 1, -((ev.clientY - rect.top) / rect.height) * 2 + 1);
    ray.setFromCamera(ptr, camera);
    const hit = ray.intersectObjects([...nodeMeshes, ...edgeObjs], false)[0]?.object || null;
    if (hit !== hovered) { hovered = hit; setHighlight(hit); }
    if (hit?.userData.kind === 'node') opts.showTip(opts.tipNode(hit.userData.node, profiles[hit.userData.node.id]), ev);
    else if (hit?.userData.kind === 'edge') opts.showTip(opts.tipEdge(hit.userData.edge), ev);
    else opts.hideTip();
  });
  renderer.domElement.addEventListener('pointerleave', () => { hovered = null; setHighlight(null); opts.hideTip(); });

  function resize() {
    const w = container.clientWidth, h = container.clientHeight;
    if (!w || !h) return;
    renderer.setSize(w, h);
    labels.setSize(w, h);
    camera.aspect = w / h;
    // fit the camera to the graph's real extent, limited by the narrower field of view
    const pad = 1.1;
    const mx = Math.max(...pos.map((p) => Math.abs(p.x)), 0.5) + pad;
    const my = Math.max(...pos.map((p) => Math.abs(p.y)), 0.5) + pad + 0.5; // room for labels
    const mz = Math.max(...pos.map((p) => Math.abs(p.z)), 0.5);
    const tv = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
    camera.position.setLength(Math.max(mx / (tv * camera.aspect), my / tv) + mz);
    camera.updateProjectionMatrix();
    render();
  }
  function render() { renderer.render(scene, camera); labels.render(scene, camera); }

  let visible = true, raf = 0, alive = true;
  function loop() {
    raf = 0;
    if (!alive || !visible) return;
    if (sway) world.rotation.y = Math.sin(performance.now() / 2600) * 0.35;
    controls.update();
    render();
    raf = requestAnimationFrame(loop);
  }
  const start = () => { if (!raf) raf = requestAnimationFrame(loop); };
  controls.addEventListener('change', () => { if (reduced) render(); });
  const ro = new ResizeObserver(resize);
  ro.observe(container);
  const io = new IntersectionObserver(([en]) => { visible = en.isIntersecting; if (visible && !reduced) start(); });
  io.observe(container);
  applyTheme();
  resize();
  if (!reduced) start();
  else controls.addEventListener('change', render);

  return {
    setTheme: applyTheme,
    dispose() {
      alive = false;
      ro.disconnect(); io.disconnect(); controls.dispose();
      scene.traverse((o) => { o.geometry?.dispose(); o.material?.dispose?.(); });
      renderer.dispose();
      container.innerHTML = '';
    },
  };
}
