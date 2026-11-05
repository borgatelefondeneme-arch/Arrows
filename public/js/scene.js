// 3D sahne: kutuyu, yüzeyindeki kıvrımlı okları, kilitli karakteri çizer;
// döndürme / yakınlaştırma / dokunma ve okların kayma animasyonları.
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { DIRS, axisOf, rayCells, headOf } from './puzzle.js';

const ARROW_COLOR = '#2b2350';
const LOCK_COLOR = '#ff2e63';
const LINE_W = 0.2;
const HEAD_W = 0.3;
const HEAD_L = 0.36;
const LIFT = 0.012;

const N = DIRS.map((d) => new THREE.Vector3(...d));
const v3 = (a) => new THREE.Vector3(a[0], a[1], a[2]);

function easeInQuad(t) { return t * t; }
function easeOutCubic(t) { return 1 - Math.pow(1 - t, 3); }
function easeOutBack(t) { const c = 1.7; return 1 + (c + 1) * Math.pow(t - 1, 3) + c * Math.pow(t - 1, 2); }

// ---- Ok yolu ---------------------------------------------------------------
// Okun kuyruktan uca yolu + ucun önünden kenara ve oradan boşluğa uzanan uzantı.
function buildPath(dims, arrow) {
  const segs = [];
  const cs = arrow.cells;
  for (let i = 0; i < cs.length - 1; i++) {
    const A = cs[i];
    const B = cs[i + 1];
    const a = v3(A.c);
    const b = v3(B.c);
    if (A.f === B.f) segs.push({ a, b, n: N[A.f] });
    else {
      const e = a.clone().addScaledVector(N[B.f], 0.5); // kutu kenarındaki kıvrım noktası
      segs.push({ a, b: e, n: N[A.f], bEdge: true });
      segs.push({ a: e, b, n: N[B.f], aEdge: true });
    }
  }
  const bodyLen = segs.reduce((s, g) => s + g.a.distanceTo(g.b), 0);
  const head = headOf(arrow);
  const k = rayCells(dims, head, arrow.dir).length;
  const t = N[arrow.dir];
  const h = v3(head.c);
  const x = h.clone().addScaledVector(t, k + 0.5);
  segs.push({ a: h, b: x, n: N[head.f], bEdge: true });
  segs.push({ a: x, b: x.clone().addScaledVector(t, bodyLen + 12), n: N[head.f], aEdge: true });
  let acc = 0;
  for (const g of segs) { g.s0 = acc; g.len = g.a.distanceTo(g.b); acc += g.len; g.s1 = acc; }
  return { segs, bodyLen, exitDist: k + 0.5 };
}

// [s0, s1] aralığındaki yolu şerit + ok ucu üçgenlerine çevirir.
function ribbon(path, s0, s1) {
  const out = [];
  const tri = (p, q, r) => out.push(p.x, p.y, p.z, q.x, q.y, q.z, r.x, r.y, r.z);
  let last = null;
  let first = true;
  for (const g of path.segs) {
    if (g.s1 <= s0 || g.s0 >= s1 || g.len < 1e-6) continue;
    const d = g.b.clone().sub(g.a).divideScalar(g.len);
    const lift = g.n.clone().multiplyScalar(LIFT);
    const from = Math.max(s0, g.s0) - g.s0;
    const to = Math.min(s1, g.s1) - g.s0;
    let p0 = g.a.clone().addScaledVector(d, from);
    let p1 = g.a.clone().addScaledVector(d, to);
    // Dönüşlerde boşluk kalmasın diye uçları yarım genişlik uzat; kutu kenarındaki katlamalarda uzatma.
    const capStart = first || !(from === 0 && g.aEdge);
    const capEnd = !(to === g.len && g.bEdge) && g.s1 < s1;
    if (capStart) p0 = p0.addScaledVector(d, -LINE_W / 2);
    if (capEnd) p1 = p1.addScaledVector(d, LINE_W / 2);
    const side = new THREE.Vector3().crossVectors(d, g.n).multiplyScalar(LINE_W / 2);
    const a1 = p0.clone().add(side).add(lift);
    const a2 = p0.clone().sub(side).add(lift);
    const b1 = p1.clone().add(side).add(lift);
    const b2 = p1.clone().sub(side).add(lift);
    tri(a1, a2, b2); tri(a1, b2, b1);
    last = { end: g.a.clone().addScaledVector(d, to).add(lift), d, n: g.n };
    first = false;
  }
  if (last) {
    const side = new THREE.Vector3().crossVectors(last.d, last.n).multiplyScalar(HEAD_W);
    const base = last.end.clone().addScaledVector(last.d, -0.04);
    tri(base.clone().add(side), base.clone().sub(side), last.end.clone().addScaledVector(last.d, HEAD_L));
  }
  return new Float32Array(out);
}

// ---- Yüz dokusu: hafif noktalı ızgara -----------------------------------
function faceTexture(cols, rows) {
  const px = Math.max(16, Math.min(64, Math.floor(1024 / Math.max(cols, rows))));
  const cv = document.createElement('canvas');
  cv.width = cols * px;
  cv.height = rows * px;
  const ctx = cv.getContext('2d');
  const g = ctx.createLinearGradient(0, 0, cv.width, cv.height);
  g.addColorStop(0, '#ffffff');
  g.addColorStop(1, '#f1eeff');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, cv.width, cv.height);
  ctx.fillStyle = 'rgba(108, 92, 231, 0.28)';
  for (let i = 0; i < cols; i++) {
    for (let j = 0; j < rows; j++) {
      ctx.beginPath();
      ctx.arc((i + 0.5) * px, (j + 0.5) * px, Math.max(1.5, px * 0.05), 0, Math.PI * 2);
      ctx.fill();
    }
  }
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  return tex;
}

// ---- Karakter, asma kilit, kafes ------------------------------------------
function makeCharacter() {
  const g = new THREE.Group();
  const bodyMat = new THREE.MeshStandardMaterial({ color: '#ffd54f', roughness: 0.5 });
  const body = new THREE.Mesh(new THREE.SphereGeometry(0.3, 32, 24), bodyMat);
  body.scale.set(1, 0.92, 1);
  g.add(body);
  const earGeo = new THREE.ConeGeometry(0.09, 0.2, 16);
  for (const s of [-1, 1]) {
    const ear = new THREE.Mesh(earGeo, bodyMat);
    ear.position.set(0.15 * s, 0.27, 0);
    ear.rotation.z = -0.35 * s;
    g.add(ear);
    const eye = new THREE.Mesh(new THREE.SphereGeometry(0.055, 16, 12), new THREE.MeshStandardMaterial({ color: '#2b2350', roughness: 0.3 }));
    eye.position.set(0.1 * s, 0.05, 0.26);
    g.add(eye);
    const shine = new THREE.Mesh(new THREE.SphereGeometry(0.018, 8, 8), new THREE.MeshBasicMaterial({ color: '#ffffff' }));
    shine.position.set(0.1 * s + 0.018, 0.075, 0.31);
    g.add(shine);
    const cheek = new THREE.Mesh(new THREE.SphereGeometry(0.045, 12, 8), new THREE.MeshStandardMaterial({ color: '#ff8a80', roughness: 0.8 }));
    cheek.scale.set(1, 0.6, 0.4);
    cheek.position.set(0.19 * s, -0.04, 0.23);
    g.add(cheek);
  }
  const mouth = new THREE.Mesh(new THREE.TorusGeometry(0.04, 0.012, 8, 16, Math.PI), new THREE.MeshBasicMaterial({ color: '#2b2350' }));
  mouth.position.set(0, -0.05, 0.285);
  mouth.rotation.z = Math.PI;
  g.add(mouth);
  return g;
}

function makePadlock() {
  const lock = new THREE.Group();
  const gold = new THREE.MeshStandardMaterial({ color: '#ffca28', metalness: 0.7, roughness: 0.25 });
  const bodyM = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.18, 0.08), gold);
  const shackle = new THREE.Mesh(new THREE.TorusGeometry(0.07, 0.02, 8, 16, Math.PI), new THREE.MeshStandardMaterial({ color: '#b0a27a', metalness: 0.8, roughness: 0.3 }));
  shackle.position.y = 0.09;
  const hole = new THREE.Mesh(new THREE.CircleGeometry(0.025, 12), new THREE.MeshBasicMaterial({ color: '#5d4037' }));
  hole.position.z = 0.041;
  lock.add(bodyM, shackle, hole);
  return lock;
}

function makeCage() {
  const g = new THREE.Group();
  const mat = new THREE.MeshStandardMaterial({ color: '#c9a227', metalness: 0.7, roughness: 0.3, transparent: true });
  const h = 0.44;
  const bar = new THREE.CylinderGeometry(0.02, 0.02, h * 2, 8);
  for (let i = 0; i < 4; i++) {
    for (let k = -1; k <= 1; k++) {
      const b = new THREE.Mesh(bar, mat);
      const a = (i * Math.PI) / 2;
      const along = k * 0.22;
      b.position.set(Math.cos(a) * h - Math.sin(a) * along, 0, Math.sin(a) * h + Math.cos(a) * along);
      g.add(b);
    }
  }
  const ringGeo = new THREE.BoxGeometry(h * 2 + 0.06, 0.05, h * 2 + 0.06);
  for (const y of [-h, h]) {
    const r = new THREE.Mesh(ringGeo, mat);
    r.position.y = y;
    g.add(r);
  }
  g.userData.mat = mat;
  return g;
}

// ---- Sahne ----------------------------------------------------------------
export class GameScene {
  constructor(container, { onTap, arrowAt } = {}) {
    this.container = container;
    this.onTap = onTap;
    this.arrowAt = arrowAt;
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 3));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    container.appendChild(this.renderer.domElement);

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(40, 1, 0.1, 400);

    this.scene.add(new THREE.HemisphereLight('#ffffff', '#b8b0ff', 2.2));
    const sun = new THREE.DirectionalLight('#ffffff', 1.0);
    sun.position.set(4, 10, 7);
    this.scene.add(sun);

    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.1;
    this.controls.enablePan = false;
    this.controls.rotateSpeed = 0.85;
    this.controls.zoomSpeed = 1.1;
    this.controls.minPolarAngle = 0.02;
    this.controls.maxPolarAngle = Math.PI - 0.02;

    this.world = new THREE.Group();
    this.scene.add(this.world);
    this.tweens = [];
    this.arrows = new Map();
    this.raycaster = new THREE.Raycaster();
    this.clock = new THREE.Clock();

    this.bindPointer();
    this.ro = new ResizeObserver(() => this.resize());
    this.ro.observe(container);
    this.resize();
    this.renderer.setAnimationLoop(() => this.frame());
  }

  load(puzzle) {
    this.clear();
    this.puzzle = puzzle;
    const [W, H, D] = puzzle.dims;
    this.world.position.set(-W / 2, -H / 2, -D / 2);

    // Kutu (BoxGeometry yüz sırası +x,-x,+y,-y,+z,-z = DIRS sırası)
    const faceDims = [[D, H], [D, H], [W, D], [W, D], [W, H], [W, H]];
    const mats = faceDims.map(([c, r]) => new THREE.MeshStandardMaterial({
      map: faceTexture(c, r), roughness: 0.9, polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1,
    }));
    this.box = new THREE.Mesh(new THREE.BoxGeometry(W, H, D), mats);
    this.box.position.set(W / 2, H / 2, D / 2);
    this.world.add(this.box);
    const edges = new THREE.LineSegments(new THREE.EdgesGeometry(this.box.geometry), new THREE.LineBasicMaterial({ color: '#c8c0f0' }));
    edges.position.copy(this.box.position);
    this.world.add(edges);

    for (const a of puzzle.arrows) {
      const path = buildPath(puzzle.dims, a);
      const color = a.lock ? LOCK_COLOR : ARROW_COLOR;
      const mat = new THREE.MeshBasicMaterial({ color, side: THREE.DoubleSide, transparent: true });
      const mesh = new THREE.Mesh(new THREE.BufferGeometry(), mat);
      mesh.renderOrder = a.lock ? 2 : 1;
      const entry = { id: a.id, arrow: a, path, mesh, mat, color, shift: 0 };
      this.setShift(entry, 0);
      this.world.add(mesh);
      this.arrows.set(a.id, entry);
    }

    // Karakter
    this.character = makeCharacter();
    this.freed = false;
    this.charFlying = false;
    if (puzzle.goal === 'rescue' && puzzle.lock !== null) {
      // Kilit okunun kuyruğunda, asma kilitle yüzeye bağlı.
      const tail = puzzle.arrows[puzzle.lock].cells[0];
      const n = N[tail.f];
      const holder = new THREE.Group();
      holder.position.copy(v3(tail.c)).addScaledVector(n, 0.02);
      holder.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), n);
      this.character.scale.setScalar(0.85);
      this.character.position.y = 0.27;
      const lock = makePadlock();
      lock.position.set(0, 0.16, 0.27);
      lock.scale.setScalar(1.1);
      holder.add(this.character, lock);
      this.world.add(holder);
      this.holder = holder;
      this.padlock = lock;
      this.charMode = 'surface';
    } else {
      // Tüm okları temizle bölümleri: karakter kutunun üstünde bir kafeste.
      this.cage = makeCage();
      const p = new THREE.Vector3(W / 2, H + 0.75, D / 2);
      this.cage.position.copy(p);
      this.character.position.copy(p);
      this.world.add(this.cage, this.character);
      this.charHome = p.clone();
      this.charMode = 'cage';
    }

    const radius = Math.sqrt(W * W + H * H + D * D) / 2;
    this.radius = radius;
    // Kafes kutunun üstünde duruyorsa onu da kadraja al.
    const fit = radius + (this.charMode === 'cage' ? 0.9 : 0);
    // Dikey telefonda yatay görüş açısı dar: ikisinden küçüğüne göre sığdır.
    const vHalf = THREE.MathUtils.degToRad(this.camera.fov / 2);
    const hHalf = Math.atan(Math.tan(vHalf) * this.camera.aspect);
    this.baseDistance = (fit / Math.sin(Math.min(vHalf, hHalf))) * 0.8 + 0.5;
    this.controls.minDistance = Math.max(2, radius * 0.9);
    this.controls.maxDistance = radius * 6 + 6;
    this.controls.target.set(0, this.charMode === 'cage' ? 0.45 : 0, 0);
    this.camera.position.copy(this.homeDir()).multiplyScalar(this.baseDistance).add(this.controls.target);
    this.controls.update();
  }

  homeDir() { return new THREE.Vector3(0.75, 0.62, 1).normalize(); }

  clear() {
    this.tweens = [];
    for (const child of [...this.world.children]) this.world.remove(child);
    for (const extra of [this.character, this.padlock, this.particles?.pts]) if (extra?.parent === this.scene) this.scene.remove(extra);
    this.arrows.clear();
    this.particles = null;
    this.cage = null;
    this.holder = null;
    this.padlock = null;
  }

  setShift(entry, s) {
    entry.shift = s;
    const pos = ribbon(entry.path, s, s + entry.path.bodyLen);
    entry.mesh.geometry.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    entry.mesh.geometry.computeBoundingSphere();
  }

  // Yakınlaştır (>1) / uzaklaştır (<1)
  zoom(factor) {
    const off = this.camera.position.clone().sub(this.controls.target);
    const start = off.length();
    const len = THREE.MathUtils.clamp(start / factor, this.controls.minDistance, this.controls.maxDistance);
    this.tween(250, (t) => {
      const cur = this.camera.position.clone().sub(this.controls.target);
      cur.setLength(THREE.MathUtils.lerp(start, len, easeOutCubic(t)));
      this.camera.position.copy(this.controls.target).add(cur);
    });
  }

  resetView() {
    if (!this.puzzle) return;
    const to = this.homeDir().multiplyScalar(this.baseDistance).add(this.controls.target);
    const from = this.camera.position.clone();
    this.tween(450, (t) => this.camera.position.lerpVectors(from, to, easeOutCubic(t)));
  }

  bindPointer() {
    const el = this.renderer.domElement;
    let down = null;
    let multi = false;
    const pointers = new Set();
    el.addEventListener('pointerdown', (e) => {
      pointers.add(e.pointerId);
      if (pointers.size > 1) multi = true;
      if (pointers.size === 1) { multi = false; down = { x: e.clientX, y: e.clientY, t: performance.now() }; }
    });
    const up = (e) => {
      pointers.delete(e.pointerId);
      if (!down || multi) { if (!pointers.size) down = null; return; }
      const dx = e.clientX - down.x;
      const dy = e.clientY - down.y;
      const dt = performance.now() - down.t;
      down = null;
      if (e.type === 'pointerup' && dx * dx + dy * dy < 144 && dt < 450) this.handleTap(e.clientX, e.clientY);
    };
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', up);
  }

  // Dokunulan noktaya en yakın oku bul (ince çizgilere parmakla dokunmak kolay olsun diye toleranslı).
  pick(x, y) {
    if (!this.box) return null;
    const r = this.renderer.domElement.getBoundingClientRect();
    const ndc = new THREE.Vector2(((x - r.left) / r.width) * 2 - 1, -((y - r.top) / r.height) * 2 + 1);
    this.raycaster.setFromCamera(ndc, this.camera);
    const hit = this.raycaster.intersectObject(this.box, false)[0];
    if (!hit) return null;
    const p = this.world.worldToLocal(hit.point.clone());
    const nrm = hit.face.normal;
    const f = Math.abs(nrm.x) > 0.5 ? (nrm.x > 0 ? 0 : 1) : Math.abs(nrm.y) > 0.5 ? (nrm.y > 0 ? 2 : 3) : (nrm.z > 0 ? 4 : 5);
    const a = axisOf(f);
    const [b, c] = [0, 1, 2].filter((k) => k !== a);
    const dims = this.puzzle.dims;
    const pa = [p.x, p.y, p.z];
    const bi = Math.min(dims[b] - 1, Math.max(0, Math.floor(pa[b])));
    const ci = Math.min(dims[c] - 1, Math.max(0, Math.floor(pa[c])));
    let best = null;
    let bestD = 0.8;
    for (let di = -1; di <= 1; di++) {
      for (let dj = -1; dj <= 1; dj++) {
        const i = bi + di;
        const j = ci + dj;
        if (i < 0 || j < 0 || i >= dims[b] || j >= dims[c]) continue;
        const cc = [0, 0, 0];
        cc[a] = f % 2 === 0 ? dims[a] : 0;
        cc[b] = i + 0.5;
        cc[c] = j + 0.5;
        const id = this.arrowAt({ f, c: cc });
        if (id === null) continue;
        const d = Math.hypot(pa[b] - cc[b], pa[c] - cc[c]);
        if (d < bestD) { bestD = d; best = id; }
      }
    }
    return best;
  }

  handleTap(x, y) {
    if (!this.puzzle || !this.onTap) return;
    const id = this.pick(x, y);
    if (id !== null) this.onTap(id);
  }

  tween(duration, fn, done) {
    this.tweens.push({ start: performance.now(), duration, fn, done });
  }

  animateRemove(id) {
    const e = this.arrows.get(id);
    if (!e) return;
    const travel = e.path.bodyLen + e.path.exitDist + 4;
    const dur = Math.min(900, 300 + travel * 30);
    this.tween(dur, (t) => {
      this.setShift(e, easeInQuad(t) * travel);
      e.mat.opacity = t < 0.7 ? 1 : 1 - (t - 0.7) / 0.3;
    }, () => {
      this.world.remove(e.mesh);
      e.mesh.geometry.dispose();
      this.arrows.delete(id);
    });
  }

  animateBump(id, steps, hitId) {
    const e = this.arrows.get(id);
    if (!e) return;
    const travel = steps + 0.12;
    const t1 = 110 + steps * 55;
    this.tween(t1, (t) => this.setShift(e, easeInQuad(t) * travel), () => {
      this.flash(e, '#ff7675', 380);
      const other = this.arrows.get(hitId);
      if (other) this.flash(other, '#fdcb6e', 380);
      this.tween(220 + steps * 40, (t) => this.setShift(e, (1 - easeOutCubic(t)) * travel));
    });
  }

  flash(entry, color, ms) {
    entry.mat.color.set(color);
    clearTimeout(entry.flashTimer);
    entry.flashTimer = setTimeout(() => entry.mat.color.set(entry.color), ms);
  }

  hint(id) {
    const e = this.arrows.get(id);
    if (!e) return;
    let n = 0;
    const blink = () => {
      if (!this.arrows.has(id)) return;
      e.mat.color.set(n % 2 === 0 ? '#00cec9' : e.color);
      if (++n < 7) setTimeout(blink, 180);
    };
    blink();
  }

  // Okun ucunun ekrandaki konumu (öğretici el için). Uç kameradan görünmüyorsa null.
  screenPosOf(id) {
    const e = this.arrows.get(id);
    if (!e) return null;
    const head = headOf(e.arrow);
    const n = N[head.f]; // dünya grubu sadece ötelenmiş, dönmüyor
    const p = this.world.localToWorld(v3(head.c).addScaledVector(N[head.f], 0.05));
    if (n.dot(this.camera.position.clone().sub(p)) <= 0) return null;
    const v = p.clone().project(this.camera);
    if (Math.abs(v.x) > 0.92 || Math.abs(v.y) > 0.85 || v.z > 1) return null; // ekran dışında
    const r = this.renderer.domElement.getBoundingClientRect();
    return { x: r.left + ((v.x + 1) / 2) * r.width, y: r.top + ((1 - v.y) / 2) * r.height };
  }

  // Karakter kurtuldu!
  celebrate() {
    this.freed = true;
    const ch = this.character;
    if (this.charMode === 'surface') {
      const start = ch.getWorldPosition(new THREE.Vector3());
      const lockStart = this.padlock.getWorldPosition(new THREE.Vector3());
      const s0 = ch.getWorldScale(new THREE.Vector3()).x;
      this.holder.remove(ch, this.padlock);
      this.scene.add(ch, this.padlock);
      ch.position.copy(start);
      ch.scale.setScalar(s0);
      this.padlock.position.copy(lockStart);
      // Kameraya doğru zıplayıp kutunun önünde sevinsin.
      const toCam = this.camera.position.clone().sub(this.controls.target).normalize();
      const goal = toCam.clone().multiplyScalar(this.radius * 0.6 + 0.9);
      this.charHome = goal;
      const s1 = Math.max(1.1, this.radius * 0.35);
      this.charFlying = true;
      this.tween(800, (t) => {
        const e = easeOutCubic(t);
        ch.position.lerpVectors(start, goal, e);
        ch.position.y += Math.sin(t * Math.PI) * 1.2;
        ch.scale.setScalar(s0 + (s1 - s0) * easeOutBack(t));
        ch.lookAt(this.camera.position);
      }, () => { this.charFlying = false; });
      const lock = this.padlock;
      this.tween(700, (t) => {
        lock.position.y = lockStart.y - t * t * 4;
        lock.rotation.z = t * 4;
        lock.scale.setScalar(1.1 * (1 - t) + 0.001);
      }, () => { lock.visible = false; });
      this.charMode = 'free';
      this.spawnConfetti(goal, this.scene);
    } else {
      const cage = this.cage;
      this.tween(700, (t) => { cage.scale.setScalar(1 + t * 0.8); cage.userData.mat.opacity = 1 - t; }, () => { cage.visible = false; });
      const s = Math.max(1.4, this.radius * 0.3);
      this.tween(900, (t) => { ch.scale.setScalar(1 + easeOutBack(t) * (s - 1)); });
      this.charMode = 'free';
      this.spawnConfetti(this.charHome, this.world);
    }
  }

  spawnConfetti(at, parent) {
    const count = 180;
    const geo = new THREE.BufferGeometry();
    const pos = new Float32Array(count * 3);
    const col = new Float32Array(count * 3);
    const vel = [];
    const palette = ['#ff8a80', '#ffb74d', '#81c784', '#4fc3f7', '#ba68c8', '#ff2e63'].map((c) => new THREE.Color(c));
    for (let i = 0; i < count; i++) {
      pos.set([at.x, at.y, at.z], i * 3);
      const c = palette[i % palette.length];
      col.set([c.r, c.g, c.b], i * 3);
      vel.push(new THREE.Vector3((Math.random() - 0.5) * 7, Math.random() * 7 + 2, (Math.random() - 0.5) * 7));
    }
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    const pts = new THREE.Points(geo, new THREE.PointsMaterial({ size: 0.14 + this.radius * 0.02, vertexColors: true, transparent: true }));
    parent.add(pts);
    this.particles = { pts, vel, life: 0, parent };
  }

  frame() {
    const dt = Math.min(this.clock.getDelta(), 0.05);
    const now = performance.now();
    const t = this.clock.elapsedTime;
    for (let i = this.tweens.length - 1; i >= 0; i--) {
      const tw = this.tweens[i];
      const p = Math.min(1, (now - tw.start) / tw.duration);
      tw.fn(p);
      if (p >= 1) {
        this.tweens.splice(i, 1);
        tw.done?.();
      }
    }
    const ch = this.character;
    if (ch) {
      if (this.charMode === 'surface') {
        ch.position.y = 0.27 + Math.abs(Math.sin(t * 3)) * 0.07;
        ch.rotation.y = Math.sin(t * 1.3) * 0.5;
      } else if (this.charMode === 'cage') {
        ch.position.y = this.charHome.y + Math.sin(t * 2.4) * 0.04;
        ch.lookAt(this.camera.position);
      } else if (!this.charFlying) {
        ch.position.y = this.charHome.y + Math.abs(Math.sin(t * 5)) * 0.45;
        ch.lookAt(this.camera.position);
        ch.rotateZ(Math.sin(t * 10) * 0.25);
      }
    }
    if (this.particles) {
      const { pts, vel } = this.particles;
      const a = pts.geometry.attributes.position;
      this.particles.life += dt;
      for (let i = 0; i < vel.length; i++) {
        vel[i].y -= 9 * dt;
        a.setXYZ(i, a.getX(i) + vel[i].x * dt, a.getY(i) + vel[i].y * dt, a.getZ(i) + vel[i].z * dt);
      }
      a.needsUpdate = true;
      pts.material.opacity = Math.max(0, 1 - this.particles.life / 3);
      if (this.particles.life > 3) { this.particles.parent.remove(pts); this.particles = null; }
    }
    this.controls.update();
    this.renderer.render(this.scene, this.camera);
  }

  resize() {
    const w = this.container.clientWidth || 1;
    const h = this.container.clientHeight || 1;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }
}
