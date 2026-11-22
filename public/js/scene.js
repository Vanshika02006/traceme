// Ambient Three.js background: a point-cloud globe with glowing "footprint"
// arcs. It reacts to the pointer, scroll, theme and scan progress (pings).
import * as THREE from 'three';

const THEMES = {
  dark: { point: 0x5598e7, arc: 0x6da7ec, pulse: 0xb7d3f6, dust: 0x9085e9, ring: 0x3987e5, blending: THREE.AdditiveBlending, pointOpacity: 0.85, arcOpacity: 0.45 },
  light: { point: 0x1c5cab, arc: 0x2a78d6, pulse: 0x6250d6, dust: 0x6250d6, ring: 0x2a78d6, blending: THREE.NormalBlending, pointOpacity: 0.55, arcOpacity: 0.5 },
};

function dotTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d');
  const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(0.35, 'rgba(255,255,255,.85)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 64, 64);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function fibonacciSphere(n, r) {
  const pts = new Float32Array(n * 3);
  const golden = Math.PI * (3 - Math.sqrt(5));
  for (let i = 0; i < n; i++) {
    const y = 1 - (i / (n - 1)) * 2;
    const rad = Math.sqrt(1 - y * y);
    const th = golden * i;
    pts.set([Math.cos(th) * rad * r, y * r, Math.sin(th) * rad * r], i * 3);
  }
  return pts;
}

const randomOnSphere = (r) => {
  const u = Math.random() * 2 - 1, th = Math.random() * Math.PI * 2, s = Math.sqrt(1 - u * u);
  return new THREE.Vector3(Math.cos(th) * s * r, u * r, Math.sin(th) * s * r);
};

function arcCurve(a, b, r) {
  const mid = a.clone().add(b).multiplyScalar(0.5);
  const lift = r * (1.15 + a.distanceTo(b) / (r * 3.2));
  mid.normalize().multiplyScalar(lift);
  return new THREE.QuadraticBezierCurve3(a, mid, b);
}

export function initBackground(canvas) {
  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true, powerPreference: 'low-power' });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 100);
  camera.position.set(0, 0, 9);

  const R = 2.4;
  let theme = THEMES[document.documentElement.dataset.theme] || THEMES.dark;
  const tex = dotTexture();
  const world = new THREE.Group();
  const globe = new THREE.Group();
  world.add(globe);
  scene.add(world);

  // globe points
  const pGeo = new THREE.BufferGeometry();
  pGeo.setAttribute('position', new THREE.BufferAttribute(fibonacciSphere(2200, R), 3));
  const pMat = new THREE.PointsMaterial({ size: 0.045, map: tex, transparent: true, depthWrite: false, sizeAttenuation: true });
  globe.add(new THREE.Points(pGeo, pMat));

  // latitude rings
  const ringMat = new THREE.LineBasicMaterial({ transparent: true, opacity: 0.12, depthWrite: false });
  [-0.6, -0.3, 0, 0.3, 0.6].forEach((lat) => {
    const y = Math.sin(lat) * R, rr = Math.cos(lat) * R;
    const pts = Array.from({ length: 129 }, (_, i) => new THREE.Vector3(Math.cos((i / 128) * Math.PI * 2) * rr, y, Math.sin((i / 128) * Math.PI * 2) * rr));
    globe.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), ringMat));
  });

  // arcs between "footprints" + travelling pulses
  const home = new THREE.Vector3(0.6, 0.9, 1).normalize().multiplyScalar(R);
  const arcMat = new THREE.LineBasicMaterial({ transparent: true, depthWrite: false });
  const pulseMat = new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false });
  const arcs = [];
  function addArc(from, to, { life = Infinity, speed = 0.18 + Math.random() * 0.2 } = {}) {
    const curve = arcCurve(from, to, R);
    const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints(curve.getPoints(64)), arcMat.clone());
    const pulse = new THREE.Sprite(pulseMat.clone());
    pulse.scale.setScalar(0.16);
    globe.add(line, pulse);
    const arc = { curve, line, pulse, t: Math.random(), speed, life, age: 0 };
    arcs.push(arc);
    applyTheme(arc);
    return arc;
  }
  for (let i = 0; i < 7; i++) addArc(randomOnSphere(R), randomOnSphere(R));

  // home node
  const homeSprite = new THREE.Sprite(pulseMat.clone());
  homeSprite.position.copy(home);
  homeSprite.scale.setScalar(0.34);
  globe.add(homeSprite);

  // ambient dust
  const dGeo = new THREE.BufferGeometry();
  const dust = new Float32Array(700 * 3);
  for (let i = 0; i < dust.length; i++) dust[i] = (Math.random() - 0.5) * 26;
  dGeo.setAttribute('position', new THREE.BufferAttribute(dust, 3));
  const dMat = new THREE.PointsMaterial({ size: 0.03, map: tex, transparent: true, depthWrite: false, opacity: 0.5 });
  const dustPts = new THREE.Points(dGeo, dMat);
  scene.add(dustPts);

  // pings (expanding rings at discovered accounts)
  const rings = [];
  const ringGeo = new THREE.RingGeometry(0.06, 0.085, 48);

  function applyTheme(arc) {
    if (arc) {
      arc.line.material.color.setHex(theme.arc);
      arc.line.material.opacity = theme.arcOpacity;
      arc.line.material.blending = theme.blending;
      arc.pulse.material.color.setHex(theme.pulse);
      arc.pulse.material.blending = theme.blending;
      return;
    }
    pMat.color.setHex(theme.point); pMat.opacity = theme.pointOpacity; pMat.blending = theme.blending; pMat.needsUpdate = true;
    ringMat.color.setHex(theme.arc);
    dMat.color.setHex(theme.dust); dMat.blending = theme.blending; dMat.needsUpdate = true;
    homeSprite.material.color.setHex(theme.pulse); homeSprite.material.blending = theme.blending;
    arcs.forEach(applyTheme);
    rings.forEach((r) => r.mesh.material.color.setHex(theme.ring));
  }
  applyTheme();

  // layout: globe sits beside the form on wide screens, centred behind content on narrow ones
  const target = { x: 0, y: 0, scale: 1 };
  let mode = 'idle';
  function layout() {
    const w = innerWidth, h = innerHeight;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    if (mode === 'results') Object.assign(target, { x: w > 980 ? 3.4 : 0, y: 0, scale: 0.9 });
    else if (w > 980) Object.assign(target, { x: 0.35, y: -0.2, scale: 1.12 });
    else Object.assign(target, { x: 0, y: 1.6, scale: 0.8 });
  }
  layout();
  addEventListener('resize', layout);

  const mouse = new THREE.Vector2();
  addEventListener('pointermove', (e) => { mouse.set(e.clientX / innerWidth - 0.5, e.clientY / innerHeight - 0.5); }, { passive: true });

  let speed = 1, targetSpeed = 1, running = true;
  let last = performance.now(), elapsed = 0;
  const tick = () => { const now = performance.now(); const dt = (now - last) / 1000; last = now; elapsed += dt; return dt; };
  function frame() {
    const dt = Math.min(tick(), 0.05);
    speed += (targetSpeed - speed) * 0.04;
    globe.rotation.y += dt * 0.08 * speed;
    globe.rotation.x = 0.25 + scrollY * 0.00025;
    world.position.x += (target.x - world.position.x) * 0.04;
    world.position.y += (target.y - world.position.y) * 0.04 + 0;
    const s = world.scale.x + (target.scale - world.scale.x) * 0.04;
    world.scale.setScalar(s);
    camera.position.x += (mouse.x * 0.8 - camera.position.x) * 0.03;
    camera.position.y += (-mouse.y * 0.6 - camera.position.y) * 0.03;
    camera.lookAt(0, 0, 0);
    dustPts.rotation.y += dt * 0.01;

    for (let i = arcs.length - 1; i >= 0; i--) {
      const a = arcs[i];
      a.t = (a.t + dt * a.speed * speed) % 1;
      a.pulse.position.copy(a.curve.getPoint(a.t));
      a.age += dt;
      if (a.age > a.life) {
        const fade = Math.max(0, 1 - (a.age - a.life) / 1.5);
        a.line.material.opacity = theme.arcOpacity * fade;
        a.pulse.material.opacity = fade;
        if (fade === 0) { globe.remove(a.line, a.pulse); a.line.geometry.dispose(); arcs.splice(i, 1); }
      }
    }
    for (let i = rings.length - 1; i >= 0; i--) {
      const r = rings[i];
      r.age += dt;
      r.mesh.scale.setScalar(1 + r.age * 6);
      r.mesh.material.opacity = Math.max(0, 0.9 - r.age * 0.6);
      if (r.age > 1.6) { globe.remove(r.mesh); r.mesh.material.dispose(); rings.splice(i, 1); }
    }
    homeSprite.scale.setScalar(0.3 + Math.sin(elapsed * 2.4) * 0.05);
    renderer.render(scene, camera);
    if (running && !reduced) requestAnimationFrame(frame);
  }
  if (reduced) { world.position.set(target.x, target.y, 0); world.scale.setScalar(target.scale); }
  frame();

  document.addEventListener('visibilitychange', () => {
    const wasRunning = running;
    running = !document.hidden;
    if (running && !wasRunning && !reduced) { tick(); requestAnimationFrame(frame); }
  });
  const rerender = () => { if (reduced) frame(); };
  addEventListener('resize', rerender);

  return {
    setTheme(name) { theme = THEMES[name] || THEMES.dark; applyTheme(); rerender(); },
    setMode(m) {
      mode = m;
      targetSpeed = m === 'scan' ? 6 : 1;
      layout();
      rerender();
    },
    /** A newly found account: expanding ring + arc from "you". */
    ping() {
      const p = randomOnSphere(R);
      const mesh = new THREE.Mesh(ringGeo, new THREE.MeshBasicMaterial({ color: theme.ring, transparent: true, side: THREE.DoubleSide, depthWrite: false }));
      mesh.position.copy(p);
      mesh.lookAt(p.clone().multiplyScalar(2));
      globe.add(mesh);
      rings.push({ mesh, age: 0 });
      addArc(home, p, { life: 6, speed: 0.6 });
      rerender();
    },
  };
}
