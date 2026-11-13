import * as THREE from 'three';
import { deserialize, type SavedModel } from '../core/persistence';
import { shownUnits, topology } from './topology';

/**
 * Cenas 3D do Sinapse (three.js), sempre com dados reais:
 * - a rede: um nó por neurônio, ligações com cor e brilho pelo peso, ondas de pulsos que
 *   percorrem a rede camada a camada com o brilho de cada neurônio igual à sua ativação;
 * - a superfície do erro: o MSE do treino variando dois pesos, com o caminho que eles fizeram.
 * Arrastar gira; a roda aproxima. Para quando sai da tela ou a aba fica escondida.
 */

const BG = new THREE.Color(0x121214);
const POS = new THREE.Color(0xf2f2f3);
const NEG = new THREE.Color(0x6e6e78);
const MAX_SHOWN = 24;

export function webglAvailable(): boolean {
  try {
    const c = document.createElement('canvas');
    return !!(c.getContext('webgl2') || c.getContext('webgl'));
  } catch {
    return false;
  }
}

const reduced = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

/** Base: renderizador, câmera, giro com o mouse, laço que dorme fora da tela. */
abstract class Stage {
  readonly el: HTMLDivElement;
  protected renderer: THREE.WebGLRenderer;
  protected scene = new THREE.Scene();
  protected camera = new THREE.PerspectiveCamera(36, 1, 0.1, 200);
  protected root = new THREE.Group();
  protected yaw = 0.42;
  protected pitch = 0.16;
  /** Balanço automático: oscila em volta da vista inicial, devagar. */
  protected sway = 0.2;
  protected dist = 14;
  protected target = new THREE.Vector3();
  /** Meia largura e meia altura do que precisa caber na tela; a câmera se afasta para caber. */
  protected fitBox: { w: number; h: number } | null = null;
  private userZoom = false;
  private dragging = false;
  private lastX = 0;
  private lastY = 0;
  private idleSince = performance.now();
  private raf = 0;
  private visible = true;
  private ro: ResizeObserver;
  private io: IntersectionObserver;
  private disposed = false;
  protected time = 0;
  private last = performance.now();

  constructor(label: string) {
    this.el = document.createElement('div');
    this.el.className = 'stage3d';
    this.el.setAttribute('role', 'img');
    this.el.setAttribute('aria-label', label);
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    this.el.appendChild(this.renderer.domElement);
    this.scene.add(this.root);
    this.scene.fog = new THREE.Fog(BG, 22, 48);
    this.scene.add(new THREE.AmbientLight(0xffffff, 1.6));
    const key = new THREE.DirectionalLight(0xffffff, 2.2);
    key.position.set(-4, 6, 8);
    this.scene.add(key);

    this.setupControls();

    this.ro = new ResizeObserver(() => this.resize());
    this.ro.observe(this.el);
    this.io = new IntersectionObserver(([en]) => {
      // enquanto ainda não está na página, não conta como "fora da tela"
      if (!en.isIntersecting && !this.el.isConnected) return;
      this.visible = en.isIntersecting;
      if (this.visible) this.loop();
    });
    this.io.observe(this.el);
    document.addEventListener('visibilitychange', this.onVis);
    // dá a partida sozinha (o observador só pausa quando a cena sai da tela)
    requestAnimationFrame(() => this.loop());
  }

  /**
   * Câmera livre: arrastar gira; botão direito, Shift ou dois dedos movem; roda ou pinça
   * aproximam; duplo clique volta ao início. Teclado: setas giram, + e − aproximam, 0 centraliza.
   */
  protected home = { yaw: 0, pitch: 0, target: new THREE.Vector3() };
  private pointers = new Map<number, { x: number; y: number }>();
  private mode: 'girar' | 'mover' = 'girar';

  private setupControls(): void {
    const c = this.renderer.domElement;
    c.tabIndex = 0;
    c.setAttribute('aria-label', 'Cena 3D: arraste para girar, botão direito ou Shift para mover, roda para aproximar');
    queueMicrotask(() => {
      this.home = { yaw: this.yaw, pitch: this.pitch, target: this.target.clone() };
    });
    c.addEventListener('contextmenu', (e) => e.preventDefault());
    c.addEventListener('pointerdown', (e) => {
      c.setPointerCapture(e.pointerId);
      this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      this.dragging = true;
      this.mode = e.button === 2 || e.shiftKey || this.pointers.size > 1 ? 'mover' : 'girar';
      this.lastX = e.clientX;
      this.lastY = e.clientY;
      this.el.classList.add('grabbing');
    });
    c.addEventListener('pointermove', (e) => {
      if (!this.pointers.has(e.pointerId)) return;
      const prev = this.pointers.get(e.pointerId)!;
      if (this.pointers.size === 2) {
        // pinça: a distância entre os dedos aproxima; o meio move
        const [a, b] = [...this.pointers.values()];
        const before = Math.hypot(a.x - b.x, a.y - b.y);
        this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
        const [a2, b2] = [...this.pointers.values()];
        const after = Math.hypot(a2.x - b2.x, a2.y - b2.y);
        if (before > 0 && after > 0) this.zoomBy(before / after);
        this.pan((e.clientX - prev.x) / 2, (e.clientY - prev.y) / 2);
      } else {
        this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
        const dx = e.clientX - this.lastX;
        const dy = e.clientY - this.lastY;
        if (this.mode === 'mover') this.pan(dx, dy);
        else this.rotate(dx, dy);
        this.lastX = e.clientX;
        this.lastY = e.clientY;
      }
      this.idleSince = performance.now();
    });
    const up = (e: PointerEvent) => {
      this.pointers.delete(e.pointerId);
      if (this.pointers.size === 0) {
        this.dragging = false;
        this.el.classList.remove('grabbing');
      }
      this.idleSince = performance.now();
    };
    let downAt = { x: 0, y: 0 };
    c.addEventListener('pointerdown', (e) => (downAt = { x: e.clientX, y: e.clientY }));
    c.addEventListener('click', (e) => {
      if (Math.hypot(e.clientX - downAt.x, e.clientY - downAt.y) > 5) return; // foi arrasto, não clique
      const r = c.getBoundingClientRect();
      this.clicked(((e.clientX - r.left) / r.width) * 2 - 1, -(((e.clientY - r.top) / r.height) * 2 - 1));
    });
    c.addEventListener('pointerup', up);
    c.addEventListener('pointercancel', up);
    c.addEventListener(
      'wheel',
      (e) => {
        e.preventDefault();
        this.zoomBy(1 + Math.sign(e.deltaY) * 0.08);
        this.idleSince = performance.now();
      },
      { passive: false },
    );
    c.addEventListener('dblclick', () => this.resetView());
    c.addEventListener('keydown', (e) => {
      const k = e.key;
      if (k === 'ArrowLeft') this.rotate(-24, 0);
      else if (k === 'ArrowRight') this.rotate(24, 0);
      else if (k === 'ArrowUp') this.rotate(0, -24);
      else if (k === 'ArrowDown') this.rotate(0, 24);
      else if (k === '+' || k === '=') this.zoomBy(0.88);
      else if (k === '-') this.zoomBy(1.14);
      else if (k === '0') this.resetView();
      else return;
      e.preventDefault();
      this.idleSince = performance.now();
      this.render();
    });

    // botões na própria cena
    const btn = (label: string, text: string, fn: () => void) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'cam-btn';
      b.setAttribute('aria-label', label);
      b.title = label;
      b.textContent = text;
      b.addEventListener('click', () => {
        fn();
        this.idleSince = performance.now();
        this.render();
      });
      return b;
    };
    const bar = document.createElement('div');
    bar.className = 'cam-bar';
    bar.append(btn('Aproximar', '+', () => this.zoomBy(0.85)), btn('Afastar', '−', () => this.zoomBy(1.18)), btn('Voltar à vista inicial', '⟲', () => this.resetView()));
    this.el.appendChild(bar);
  }

  private rotate(dx: number, dy: number): void {
    this.yaw -= dx * 0.006;
    this.pitch = Math.max(-1.35, Math.min(1.35, this.pitch + dy * 0.005));
  }

  /** Move o ponto que a câmera olha, no plano da tela. */
  private pan(dx: number, dy: number): void {
    const k = this.dist * 0.0016;
    const right = new THREE.Vector3(Math.cos(this.yaw), 0, -Math.sin(this.yaw));
    const up = new THREE.Vector3(-Math.sin(this.pitch) * Math.sin(this.yaw), Math.cos(this.pitch), -Math.sin(this.pitch) * Math.cos(this.yaw));
    this.target.addScaledVector(right, -dx * k).addScaledVector(up, dy * k);
  }

  private zoomBy(f: number): void {
    this.userZoom = true;
    this.dist = Math.max(3, Math.min(80, this.dist * f));
  }

  resetView(): void {
    this.yaw = this.home.yaw;
    this.pitch = this.home.pitch;
    this.target.copy(this.home.target);
    this.userZoom = false;
    this.fit();
  }

  /** Coordenadas do clique em [-1, 1], para o filho achar o que foi clicado. */
  protected clicked(_x: number, _y: number): void {}

  private onVis = () => {
    if (!document.hidden) this.loop();
  };

  private resize(): void {
    const w = this.el.clientWidth || 1;
    const h = this.el.clientHeight || 1;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.fit();
    this.render();
  }

  protected fit(): void {
    if (!this.fitBox || this.userZoom) return;
    const v = THREE.MathUtils.degToRad(this.camera.fov) / 2;
    const hz = Math.atan(Math.tan(v) * this.camera.aspect);
    this.dist = Math.max(this.fitBox.w / Math.tan(hz), this.fitBox.h / Math.tan(v)) * 1.02 + 0.6;
  }

  protected abstract tick(dt: number): void;

  private createdAt = performance.now();
  /** Depois que a pessoa mexe na câmera, a cena para de girar sozinha. */
  private touched(): boolean {
    return this.userZoom || this.idleSince > this.createdAt + 50;
  }

  private loop = () => {
    cancelAnimationFrame(this.raf);
    if (this.disposed || !this.visible || document.hidden) return;
    this.raf = requestAnimationFrame((now) => {
      const dt = Math.min(0.05, (now - this.last) / 1000) * (reduced() ? 0.35 : 1);
      this.last = now;
      this.time += dt;
      // balanço leve só enquanto ninguém mexeu na câmera
      if (!this.dragging && !this.touched() && this.sway > 0) this.yaw = this.home.yaw + Math.sin(this.time * 0.22) * this.sway;
      this.tick(dt);
      this.render();
      this.loop();
    });
  };

  protected render(): void {
    const cp = Math.cos(this.pitch);
    this.camera.position.set(
      this.target.x + Math.sin(this.yaw) * cp * this.dist,
      this.target.y + Math.sin(this.pitch) * this.dist,
      this.target.z + Math.cos(this.yaw) * cp * this.dist,
    );
    this.camera.lookAt(this.target);
    this.renderer.render(this.scene, this.camera);
  }

  dispose(): void {
    this.disposed = true;
    cancelAnimationFrame(this.raf);
    this.ro.disconnect();
    this.io.disconnect();
    document.removeEventListener('visibilitychange', this.onVis);
    this.scene.traverse((o) => {
      const m = o as THREE.Mesh;
      m.geometry?.dispose?.();
      const mat = m.material as THREE.Material | THREE.Material[] | undefined;
      if (Array.isArray(mat)) mat.forEach((x) => x.dispose());
      else mat?.dispose?.();
    });
    this.renderer.dispose();
    this.el.remove();
  }
}

interface Edge {
  layer: number; // camada de destino (0 = primeira camada com pesos)
  i: number; // neurônio de destino
  j: number; // entrada (neurônio da camada anterior)
  p: number; // posição do peso dentro do neurônio (difere de j quando o bloco escolhe as origens)
  a: THREE.Vector3;
  b: THREE.Vector3;
}

interface Pulse {
  edge: Edge;
  t: number;
  delay: number;
  strength: number;
  /** true = o erro voltando (retropropagação), da camada da frente para a de trás. */
  back?: boolean;
}

/** Um ciclo de aprendizado de um exemplo: ativações (ida) e deltas (volta). */
export interface Cycle {
  /** acts[l][k]: saída do neurônio k da camada l (camada 0 = entradas). */
  acts: number[][];
  /** deltas[l][i]: δ do neurônio i da camada l+1 (só camadas com pesos). */
  deltas?: number[][];
}

/** A rede em 3D. */
export class Net3D extends Stage {
  private sizes: number[] = [];
  private shown: number[] = [];
  private nodePos: THREE.Vector3[][] = [];
  private nodes!: THREE.InstancedMesh;
  private halos!: THREE.InstancedMesh;
  private pulseGlow!: THREE.InstancedMesh;
  private backMesh!: THREE.InstancedMesh;
  /** Brilho extra das ligações quando os pesos acabam de ser atualizados. */
  private flash = 0;
  private flashAt = -1;
  private nodeIndex: number[][] = [];
  /** Chamado quando a pessoa clica num neurônio: camada (0 = entradas) e índice. */
  onPick: ((layer: number, unit: number) => void) | null = null;
  private raycaster = new THREE.Raycaster();
  private edges: Edge[] = [];
  private lines!: THREE.LineSegments;
  private lineColors!: Float32Array;
  private pulses: Pulse[] = [];
  private pulseMesh!: THREE.InstancedMesh;
  private model: SavedModel | null = null;
  /** Ativação mostrada em cada nó (0..1) e o alvo para onde ela anda. */
  private glow: number[][] = [];
  private glowTarget: number[][] = [];
  private wave: { start: number; acts: number[][] } | null = null;
  private dummy = new THREE.Object3D();
  private tmpColor = new THREE.Color();

  constructor(model: SavedModel) {
    super(`Rede neural em 3D com ${model.entradas} entradas e ${model.camadas.length} camadas`);
    this.build(model);
    this.setWeights(model);
  }

  private build(model: SavedModel): void {
    const topo = topology(deserialize(model).net.architecture);
    this.sizes = topo.sizes;
    const units = shownUnits(topo, MAX_SHOWN);
    this.shown = units.map((u) => u.length);
    const gapX = 3.4;
    const cols = this.sizes.length;
    // cada bloco é uma grade no plano y-z; blocos da mesma camada ficam empilhados em y, com um vão
    this.nodePos = topo.blocks.map((blocks, l) => {
      const out: THREE.Vector3[] = [];
      const multi = blocks.length > 1;
      const dims = blocks.map((b) => {
        const n = Math.min(b.count, MAX_SHOWN);
        const perCol = multi ? 6 : 10;
        const side = Math.ceil(n / perCol);
        const rows = Math.ceil(n / side);
        const sp = Math.min(0.78, (multi ? 4.2 : 7) / Math.max(1, rows - 1));
        return { n, side, rows, sp, height: (rows - 1) * sp };
      });
      const BLOCK_GAP = 1.1;
      const totalH = dims.reduce((a, d) => a + d.height, 0) + (blocks.length - 1) * BLOCK_GAP;
      let y0 = totalH / 2;
      blocks.forEach((b, k) => {
        const d = dims[k];
        for (let u = 0; u < d.n; u++) {
          const c = u % d.side;
          const r = Math.floor(u / d.side);
          out[b.start + u] = new THREE.Vector3((l - (cols - 1) / 2) * gapX, y0 - r * d.sp, (c - (d.side - 1) / 2) * 0.9);
        }
        y0 -= d.height + BLOCK_GAP;
      });
      return out;
    });
    let count = 0;
    this.nodeIndex = this.nodePos.map((col) => {
      const idx: number[] = [];
      col.forEach((_, k) => (idx[k] = count++));
      return idx;
    });
    this.glow = this.sizes.map((n, l) => Array(n).fill(l === 0 ? 0.35 : 0.2));
    this.glowTarget = this.glow.map((g) => g.slice());

    // ligações (uma geometria só, cor por vértice): só as que existem
    this.edges = [];
    for (let l = 1; l < this.sizes.length; l++)
      for (const i of units[l]) {
        const src = topo.sources[l - 1][i];
        const n = src ? src.length : this.sizes[l - 1];
        for (let p = 0; p < n; p++) {
          const j = src ? src[p] : p;
          const a = this.nodePos[l - 1][j];
          if (!a) continue;
          this.edges.push({ layer: l - 1, i, j, p, a, b: this.nodePos[l][i] });
        }
      }
    const pos = new Float32Array(this.edges.length * 6);
    this.edges.forEach((e, k) => {
      pos.set([e.a.x, e.a.y, e.a.z, e.b.x, e.b.y, e.b.z], k * 6);
    });
    this.lineColors = new Float32Array(this.edges.length * 6);
    const lg = new THREE.BufferGeometry();
    lg.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    lg.setAttribute('color', new THREE.BufferAttribute(this.lineColors, 3));
    this.lines = new THREE.LineSegments(lg, new THREE.LineBasicMaterial({ vertexColors: true }));
    this.root.add(this.lines);

    // neurônios
    this.nodes = new THREE.InstancedMesh(
      new THREE.SphereGeometry(0.17, 32, 20),
      new THREE.MeshStandardMaterial({ roughness: 0.35, metalness: 0.1 }),
      count,
    );
    this.root.add(this.nodes);
    // halos somados à luz (preto = invisível): crescem com a ativação
    this.halos = new THREE.InstancedMesh(
      new THREE.SphereGeometry(0.34, 20, 12),
      new THREE.MeshBasicMaterial({ transparent: true, opacity: 0.5, blending: THREE.AdditiveBlending, depthWrite: false }),
      count,
    );
    this.root.add(this.halos);

    // pulsos
    this.pulseMesh = new THREE.InstancedMesh(
      new THREE.SphereGeometry(0.06, 12, 8),
      new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 1, blending: THREE.AdditiveBlending, depthWrite: false }),
      600,
    );
    this.pulseMesh.count = 0;
    this.root.add(this.pulseMesh);
    this.pulseGlow = new THREE.InstancedMesh(
      new THREE.SphereGeometry(0.15, 12, 8),
      new THREE.MeshBasicMaterial({ color: 0x232327, transparent: true, opacity: 1, blending: THREE.AdditiveBlending, depthWrite: false }),
      600,
    );
    this.pulseGlow.count = 0;
    this.root.add(this.pulseGlow);
    // erro voltando: pulsos menores e mais escuros
    this.backMesh = new THREE.InstancedMesh(
      new THREE.OctahedronGeometry(0.07, 0),
      new THREE.MeshBasicMaterial({ color: 0x8c8c96, transparent: true, opacity: 1, blending: THREE.AdditiveBlending, depthWrite: false }),
      600,
    );
    this.backMesh.count = 0;
    this.root.add(this.backMesh);

    const span = (cols - 1) * gapX;
    const all = this.nodePos.flat();
    const tall = Math.max(...all.map((p) => Math.abs(p.y)), 1);
    const deep = Math.max(...all.map((p) => Math.abs(p.z)), 0);
    this.fitBox = { w: Math.max(span / 2, deep) + 0.8, h: tall + 0.9 };
    this.fit();
    this.updateNodes();
    this.buildLabels(topo, cols, gapX);
  }

  /** Pesos novos: cor e brilho de cada ligação. */
  setWeights(model: SavedModel): void {
    this.model = model;
    const maxPer = model.camadas.map((c) => Math.max(1e-9, ...c.pesos.flat().map(Math.abs)));
    this.edges.forEach((e, k) => {
      const w = model.camadas[e.layer]?.pesos[e.i]?.[e.p] ?? 0;
      const a = Math.pow(Math.abs(w) / maxPer[e.layer], 1.4);
      this.tmpColor.copy(w >= 0 ? POS : NEG);
      this.tmpColor.lerpColors(BG, this.tmpColor, 0.025 + Math.pow(a, 1.6) * 0.9);
      this.lineColors.set([this.tmpColor.r, this.tmpColor.g, this.tmpColor.b, this.tmpColor.r, this.tmpColor.g, this.tmpColor.b], k * 6);
    });
    (this.lines.geometry.getAttribute('color') as THREE.BufferAttribute).needsUpdate = true;
  }

  /**
   * Um exemplo passando pela rede: `acts[l][k]` = saída do neurônio k da camada l
   * (camada 0 = entradas). Dispara pulsos camada a camada e acende os nós.
   */
  wavePass(acts: number[][], strong = false): void {
    // brilho = |ativação|; só divide quando a camada passa de 1 (ReLU, linear, entradas grandes)
    const norm = acts.map((layer) => {
      const m = Math.max(1, ...layer.map(Math.abs));
      return layer.map((v) => Math.min(1, Math.abs(v) / m));
    });
    this.wave = { start: this.time, acts: norm };
    if (!this.model) return;
    const hop = strong ? 0.42 : 0.3;
    const maxPer = this.model.camadas.map((c) => Math.max(1e-9, ...c.pesos.flat().map(Math.abs)));
    // escolhe as ligações mais fortes de cada camada (peso × ativação de quem envia)
    const budget = strong ? 260 : 80;
    const perLayer = Math.max(4, Math.floor(budget / Math.max(1, this.shown.length - 1)));
    for (let l = 0; l < this.shown.length - 1; l++) {
      const cands = this.edges
        .filter((e) => e.layer === l)
        .map((e) => {
          const w = Math.abs(this.model!.camadas[l].pesos[e.i]?.[e.p] ?? 0) / maxPer[l];
          return { e, s: w * (0.25 + (norm[l]?.[e.j] ?? 0)) };
        })
        .sort((x, y) => y.s - x.s)
        .slice(0, perLayer);
      for (const { e, s } of cands) {
        if (this.pulses.length >= 1100) break;
        this.pulses.push({ edge: e, t: 0, delay: l * hop + Math.random() * 0.06, strength: Math.min(1, 0.35 + s) });
      }
    }
  }

  /**
   * O ciclo inteiro de um exemplo: a ida acende a rede camada a camada; se vierem os deltas,
   * o erro volta da saída para a entrada; no fim as ligações piscam (os pesos foram atualizados).
   */
  cycle(c: Cycle, strong = false, flash = true): void {
    this.wavePass(c.acts, strong);
    if (!c.deltas || !this.model) return;
    const hop = strong ? 0.42 : 0.3;
    const L = this.shown.length - 1; // camadas com pesos
    const forwardTime = L * hop + 0.35;
    const maxD = c.deltas.map((d) => Math.max(1e-12, ...d.map(Math.abs)));
    const budget = strong ? 200 : 70;
    const perLayer = Math.max(4, Math.floor(budget / Math.max(1, L)));
    for (let l = L - 1; l >= 0; l--) {
      const step = L - 1 - l; // a última camada volta primeiro
      const w = this.model.camadas[l];
      const cands = this.edges
        .filter((e) => e.layer === l)
        .map((e) => ({ e, s: (Math.abs(c.deltas![l]?.[e.i] ?? 0) / maxD[l]) * Math.abs(w.pesos[e.i]?.[e.p] ?? 0) }))
        .sort((x, y) => y.s - x.s)
        .slice(0, perLayer);
      const top = Math.max(1e-12, cands[0]?.s ?? 1);
      for (const { e, s } of cands) {
        if (this.pulses.length >= 1100) break;
        this.pulses.push({ edge: e, t: 0, delay: forwardTime + step * hop + Math.random() * 0.06, strength: Math.min(1, 0.25 + s / top), back: true });
      }
    }
    if (flash) this.flashAt = this.time + forwardTime + L * hop + 0.2;
  }

  protected clicked(x: number, y: number): void {
    if (!this.onPick) return;
    this.raycaster.setFromCamera(new THREE.Vector2(x, y), this.camera);
    const hit = this.raycaster.intersectObject(this.nodes, false)[0];
    if (hit?.instanceId === undefined) return;
    for (let l = 0; l < this.nodeIndex.length; l++) {
      const k = this.nodeIndex[l].indexOf(hit.instanceId);
      if (k >= 0) {
        this.highlight(l, k);
        this.onPick(l, k);
        return;
      }
    }
  }

  private ring: THREE.Mesh | null = null;
  /** Anel em volta do neurônio escolhido. */
  highlight(l: number, k: number): void {
    const p = this.nodePos[l]?.[k];
    if (!p) return;
    if (!this.ring) {
      this.ring = new THREE.Mesh(new THREE.TorusGeometry(0.32, 0.025, 8, 40), new THREE.MeshBasicMaterial({ color: 0xffffff }));
      this.root.add(this.ring);
    }
    this.ring.position.copy(p);
  }

  /** Rótulos de cada camada (e letra de cada bloco), presos à cena e reprojetados a cada quadro. */
  private labels: { el: HTMLElement; at: THREE.Vector3 }[] = [];
  private buildLabels(topo: ReturnType<typeof topology>, cols: number, gapX: number): void {
    const box = document.createElement('div');
    box.className = 'labels3d';
    this.el.appendChild(box);
    const NAMES: Record<string, string> = { entrada: 'Entrada', linear: 'Linear', sigmoid: 'Sigmoid', tanh: 'Tanh', relu: 'ReLU' };
    topo.blocks.forEach((blocks, l) => {
      const ys = this.nodePos[l].filter(Boolean).map((p) => p.y);
      const x = (l - (cols - 1) / 2) * gapX;
      const name = document.createElement('span');
      name.className = 'l3d-layer';
      const acts = [...new Set(blocks.map((b) => NAMES[b.activation] ?? b.activation))].join(' · ');
      const total = blocks.reduce((s, b) => s + b.count, 0);
      name.textContent = `${l === 0 ? 'Entrada' : l === cols - 1 ? 'Saída' : `Oculta ${l}`} · ${total}`;
      const sub = document.createElement('small');
      sub.textContent = l === 0 ? '' : acts;
      name.appendChild(sub);
      box.appendChild(name);
      this.labels.push({ el: name, at: new THREE.Vector3(x, Math.min(...ys) - 0.75, 0) });
      if (blocks.length > 1)
        blocks.forEach((b, k) => {
          const first = this.nodePos[l][b.start];
          if (!first) return;
          const tag = document.createElement('span');
          tag.className = 'l3d-block';
          tag.textContent = 'ABCDEFGHIJKLMNOP'[k];
          box.appendChild(tag);
          this.labels.push({ el: tag, at: new THREE.Vector3(x, first.y + 0.5, 0) });
        });
    });
  }

  private placeLabels(): void {
    const w = this.el.clientWidth;
    const h = this.el.clientHeight;
    const v = new THREE.Vector3();
    for (const { el, at } of this.labels) {
      v.copy(at).applyMatrix4(this.root.matrixWorld).project(this.camera);
      const hidden = v.z > 1 || v.x < -1.2 || v.x > 1.2 || v.y < -1.2 || v.y > 1.2;
      el.style.visibility = hidden ? 'hidden' : 'visible';
      el.style.transform = `translate(${((v.x + 1) / 2) * w}px, ${((1 - v.y) / 2) * h}px) translate(-50%, -50%)`;
    }
  }

  protected tick(dt: number): void {
    this.placeLabels();
    if (this.ring) this.ring.quaternion.copy(this.camera.quaternion);
    // pisca as ligações quando o erro termina de voltar (pesos atualizados)
    if (this.flashAt >= 0 && this.time >= this.flashAt) {
      this.flash = 1;
      this.flashAt = -1;
    }
    this.flash = Math.max(0, this.flash - dt * 2.2);
    (this.lines.material as THREE.LineBasicMaterial).color.setScalar(1 + this.flash * 1.6);
    // acende cada camada quando a onda chega nela
    if (this.wave) {
      const el = this.time - this.wave.start;
      const hop = 0.32;
      this.wave.acts.forEach((layer, l) => {
        if (el >= l * hop) layer.forEach((v, k) => this.nodePos[l]?.[k] && (this.glowTarget[l][k] = v));
      });
      if (el > this.wave.acts.length * hop + 1.5) this.wave = null;
    }
    for (let l = 0; l < this.glow.length; l++)
      for (let k = 0; k < this.glow[l].length; k++) this.glow[l][k] += (this.glowTarget[l][k] - this.glow[l][k]) * Math.min(1, dt * 6);
    this.updateNodes();

    // pulsos andando pelas ligações
    let n = 0;
    let nb = 0;
    const speed = 3.2;
    this.pulses = this.pulses.filter((p) => {
      if (p.delay > 0) {
        p.delay -= dt;
        return true;
      }
      p.t += dt * speed;
      if (p.t >= 1) return false;
      if (p.back) {
        this.dummy.position.lerpVectors(p.edge.b, p.edge.a, p.t);
        this.dummy.rotation.set(this.time * 3, this.time * 2, 0);
        this.dummy.scale.setScalar((0.5 + p.strength * 0.9) * Math.sin(Math.PI * p.t) + 0.15);
        this.dummy.updateMatrix();
        this.dummy.rotation.set(0, 0, 0);
        if (nb < 600) this.backMesh.setMatrixAt(nb++, this.dummy.matrix);
        return true;
      }
      this.dummy.position.lerpVectors(p.edge.a, p.edge.b, p.t);
      this.dummy.scale.setScalar((0.6 + p.strength * 0.8) * Math.sin(Math.PI * p.t) + 0.2);
      this.dummy.updateMatrix();
      if (n < 600) {
        this.pulseMesh.setMatrixAt(n, this.dummy.matrix);
        this.pulseGlow.setMatrixAt(n++, this.dummy.matrix);
      }
      return true;
    });
    this.pulseMesh.count = n;
    this.pulseGlow.count = n;
    this.backMesh.count = nb;
    this.pulseMesh.instanceMatrix.needsUpdate = true;
    this.pulseGlow.instanceMatrix.needsUpdate = true;
    this.backMesh.instanceMatrix.needsUpdate = true;
  }

  private updateNodes(): void {
    this.nodePos.forEach((col, l) =>
      col.forEach((p, k) => {
        const g = this.glow[l][k];
        this.dummy.position.copy(p);
        this.dummy.scale.setScalar(0.85 + g * 0.35);
        this.dummy.updateMatrix();
        const idx = this.nodeIndex[l][k];
        this.nodes.setMatrixAt(idx, this.dummy.matrix);
        this.tmpColor.setScalar(0.05 + g * 0.75);
        this.nodes.setColorAt(idx, this.tmpColor);
        this.dummy.scale.setScalar(0.6 + g * 0.6);
        this.dummy.updateMatrix();
        this.halos.setMatrixAt(idx, this.dummy.matrix);
        this.tmpColor.setScalar(g * g * g * 0.09);
        this.halos.setColorAt(idx, this.tmpColor);
      }),
    );
    this.nodes.instanceMatrix.needsUpdate = true;
    if (this.nodes.instanceColor) this.nodes.instanceColor.needsUpdate = true;
    this.halos.instanceMatrix.needsUpdate = true;
    if (this.halos.instanceColor) this.halos.instanceColor.needsUpdate = true;
  }

  /** Quantos nós ficaram de fora em cada camada (para a legenda "+N"). */
  hiddenCounts(): number[] {
    return this.sizes.map((n, l) => n - this.shown[l]);
  }
}

export interface SurfaceData {
  /** z[r][c] = MSE do treino com w₁ = xs[c] e w₂ = ys[r]. */
  xs: number[];
  ys: number[];
  z: number[][];
  /** Por onde (w₁, w₂) passaram durante o treino. */
  path: [number, number][];
}

/** Superfície do erro em 3D com o caminho do treino por cima. */
export class Surface3D extends Stage {
  private mesh: THREE.Mesh | null = null;
  private wire: THREE.LineSegments | null = null;
  private pathLine: THREE.Line | null = null;
  private ball: THREE.Mesh;
  private zMin = 0;
  private zMax = 1;

  constructor() {
    super('Superfície do erro do treino variando dois pesos');
    this.ball = new THREE.Mesh(new THREE.SphereGeometry(0.16, 24, 16), new THREE.MeshBasicMaterial({ color: 0xffffff }));
    this.root.add(this.ball);
    this.ball.visible = false;
    this.pitch = 0.58;
    this.yaw = 0.75;
    this.fitBox = { w: 5.6, h: 3.4 };
    this.target.set(0, 1, 0);
    this.dots = new THREE.InstancedMesh(
      new THREE.SphereGeometry(0.05, 10, 8),
      new THREE.MeshBasicMaterial({ color: 0xf2f2f3 }),
      400,
    );
    this.dots.count = 0;
    this.root.add(this.dots);
    const glow = new THREE.Mesh(
      new THREE.SphereGeometry(0.42, 24, 16),
      new THREE.MeshBasicMaterial({ color: 0x55555c, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }),
    );
    this.ball.add(glow);
  }

  private dots: THREE.InstancedMesh;

  /** Tamanho da cena: x e z em [-4, 4], altura em [0, 3]. */
  private toScene(d: SurfaceData, w1: number, w2: number, z: number): THREE.Vector3 {
    const x0 = d.xs[0];
    const x1 = d.xs[d.xs.length - 1];
    const y0 = d.ys[0];
    const y1 = d.ys[d.ys.length - 1];
    const h = (Math.log10(z + 1e-9) - Math.log10(this.zMin + 1e-9)) / Math.max(1e-6, Math.log10(this.zMax + 1e-9) - Math.log10(this.zMin + 1e-9));
    return new THREE.Vector3(((w1 - x0) / (x1 - x0) - 0.5) * 8, h * 3, ((w2 - y0) / (y1 - y0) - 0.5) * 8);
  }

  private sample(d: SurfaceData, w1: number, w2: number): number {
    const fx = ((w1 - d.xs[0]) / (d.xs[d.xs.length - 1] - d.xs[0])) * (d.xs.length - 1);
    const fy = ((w2 - d.ys[0]) / (d.ys[d.ys.length - 1] - d.ys[0])) * (d.ys.length - 1);
    const cx = Math.max(0, Math.min(d.xs.length - 1.001, fx));
    const cy = Math.max(0, Math.min(d.ys.length - 1.001, fy));
    const i = Math.floor(cx);
    const j = Math.floor(cy);
    const tx = cx - i;
    const ty = cy - j;
    const z = d.z;
    return (z[j][i] * (1 - tx) + z[j][i + 1] * tx) * (1 - ty) + (z[j + 1][i] * (1 - tx) + z[j + 1][i + 1] * tx) * ty;
  }

  setData(d: SurfaceData): void {
    const flat = d.z.flat().filter(Number.isFinite);
    this.zMin = Math.min(...flat);
    this.zMax = Math.max(...flat);
    const nx = d.xs.length;
    const ny = d.ys.length;
    const pos = new Float32Array(nx * ny * 3);
    const col = new Float32Array(nx * ny * 3);
    for (let r = 0; r < ny; r++)
      for (let c = 0; c < nx; c++) {
        const p = this.toScene(d, d.xs[c], d.ys[r], d.z[r][c]);
        const k = (r * nx + c) * 3;
        pos.set([p.x, p.y, p.z], k);
        // cores em espaço linear: valores baixos já viram cinza visível na tela
        const g = 0.006 + Math.pow(Math.max(0, p.y) / 3, 1.4) * 0.11;
        col.set([g, g, g * 1.06], k);
      }
    const idx: number[] = [];
    for (let r = 0; r < ny - 1; r++)
      for (let c = 0; c < nx - 1; c++) {
        const a = r * nx + c;
        idx.push(a, a + 1, a + nx, a + 1, a + nx + 1, a + nx);
      }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    geo.setIndex(idx);
    if (this.mesh) {
      this.mesh.geometry.dispose();
      this.mesh.geometry = geo;
    } else {
      this.mesh = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.DoubleSide, transparent: true, opacity: 0.94 }));
      this.root.add(this.mesh);
    }
    const wg = new THREE.WireframeGeometry(geo);
    if (this.wire) {
      this.wire.geometry.dispose();
      this.wire.geometry = wg;
    } else {
      this.wire = new THREE.LineSegments(wg, new THREE.LineBasicMaterial({ color: 0x3a3a42, transparent: true, opacity: 0.55 }));
      this.root.add(this.wire);
    }
    // caminho do treino, apoiado na superfície
    const pts = d.path.map(([a, b]) => {
      const p = this.toScene(d, a, b, this.sample(d, a, b));
      p.y += 0.06;
      return p;
    });
    const dummy = new THREE.Object3D();
    let nd = 0;
    const every = Math.max(1, Math.floor(pts.length / 60));
    pts.forEach((p, i) => {
      if (i % every || nd >= 400) return;
      dummy.position.copy(p);
      dummy.updateMatrix();
      this.dots.setMatrixAt(nd++, dummy.matrix);
    });
    this.dots.count = nd;
    this.dots.instanceMatrix.needsUpdate = true;
    if (this.pathLine) {
      this.root.remove(this.pathLine);
      this.pathLine.geometry.dispose();
    }
    if (pts.length > 1) {
      this.pathLine = new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), new THREE.LineBasicMaterial({ color: 0xffffff, depthTest: false }));
      this.pathLine.renderOrder = 2;
      this.root.add(this.pathLine);
    }
    const last = pts[pts.length - 1];
    if (last) {
      this.ball.position.copy(last);
      this.ball.position.y += 0.12;
      this.ball.visible = true;
    }
  }

  protected tick(): void {
    this.ball.scale.setScalar(1 + Math.sin(this.time * 3) * 0.08);
  }
}
