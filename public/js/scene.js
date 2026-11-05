// 3D sahne: blokları, okları, kafesteki karakteri çizer; döndürme / yakınlaştırma / dokunma.
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { DIRS } from './puzzle.js';

const DIR_COLORS = ['#ff8a80', '#ffb74d', '#81c784', '#4fc3f7', '#ba68c8', '#f06292'];
const DARK = '#2b2350';
const CELL = 1;
const GAP = 0.92;

// ---- Doku üretimi ---------------------------------------------------------
function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function shade(hex, amt) {
  const n = parseInt(hex.slice(1), 16);
  const c = [n >> 16, (n >> 8) & 255, n & 255].map((v) => Math.max(0, Math.min(255, Math.round(v + amt))));
  return `rgb(${c.join(',')})`;
}

// kind: 'right' | 'up' | 'left' | 'down' | 'out' (ok sana bakıyor) | 'in' (okun kuyruğu)
function makeFaceTexture(color, kind) {
  const S = 128;
  const cv = document.createElement('canvas');
  cv.width = cv.height = S;
  const ctx = cv.getContext('2d');
  ctx.fillStyle = shade(color, -35);
  ctx.fillRect(0, 0, S, S);
  roundRect(ctx, 6, 6, S - 12, S - 12, 22);
  const g = ctx.createLinearGradient(0, 0, 0, S);
  g.addColorStop(0, shade(color, 30));
  g.addColorStop(1, color);
  ctx.fillStyle = g;
  ctx.fill();

  ctx.fillStyle = DARK;
  ctx.strokeStyle = DARK;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  const m = S / 2;
  if (kind === 'out') {
    ctx.lineWidth = 9;
    ctx.beginPath(); ctx.arc(m, m, 30, 0, Math.PI * 2); ctx.stroke();
    ctx.beginPath(); ctx.arc(m, m, 11, 0, Math.PI * 2); ctx.fill();
  } else if (kind === 'in') {
    ctx.lineWidth = 9;
    ctx.globalAlpha = 0.45;
    ctx.beginPath(); ctx.arc(m, m, 30, 0, Math.PI * 2); ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(m - 17, m - 17); ctx.lineTo(m + 17, m + 17);
    ctx.moveTo(m + 17, m - 17); ctx.lineTo(m - 17, m + 17);
    ctx.stroke();
    ctx.globalAlpha = 1;
  } else {
    const angle = { right: 0, up: -Math.PI / 2, left: Math.PI, down: Math.PI / 2 }[kind];
    ctx.translate(m, m);
    ctx.rotate(angle);
    ctx.lineWidth = 14;
    ctx.beginPath(); ctx.moveTo(-36, 0); ctx.lineTo(14, 0); ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(42, 0); ctx.lineTo(8, -26); ctx.lineTo(8, 26); ctx.closePath();
    ctx.fill();
  }
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

// BoxGeometry'deki her yüzün (u, v) dünya eksenlerini çıkarır (yüz sırası: +x,-x,+y,-y,+z,-z).
function faceAxes(geo) {
  const pos = geo.attributes.position;
  const uv = geo.attributes.uv;
  const idx = geo.index;
  return geo.groups.map((g) => {
    const verts = new Map();
    for (let i = g.start; i < g.start + g.count; i++) {
      const vi = idx.getX(i);
      verts.set(`${Math.round(uv.getX(vi))},${Math.round(uv.getY(vi))}`,
        new THREE.Vector3(pos.getX(vi), pos.getY(vi), pos.getZ(vi)));
    }
    const o = verts.get('0,0');
    return {
      u: verts.get('1,0').clone().sub(o).normalize(),
      v: verts.get('0,1').clone().sub(o).normalize(),
    };
  });
}

const FACE_NORMALS = DIRS.map((d) => new THREE.Vector3(...d));

function easeInCubic(t) { return t * t * t; }
function easeOutCubic(t) { return 1 - Math.pow(1 - t, 3); }
function easeOutBack(t) { const c = 1.7; return 1 + (c + 1) * Math.pow(t - 1, 3) + c * Math.pow(t - 1, 2); }

// ---- Karakter -------------------------------------------------------------
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

function makeCage() {
  const g = new THREE.Group();
  const mat = new THREE.MeshStandardMaterial({ color: '#c9a227', metalness: 0.7, roughness: 0.3 });
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
  // Asma kilit
  const lock = new THREE.Group();
  const lockBody = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.17, 0.07), new THREE.MeshStandardMaterial({ color: '#ffca28', metalness: 0.8, roughness: 0.25 }));
  const shackle = new THREE.Mesh(new THREE.TorusGeometry(0.065, 0.018, 8, 16, Math.PI), mat);
  shackle.position.y = 0.085;
  lock.add(lockBody, shackle);
  lock.position.set(0, -0.05, h + 0.05);
  g.add(lock);
  g.userData.lock = lock;
  return g;
}

// ---- Sahne ----------------------------------------------------------------
export class GameScene {
  constructor(container, { onTap } = {}) {
    this.container = container;
    this.onTap = onTap;
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    container.appendChild(this.renderer.domElement);

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(45, 1, 0.1, 200);
    this.camera.position.set(6, 5, 8);

    this.scene.add(new THREE.HemisphereLight('#ffffff', '#8c7ae6', 1.6));
    const sun = new THREE.DirectionalLight('#ffffff', 1.6);
    sun.position.set(5, 10, 7);
    this.scene.add(sun);
    const fill = new THREE.DirectionalLight('#ffe0f0', 0.6);
    fill.position.set(-6, -3, -5);
    this.scene.add(fill);

    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.12;
    this.controls.enablePan = false;
    this.controls.rotateSpeed = 0.9;
    this.controls.zoomSpeed = 1.1;

    this.boxGeo = new THREE.BoxGeometry(GAP, GAP, GAP);
    this.axes = faceAxes(this.boxGeo);
    this.materials = new Map();
    this.root = new THREE.Group();
    this.scene.add(this.root);
    this.tweens = [];
    this.meshes = new Map();
    this.raycaster = new THREE.Raycaster();
    this.clock = new THREE.Clock();

    this.bindPointer();
    this.ro = new ResizeObserver(() => this.resize());
    this.ro.observe(container);
    this.resize();
    this.renderer.setAnimationLoop(() => this.frame());
  }

  material(dir, kind) {
    const k = `${dir}:${kind}`;
    if (!this.materials.has(k)) {
      this.materials.set(k, new THREE.MeshStandardMaterial({
        map: makeFaceTexture(DIR_COLORS[dir], kind), roughness: 0.55, metalness: 0.0,
      }));
    }
    return this.materials.get(k);
  }

  materialsFor(dir) {
    const d = FACE_NORMALS[dir];
    return this.axes.map((ax, face) => {
      const n = FACE_NORMALS[face];
      const dot = n.dot(d);
      if (dot > 0.5) return this.material(dir, 'out');
      if (dot < -0.5) return this.material(dir, 'in');
      const du = d.dot(ax.u);
      const dv = d.dot(ax.v);
      const kind = Math.abs(du) > Math.abs(dv) ? (du > 0 ? 'right' : 'left') : (dv > 0 ? 'up' : 'down');
      return this.material(dir, kind);
    });
  }

  load(puzzle) {
    this.clear();
    this.puzzle = puzzle;
    const d = puzzle.dims;
    this.offset = new THREE.Vector3((d[0] - 1) / 2, (d[1] - 1) / 2, (d[2] - 1) / 2);
    for (const b of puzzle.blocks) {
      const mesh = new THREE.Mesh(this.boxGeo, this.materialsFor(b.dir));
      mesh.position.copy(this.cellPos(b.pos));
      mesh.userData.id = b.id;
      mesh.userData.home = mesh.position.clone();
      mesh.userData.baseMat = mesh.material;
      this.root.add(mesh);
      this.meshes.set(b.id, mesh);
    }
    this.cage = makeCage();
    this.character = makeCharacter();
    const cp = this.cellPos(puzzle.cage);
    this.cage.position.copy(cp);
    this.character.position.copy(cp);
    this.characterHome = cp.clone();
    this.root.add(this.cage, this.character);
    this.freed = false;

    const radius = Math.sqrt(d[0] ** 2 + d[1] ** 2 + d[2] ** 2) / 2;
    this.baseDistance = radius * 2.9 + 2;
    this.controls.minDistance = radius * 1.3 + 0.8;
    this.controls.maxDistance = radius * 6 + 6;
    this.controls.target.set(0, 0, 0);
    this.camera.position.set(0.85, 0.6, 1).normalize().multiplyScalar(this.baseDistance);
    this.controls.update();
  }

  cellPos(p) {
    return new THREE.Vector3(p[0] * CELL, p[1] * CELL, p[2] * CELL).sub(this.offset);
  }

  clear() {
    this.tweens = [];
    for (const child of [...this.root.children]) this.root.remove(child);
    this.meshes.clear();
    this.particles = null;
  }

  // Yakınlaştır (>1) / uzaklaştır (<1)
  zoom(factor) {
    const off = this.camera.position.clone().sub(this.controls.target);
    const len = THREE.MathUtils.clamp(off.length() / factor, this.controls.minDistance, this.controls.maxDistance);
    off.setLength(len);
    this.tween(250, (t) => {
      const cur = this.camera.position.clone().sub(this.controls.target);
      cur.setLength(THREE.MathUtils.lerp(cur.length(), len, t));
      this.camera.position.copy(this.controls.target).add(cur);
    });
  }

  resetView() {
    if (!this.puzzle) return;
    const to = new THREE.Vector3(0.85, 0.6, 1).normalize().multiplyScalar(this.baseDistance);
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
      if (e.type === 'pointerup' && dx * dx + dy * dy < 100 && dt < 450) this.handleTap(e.clientX, e.clientY);
    };
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', up);
  }

  handleTap(x, y) {
    if (!this.puzzle || !this.onTap) return;
    const r = this.renderer.domElement.getBoundingClientRect();
    const ndc = new THREE.Vector2(((x - r.left) / r.width) * 2 - 1, -((y - r.top) / r.height) * 2 + 1);
    this.raycaster.setFromCamera(ndc, this.camera);
    const hits = this.raycaster.intersectObjects([...this.meshes.values()].filter((m) => !m.userData.leaving), false);
    if (hits.length) this.onTap(hits[0].object.userData.id);
  }

  tween(duration, fn, done) {
    this.tweens.push({ start: performance.now(), duration, fn, done });
  }

  animateRemove(id) {
    const mesh = this.meshes.get(id);
    if (!mesh) return;
    mesh.userData.leaving = true;
    const dir = FACE_NORMALS[this.puzzle.blocks[id].dir];
    const from = mesh.position.clone();
    const dist = 14;
    this.tween(520, (t) => {
      const e = easeInCubic(t);
      mesh.position.copy(from).addScaledVector(dir, e * dist);
      mesh.scale.setScalar(1 - e * 0.5);
    }, () => {
      this.root.remove(mesh);
      this.meshes.delete(id);
    });
  }

  animateBump(id, steps, hitId) {
    const mesh = this.meshes.get(id);
    if (!mesh) return;
    const dir = FACE_NORMALS[this.puzzle.blocks[id].dir];
    const home = mesh.userData.home;
    const travel = steps + (1 - GAP) / 2 + 0.06;
    const t1 = 120 + steps * 60;
    this.tween(t1, (t) => mesh.position.copy(home).addScaledVector(dir, easeInCubic(t) * travel), () => {
      const other = typeof hitId === 'number' ? this.meshes.get(hitId) : null;
      if (other) this.wiggle(other, dir);
      else if (hitId === 'cage') this.wiggle(this.cage, dir);
      this.flash(mesh);
      this.tween(260 + steps * 40, (t) => mesh.position.copy(home).addScaledVector(dir, (1 - easeOutCubic(t)) * travel));
    });
  }

  wiggle(obj, dir) {
    const base = obj.userData.home ? obj.userData.home.clone() : obj.position.clone();
    this.tween(260, (t) => {
      obj.position.copy(base).addScaledVector(dir, Math.sin(t * Math.PI * 3) * 0.08 * (1 - t));
    }, () => obj.position.copy(base));
  }

  flash(mesh) {
    this.flashColor(mesh, '#ff1744', 350);
  }

  hint(id) {
    const mesh = this.meshes.get(id);
    if (!mesh) return;
    const home = mesh.userData.home;
    const dir = FACE_NORMALS[this.puzzle.blocks[id].dir];
    this.flashColor(mesh, '#00e5ff', 1200);
    this.tween(900, (t) => mesh.position.copy(home).addScaledVector(dir, Math.sin(t * Math.PI * 4) * 0.12));
  }

  flashColor(mesh, color, ms) {
    const orig = mesh.userData.baseMat;
    const mats = orig.map((m) => { const c = m.clone(); c.emissive = new THREE.Color(color); c.emissiveIntensity = 0.7; return c; });
    mesh.material = mats;
    setTimeout(() => { if (mesh.material === mats) mesh.material = orig; mats.forEach((m) => m.dispose()); }, ms);
  }

  // Tüm oklar temizlendi: kafes açılır, karakter sevinir.
  celebrate() {
    this.freed = true;
    const cage = this.cage;
    const lock = cage.userData.lock;
    this.tween(400, (t) => { lock.position.y = -0.05 - t * 1.5; lock.rotation.z = t * 2; });
    this.tween(700, (t) => { cage.scale.setScalar(1 + t * 0.6); cage.children.forEach((c) => { if (c.material) { c.material.transparent = true; c.material.opacity = 1 - t; } }); }, () => { cage.visible = false; });
    const ch = this.character;
    const home = this.characterHome;
    this.tween(900, (t) => { ch.scale.setScalar(1 + easeOutBack(t) * 0.8); });
    this.spawnConfetti(home);
    // Kamerayı karaktere çevir
    const from = this.camera.position.clone();
    const to = new THREE.Vector3(0, 0.35, 1).normalize().multiplyScalar(Math.max(this.controls.minDistance, 6.5)).add(home);
    const tFrom = this.controls.target.clone();
    this.tween(900, (t) => {
      const e = easeOutCubic(t);
      this.camera.position.lerpVectors(from, to, e);
      this.controls.target.lerpVectors(tFrom, home, e);
    });
  }

  spawnConfetti(at) {
    const count = 160;
    const geo = new THREE.BufferGeometry();
    const pos = new Float32Array(count * 3);
    const col = new Float32Array(count * 3);
    const vel = [];
    const palette = DIR_COLORS.map((c) => new THREE.Color(c));
    for (let i = 0; i < count; i++) {
      pos.set([at.x, at.y, at.z], i * 3);
      const c = palette[i % palette.length];
      col.set([c.r, c.g, c.b], i * 3);
      vel.push(new THREE.Vector3((Math.random() - 0.5) * 6, Math.random() * 6 + 2, (Math.random() - 0.5) * 6));
    }
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    const pts = new THREE.Points(geo, new THREE.PointsMaterial({ size: 0.16, vertexColors: true, transparent: true }));
    this.root.add(pts);
    this.particles = { pts, vel, life: 0 };
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
    if (this.character) {
      const ch = this.character;
      if (this.freed) {
        ch.position.y = this.characterHome.y + Math.abs(Math.sin(t * 5)) * 0.5;
      } else {
        ch.position.y = this.characterHome.y + Math.sin(t * 2.4) * 0.04;
      }
      // Tatlı yüzü hep oyuncuya baksın, sevinçten iki yana sallansın.
      ch.lookAt(this.camera.position);
      ch.rotateZ(Math.sin(t * (this.freed ? 10 : 1.5)) * (this.freed ? 0.25 : 0.08));
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
      if (this.particles.life > 3) { this.root.remove(pts); this.particles = null; }
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
