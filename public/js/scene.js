// 3D sahne: kutuyu, yüzeyindeki kıvrımlı okları, kilitli karakteri çizer;
// döndürme / yakınlaştırma / dokunma ve okların kayma animasyonları.
import * as THREE from 'three';
import { DIRS, axisOf, rayCells, headOf } from './puzzle.js';

// Palet: porselen küp, mürekkep oklar, mercan/kehribar vurgular
const ARROW_COLOR = '#1f2a37';
const TRAP_COLOR = '#ff7a59';
const BUMP_COLOR = '#ff7a59';
const BLOCKER_COLOR = '#f4b860';
const HINT_COLOR = '#2fbf9b';
const LINE_W = 0.13;
const HEAD_W = 0.21;
const HEAD_L = 0.3;
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
  g.addColorStop(0, '#f6f7f9');
  g.addColorStop(1, '#e6eaef');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, cv.width, cv.height);
  ctx.fillStyle = 'rgba(31, 42, 55, 0.18)';
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
  const bodyMat = new THREE.MeshStandardMaterial({ color: '#ffc45c', roughness: 0.45 });
  const body = new THREE.Mesh(new THREE.SphereGeometry(0.3, 32, 24), bodyMat);
  body.scale.set(1, 0.92, 1);
  g.add(body);
  const earGeo = new THREE.ConeGeometry(0.09, 0.2, 16);
  for (const s of [-1, 1]) {
    const ear = new THREE.Mesh(earGeo, bodyMat);
    ear.position.set(0.15 * s, 0.27, 0);
    ear.rotation.z = -0.35 * s;
    g.add(ear);
    const eye = new THREE.Mesh(new THREE.SphereGeometry(0.055, 16, 12), new THREE.MeshStandardMaterial({ color: '#1f2a37', roughness: 0.3 }));
    eye.position.set(0.1 * s, 0.05, 0.26);
    g.add(eye);
    const shine = new THREE.Mesh(new THREE.SphereGeometry(0.018, 8, 8), new THREE.MeshBasicMaterial({ color: '#ffffff' }));
    shine.position.set(0.1 * s + 0.018, 0.075, 0.31);
    g.add(shine);
    const cheek = new THREE.Mesh(new THREE.SphereGeometry(0.045, 12, 8), new THREE.MeshStandardMaterial({ color: '#ff8f70', roughness: 0.8 }));
    cheek.scale.set(1, 0.6, 0.4);
    cheek.position.set(0.19 * s, -0.04, 0.23);
    g.add(cheek);
  }
  const mouth = new THREE.Mesh(new THREE.TorusGeometry(0.04, 0.012, 8, 16, Math.PI), new THREE.MeshBasicMaterial({ color: '#1f2a37' }));
  mouth.position.set(0, -0.05, 0.285);
  mouth.rotation.z = Math.PI;
  g.add(mouth);
  return g;
}

// Sıkıştığı için terleyen damla
function makeSweat() {
  const g = new THREE.Group();
  const mat = new THREE.MeshStandardMaterial({ color: '#8fd3ff', roughness: 0.1, metalness: 0.1, transparent: true, opacity: 0.9 });
  const drop = new THREE.Mesh(new THREE.SphereGeometry(0.05, 16, 12), mat);
  drop.scale.set(1, 1.3, 1);
  const tip = new THREE.Mesh(new THREE.ConeGeometry(0.035, 0.07, 12), mat);
  tip.position.y = 0.075;
  g.add(drop, tip);
  g.position.set(0.27, 0.2, 0.12);
  return g;
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
  // Üst ve alt: içi açık kare çerçeve (karakter yukarıdan da görünsün)
  const rail = new THREE.BoxGeometry(h * 2 + 0.06, 0.05, 0.05);
  for (const y of [-h, h]) {
    for (let i = 0; i < 4; i++) {
      const r = new THREE.Mesh(rail, mat);
      const a = (i * Math.PI) / 2;
      r.position.set(Math.sin(a) * h, y, Math.cos(a) * h);
      r.rotation.y = a;
      g.add(r);
    }
  }
  g.userData.mat = mat;
  return g;
}

// Karakterin hapsolduğu 3x3 alanı yüzeyde pembe kareyle işaretler.
function trapPatch(cells, centerKey, keyOf) {
  const pos = [];
  for (const cell of cells) {
    const n = N[cell.f];
    const a = axisOf(cell.f);
    const [b, c] = [0, 1, 2].filter((k) => k !== a);
    const ub = new THREE.Vector3(); ub.setComponent(b, 0.47);
    const uc = new THREE.Vector3(); uc.setComponent(c, 0.47);
    const o = v3(cell.c).addScaledVector(n, 0.004);
    const p1 = o.clone().sub(ub).sub(uc);
    const p2 = o.clone().add(ub).sub(uc);
    const p3 = o.clone().add(ub).add(uc);
    const p4 = o.clone().sub(ub).add(uc);
    pos.push(...p1.toArray(), ...p2.toArray(), ...p3.toArray(), ...p1.toArray(), ...p3.toArray(), ...p4.toArray());
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(pos), 3));
  return new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color: TRAP_COLOR, transparent: true, opacity: 0.28, side: THREE.DoubleSide, depthWrite: false }));
}

// ---- Sahne ----------------------------------------------------------------
// Kamera hep -z yönüne bakar; küp "pivot" grubuyla elle döndürülür (her yöne serbest),
// iki parmakla fotoğraf gibi büyütülür ve kaydırılır.
export class GameScene {
  constructor(container, { onTap, arrowAt, onDoubleTapEmpty } = {}) {
    this.container = container;
    this.onTap = onTap;
    this.arrowAt = arrowAt;
    this.onDoubleTapEmpty = onDoubleTapEmpty;
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 3));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    container.appendChild(this.renderer.domElement);

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(40, 1, 0.1, 400);
    this.dist = 10;
    this.minDist = 2;
    this.maxDist = 60;
    this.pan = new THREE.Vector2(0, 0);
    this.spin = { vx: 0, vy: 0 }; // bırakınca süzülerek dönmeye devam etsin

    this.scene.add(new THREE.HemisphereLight('#ffffff', '#9fb4c7', 2.1));
    const sun = new THREE.DirectionalLight('#ffffff', 1.0);
    sun.position.set(4, 10, 7);
    this.scene.add(sun);

    this.pivot = new THREE.Group();
    this.world = new THREE.Group();
    this.pivot.add(this.world);
    this.scene.add(this.pivot);
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
    this.resize(); // oyun ekranı yeni açıldıysa gerçek ekran oranını kullan
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
    const edges = new THREE.LineSegments(new THREE.EdgesGeometry(this.box.geometry), new THREE.LineBasicMaterial({ color: '#c3ccd6' }));
    edges.position.copy(this.box.position);
    this.world.add(edges);

    for (const a of puzzle.arrows) {
      const path = buildPath(puzzle.dims, a);
      const mat = new THREE.MeshBasicMaterial({ color: ARROW_COLOR, side: THREE.DoubleSide, transparent: true });
      const mesh = new THREE.Mesh(new THREE.BufferGeometry(), mat);
      mesh.renderOrder = 1;
      const entry = { id: a.id, arrow: a, path, mesh, mat, color: ARROW_COLOR, shift: 0 };
      this.setShift(entry, 0);
      this.world.add(mesh);
      this.arrows.set(a.id, entry);
    }

    // Karakter
    this.character = makeCharacter();
    this.freed = false;
    this.charFlying = false;
    if (puzzle.goal === 'rescue' && puzzle.character) {
      // En zor noktada, okların arasına sıkışmış (kafes yok).
      const cell = puzzle.character.cell;
      const n = N[cell.f];
      const holder = new THREE.Group();
      holder.position.copy(v3(cell.c)).addScaledVector(n, 0.01);
      // Yüzü yüzeyden dışarı baksın; "yukarısı" yan yüzlerde +y, üst/alt yüzlerde -z/+z olsun.
      const up = Math.abs(n.y) > 0.5 ? new THREE.Vector3(0, 0, -n.y) : new THREE.Vector3(0, 1, 0);
      const xAxis = new THREE.Vector3().crossVectors(up, n);
      holder.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(xAxis, up, n));
      this.character.scale.setScalar(1.0);
      this.character.position.z = 0.3;
      this.sweat = makeSweat();
      this.character.add(this.sweat);
      // Büyük küplerde de kolay bulunsun diye yüzeyde atan mercan halka
      this.halo = new THREE.Mesh(
        new THREE.RingGeometry(0.62, 0.78, 48),
        new THREE.MeshBasicMaterial({ color: TRAP_COLOR, transparent: true, opacity: 0.8, side: THREE.DoubleSide, depthWrite: false }),
      );
      this.halo.position.z = 0.02;
      holder.add(this.character, this.halo);
      this.world.add(holder);
      this.holder = holder;
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
    const fit = radius + (this.charMode === 'cage' ? 0.9 : 0);
    const vHalf = THREE.MathUtils.degToRad(this.camera.fov / 2);
    const hHalf = Math.atan(Math.tan(vHalf) * this.camera.aspect);
    this.baseDistance = (fit / Math.sin(Math.min(vHalf, hHalf))) * 1.0 + 0.3;
    // Yüzlere iyice yaklaşılabilsin ama kamera küpün içine girmesin
    this.minDist = (Math.max(W, H, D) / 2) * 1.35 + 1.2;
    this.maxDist = this.baseDistance * 2.5;
    this.homeQuat = new THREE.Quaternion().setFromEuler(new THREE.Euler(0.5, -0.65, 0, 'XYZ'));
    if (this.charMode === 'surface') {
      // Başlangıçta karakterin bulunduğu yüz hafif açılı olarak bize baksın.
      // Karakterin yüzünü 90°'lik bir dönüşle öne (+z) getir, sonra standart açıyı uygula.
      const f = puzzle.character.cell.f;
      const turn = [[0, 1, 0, -Math.PI / 2], [0, 1, 0, Math.PI / 2], [1, 0, 0, Math.PI / 2], [1, 0, 0, -Math.PI / 2], [0, 1, 0, 0], [0, 1, 0, Math.PI]][f];
      const r = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(turn[0], turn[1], turn[2]), turn[3]);
      this.homeQuat = new THREE.Quaternion().setFromEuler(new THREE.Euler(0.35, -0.5, 0, 'XYZ')).multiply(r);
    }
    this.pivot.quaternion.copy(this.homeQuat);
    this.dist = this.baseDistance;
    this.pan.set(0, this.charMode === 'cage' ? 0.45 : 0);
    this.spin.vx = this.spin.vy = 0;
    this.updateCamera();
  }

  clear() {
    this.tweens = [];
    for (const child of [...this.world.children]) this.world.remove(child);
    for (const extra of [this.character, this.particles?.pts]) if (extra?.parent === this.scene) this.scene.remove(extra);
    this.arrows.clear();
    this.particles = null;
    this.cage = null;
    this.holder = null;
    this.patch = null;
    this.halo = null;
  }

  setShift(entry, s) {
    entry.shift = s;
    const pos = ribbon(entry.path, s, s + entry.path.bodyLen);
    entry.mesh.geometry.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    entry.mesh.geometry.computeBoundingSphere();
  }

  // ---- Kamera ve dokunma kontrolleri ---------------------------------------
  updateCamera() {
    this.camera.position.set(this.pan.x, this.pan.y, this.dist);
    this.camera.lookAt(this.pan.x, this.pan.y, 0);
  }

  viewHalfHeight(dist = this.dist) {
    return Math.tan(THREE.MathUtils.degToRad(this.camera.fov / 2)) * dist;
  }

  rotateBy(dx, dy) {
    const k = Math.PI / Math.max(320, Math.min(this.container.clientWidth, this.container.clientHeight));
    const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), dx * k);
    q.multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), dy * k));
    this.pivot.quaternion.premultiply(q).normalize();
  }

  // Parmakların ortasındaki nokta yerinde kalacak şekilde büyüt (fotoğraf gibi).
  zoomAt(clientX, clientY, factor) {
    const r = this.renderer.domElement.getBoundingClientRect();
    const nx = ((clientX - r.left) / r.width) * 2 - 1;
    const ny = -(((clientY - r.top) / r.height) * 2 - 1);
    const h0 = this.viewHalfHeight();
    const px = this.pan.x + nx * h0 * this.camera.aspect;
    const py = this.pan.y + ny * h0;
    this.dist = THREE.MathUtils.clamp(this.dist / factor, this.minDist, this.maxDist);
    const h1 = this.viewHalfHeight();
    this.pan.set(px - nx * h1 * this.camera.aspect, py - ny * h1);
    this.clampPan();
  }

  panBy(dxPx, dyPx) {
    const wpp = (2 * this.viewHalfHeight()) / Math.max(1, this.container.clientHeight);
    this.pan.x -= dxPx * wpp;
    this.pan.y += dyPx * wpp;
    this.clampPan();
  }

  clampPan() {
    const lim = (this.radius || 3) * 1.2;
    this.pan.x = THREE.MathUtils.clamp(this.pan.x, -lim, lim);
    this.pan.y = THREE.MathUtils.clamp(this.pan.y, -lim, lim);
  }

  resetView() {
    if (!this.puzzle) return;
    const q0 = this.pivot.quaternion.clone();
    const d0 = this.dist;
    const p0 = this.pan.clone();
    const p1 = new THREE.Vector2(0, this.charMode === 'cage' ? 0.45 : 0);
    this.spin.vx = this.spin.vy = 0;
    this.tween(450, (t) => {
      const e = easeOutCubic(t);
      this.pivot.quaternion.slerpQuaternions(q0, this.homeQuat, e);
      this.dist = THREE.MathUtils.lerp(d0, this.baseDistance, e);
      this.pan.lerpVectors(p0, p1, e);
    });
  }

  bindPointer() {
    const el = this.renderer.domElement;
    const pts = new Map();
    let gesture = null; // tek parmak: döndür/dokun, iki parmak: büyüt/kaydır
    let lastTap = 0;
    const two = () => {
      const [a, b] = [...pts.values()];
      return { d: Math.hypot(a.x - b.x, a.y - b.y), mx: (a.x + b.x) / 2, my: (a.y + b.y) / 2 };
    };
    el.addEventListener('pointerdown', (e) => {
      el.setPointerCapture?.(e.pointerId);
      pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
      this.spin.vx = this.spin.vy = 0;
      if (pts.size === 1) {
        gesture = { kind: 'one', x0: e.clientX, y0: e.clientY, t0: performance.now(), moved: false, multi: false, lx: e.clientX, ly: e.clientY, lt: performance.now() };
      } else if (pts.size === 2 && gesture) {
        gesture.multi = true;
        gesture.pinch = two();
      }
    });
    el.addEventListener('pointermove', (e) => {
      if (!pts.has(e.pointerId) || !gesture) return;
      pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (pts.size >= 2 && gesture.pinch) {
        const now = two();
        if (gesture.pinch.d > 0 && now.d > 0) this.zoomAt(now.mx, now.my, now.d / gesture.pinch.d);
        this.panBy(now.mx - gesture.pinch.mx, now.my - gesture.pinch.my);
        gesture.pinch = now;
        return;
      }
      if (pts.size === 1 && !gesture.multi) {
        const dx = e.clientX - gesture.lx;
        const dy = e.clientY - gesture.ly;
        if (!gesture.moved && Math.hypot(e.clientX - gesture.x0, e.clientY - gesture.y0) > 8) gesture.moved = true;
        if (gesture.moved) {
          this.rotateBy(dx, dy);
          const now = performance.now();
          const dt = Math.max(1, now - gesture.lt);
          this.spin.vx = this.spin.vx * 0.5 + (dx / dt) * 0.5;
          this.spin.vy = this.spin.vy * 0.5 + (dy / dt) * 0.5;
          gesture.lt = now;
        }
        gesture.lx = e.clientX;
        gesture.ly = e.clientY;
      }
    });
    const end = (e) => {
      if (!pts.has(e.pointerId)) return;
      pts.delete(e.pointerId);
      if (!gesture) return;
      if (pts.size === 1) {
        // İki parmaktan birini kaldırınca kalan parmak zıplatmadan devam etsin.
        const [p] = [...pts.values()];
        gesture.pinch = null;
        gesture.lx = p.x; gesture.ly = p.y;
        return;
      }
      if (pts.size > 0) return;
      const g = gesture;
      gesture = null;
      const dt = performance.now() - g.t0;
      if (e.type === 'pointerup' && !g.multi && !g.moved && dt < 450) {
        const id = this.pick(e.clientX, e.clientY);
        const now = performance.now();
        if (id !== null) this.onTap?.(id);
        else if (now - lastTap < 350) this.resetView(); // boş yere çift dokun: görünümü sıfırla
        lastTap = id === null ? now : 0;
        this.spin.vx = this.spin.vy = 0;
      } else if (g.multi || performance.now() - g.lt > 80) {
        this.spin.vx = this.spin.vy = 0;
      }
    };
    el.addEventListener('pointerup', end);
    el.addEventListener('pointercancel', end);
    el.addEventListener('wheel', (e) => {
      e.preventDefault();
      this.zoomAt(e.clientX, e.clientY, Math.exp(-e.deltaY * 0.0015));
    }, { passive: false });
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
      this.flash(e, BUMP_COLOR, 380);
      const other = this.arrows.get(hitId);
      if (other) this.flash(other, BLOCKER_COLOR, 380);
      else if (hitId === 'character') this.flinch();
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
      e.mat.color.set(n % 2 === 0 ? HINT_COLOR : e.color);
      if (++n < 7) setTimeout(blink, 180);
    };
    blink();
  }

  // Okun ucunun ekrandaki konumu (öğretici el için). Uç görünmüyorsa ya da ekran dışındaysa null.
  screenPosOf(id) {
    const e = this.arrows.get(id);
    if (!e) return null;
    const head = headOf(e.arrow);
    const n = N[head.f].clone().applyQuaternion(this.pivot.quaternion);
    const p = this.world.localToWorld(v3(head.c).addScaledVector(N[head.f], 0.05));
    if (n.dot(this.camera.position.clone().sub(p)) <= 0) return null;
    const v = p.clone().project(this.camera);
    if (Math.abs(v.x) > 0.92 || Math.abs(v.y) > 0.85 || v.z > 1) return null;
    const r = this.renderer.domElement.getBoundingClientRect();
    return { x: r.left + ((v.x + 1) / 2) * r.width, y: r.top + ((1 - v.y) / 2) * r.height };
  }

  // Oklar karakterin önündeki yolu açtı: o yönde koşarak kenara gider, sonra sevinçle zıplar.
  rescue(dir) {
    if (this.charMode !== 'surface') { this.celebrate(); return; }
    this.charMode = 'running';
    if (this.sweat) this.sweat.visible = false;
    if (this.halo) this.halo.visible = false;
    const cell = this.puzzle.character.cell;
    const k = rayCells(this.puzzle.dims, cell, dir).length;
    const t = N[dir];
    const from = this.holder.position.clone();
    const dist = k + 0.75;
    const ch = this.character;
    // Koştuğu yöne baksın
    const dirLocal = t.clone().applyQuaternion(this.holder.quaternion.clone().invert());
    ch.rotation.set(0, 0, 0);
    ch.lookAt(this.holder.localToWorld(dirLocal.clone().multiplyScalar(3).add(ch.position)));
    const dur = 260 + dist * 120;
    this.tween(dur, (p) => {
      this.holder.position.copy(from).addScaledVector(t, p * dist);
      ch.position.z = 0.3 + Math.abs(Math.sin(p * dist * Math.PI)) * 0.25;
    }, () => { this.charMode = 'surface-done'; this.celebrate(); });
  }

  // Karakter isabet alınca irkilir.
  flinch() {
    this.flinchUntil = performance.now() + 450;
  }

  // Kurtardıktan sonra bütün okları da bitirince
  allCleared() {
    this.spawnConfetti(new THREE.Vector3(this.pan.x, this.pan.y, Math.min(this.radius * 0.7 + 1, this.dist * 0.45)), this.scene);
  }

  // Karakter kurtuldu!
  celebrate() {
    this.freed = true;
    const ch = this.character;
    const cage = this.cage;
    if (cage) {
      this.tween(700, (t) => { cage.scale.setScalar(1 + t * 0.8); cage.userData.mat.opacity = 1 - t; }, () => { cage.visible = false; });
    }
    if (this.patch) this.tween(600, (t) => { this.patch.material.opacity = 0.28 * (1 - t); });
    if (this.charMode === 'surface' || this.charMode === 'surface-done') {
      const start = ch.getWorldPosition(new THREE.Vector3());
      const s0 = ch.getWorldScale(new THREE.Vector3()).x;
      this.holder.remove(ch);
      this.scene.add(ch);
      ch.position.copy(start);
      ch.scale.setScalar(s0);
      // Küpten çıkıp ekrana doğru zıplasın ve kutunun önünde sevinsin.
      const goal = new THREE.Vector3(this.pan.x, this.pan.y, Math.min(this.radius * 0.7 + 1, this.dist * 0.45));
      this.charHome = goal;
      const s1 = Math.max(1.1, this.radius * 0.3);
      this.charFlying = true;
      this.tween(850, (t) => {
        const e = easeOutCubic(t);
        ch.position.lerpVectors(start, goal, e);
        ch.position.y += Math.sin(t * Math.PI) * 1.2;
        ch.scale.setScalar(s0 + (s1 - s0) * easeOutBack(t));
        ch.lookAt(this.camera.position);
      }, () => { this.charFlying = false; });
      this.charMode = 'free';
      this.spawnConfetti(goal, this.scene);
    } else {
      const s = Math.max(1.4, this.radius * 0.3);
      this.tween(900, (t) => { ch.scale.setScalar(1 + easeOutBack(t) * (s - 1)); });
      this.charMode = 'free-cage';
      this.spawnConfetti(this.charHome, this.world);
    }
  }

  spawnConfetti(at, parent) {
    const count = 180;
    const geo = new THREE.BufferGeometry();
    const pos = new Float32Array(count * 3);
    const col = new Float32Array(count * 3);
    const vel = [];
    const palette = ['#ff7a59', '#f4b860', '#2fbf9b', '#6cb4ee', '#ffc45c', '#f2f4f7'].map((c) => new THREE.Color(c));
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
    // Parmağı bırakınca süzülerek dönme
    if (Math.abs(this.spin.vx) + Math.abs(this.spin.vy) > 0.002) {
      const ms = dt * 1000;
      this.rotateBy(this.spin.vx * ms, this.spin.vy * ms);
      const decay = Math.pow(0.0025, dt);
      this.spin.vx *= decay;
      this.spin.vy *= decay;
    }
    const ch = this.character;
    if (ch) {
      if (this.charMode === 'surface') {
        // Okların arasında sıkışmış: biraz basık, titriyor, terliyor; yüzü hep oyuncuya dönük.
        const flinch = (this.flinchUntil || 0) > now;
        ch.position.z = 0.28;
        ch.position.x = Math.sin(t * (flinch ? 60 : 22)) * (flinch ? 0.05 : 0.012);
        ch.lookAt(this.camera.position);
        ch.rotateZ(Math.sin(t * 2.1) * 0.08);
        const sq = flinch ? 0.8 : 0.9 + Math.sin(t * 3) * 0.02;
        const base = 1.15;
        ch.scale.set(base * ((2 - sq) * 0.55 + 0.45), base * sq, base);
        if (this.halo) {
          const ph = (t * 0.9) % 1;
          // Uzaktayken halka büyür ki küçük karakter gözden kaçmasın
          const far = THREE.MathUtils.clamp(this.dist / 18, 1, 2.6);
          this.halo.scale.setScalar(far * (1 + ph * 0.9));
          this.halo.material.opacity = 0.85 * (1 - ph);
        }
        if (this.sweat) {
          const ph = (t * 0.8) % 1;
          this.sweat.position.y = 0.2 - ph * 0.25;
          this.sweat.children.forEach((m) => { m.material.opacity = ph < 0.8 ? 0.9 : (1 - ph) * 4.5; });
        }
      } else if (this.charMode === 'cage') {
        ch.position.y = this.charHome.y + Math.sin(t * 2.4) * 0.04;
        ch.lookAt(this.camera.position);
      } else if ((this.charMode === 'free' || this.charMode === 'free-cage') && !this.charFlying && this.charHome) {
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
    this.updateCamera();
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
