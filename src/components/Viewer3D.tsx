import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import type { BuiltModel } from '../lib/model';
import type { Mesh } from '../lib/mesh';

export interface ViewerHandle {
  view: (v: 'front' | 'back' | 'side' | 'fit') => void;
}

interface Props {
  model: BuiltModel;
  colors: Record<string, string>;
  standHeight: number;
  slotDepth: number;
  /** Called with sprite column/row when a pixel on the figure is clicked. */
  onPick?: (col: number, row: number) => void;
}

function toGeometry(m: Mesh): THREE.BufferGeometry {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(m.positions, 3));
  g.setIndex(m.indices);
  const flat = g.toNonIndexed();
  flat.computeVertexNormals();
  g.dispose();
  return flat;
}

const Viewer3D = forwardRef<ViewerHandle, Props>(function Viewer3D({ model, colors, standHeight, slotDepth, onPick }, ref) {
  const host = useRef<HTMLDivElement>(null);
  const ctx = useRef<{
    renderer: THREE.WebGLRenderer;
    scene: THREE.Scene;
    camera: THREE.PerspectiveCamera;
    controls: OrbitControls;
    root: THREE.Group;
    figure: THREE.Group;
    render: () => void;
  } | null>(null);
  const fitted = useRef(false);
  const pickRef = useRef(onPick);
  pickRef.current = onPick;
  const modelRef = useRef(model);
  modelRef.current = model;

  useEffect(() => {
    const el = host.current!;
    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    } catch {
      el.textContent = 'WebGL is not available in this browser, so the 3D preview cannot be shown. Exports still work.';
      return;
    }
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    el.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(35, 1, 0.5, 4000);
    camera.position.set(40, 50, 140);
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.12;

    scene.add(new THREE.HemisphereLight(0xdfe6ff, 0x2a2230, 1.4));
    const key = new THREE.DirectionalLight(0xffffff, 2.2);
    key.position.set(60, 120, 140);
    scene.add(key);
    const rim = new THREE.DirectionalLight(0xaab8ff, 0.8);
    rim.position.set(-120, 60, -100);
    scene.add(rim);

    const floor = new THREE.GridHelper(400, 40, 0x5a5f78, 0x34374a);
    (floor.material as THREE.Material).transparent = true;
    (floor.material as THREE.Material).opacity = 0.45;
    scene.add(floor);

    const root = new THREE.Group();
    const figure = new THREE.Group();
    root.add(figure);
    scene.add(root);

    let frame = 0;
    const render = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        if (controls.update()) render();
        renderer.render(scene, camera);
      });
    };
    controls.addEventListener('change', render);

    const resize = () => {
      const w = el.clientWidth, h = el.clientHeight;
      renderer.setSize(w, h);
      camera.aspect = w / Math.max(1, h);
      camera.updateProjectionMatrix();
      render();
    };
    const ro = new ResizeObserver(resize);
    ro.observe(el);

    // Click (not drag) on the figure picks a sprite pixel.
    const ray = new THREE.Raycaster();
    let down: { x: number; y: number } | null = null;
    const onDown = (e: PointerEvent) => (down = { x: e.clientX, y: e.clientY });
    const onUp = (e: PointerEvent) => {
      if (!down || Math.hypot(e.clientX - down.x, e.clientY - down.y) > 4) return;
      down = null;
      const b = renderer.domElement.getBoundingClientRect();
      ray.setFromCamera(new THREE.Vector2(((e.clientX - b.left) / b.width) * 2 - 1, -((e.clientY - b.top) / b.height) * 2 + 1), camera);
      const hit = ray.intersectObjects(figure.children, false)[0];
      if (!hit || !hit.face) return;
      const p = figure.worldToLocal(hit.point.clone()).addScaledVector(hit.face.normal, -0.01);
      const g = modelRef.current.grid;
      const i = g.xs.findIndex((x, n) => n < g.nx && p.x >= x && p.x < g.xs[n + 1]);
      const j = g.ys.findIndex((y, n) => n < g.ny && p.y >= y && p.y < g.ys[n + 1]);
      if (i < 0 || j < g.tabRows) return;
      const rows = g.ny - g.tabRows;
      pickRef.current?.(i, rows - 1 - (j - g.tabRows));
    };
    renderer.domElement.addEventListener('pointerdown', onDown);
    renderer.domElement.addEventListener('pointerup', onUp);

    ctx.current = { renderer, scene, camera, controls, root, figure, render };
    resize();
    return () => {
      ro.disconnect();
      cancelAnimationFrame(frame);
      controls.dispose();
      renderer.dispose();
      el.removeChild(renderer.domElement);
      ctx.current = null;
    };
  }, []);

  const fit = (dir: THREE.Vector3) => {
    const c = ctx.current;
    if (!c) return;
    const box = new THREE.Box3().setFromObject(c.root);
    if (box.isEmpty()) return;
    const center = box.getCenter(new THREE.Vector3());
    const size = box.getSize(new THREE.Vector3()).length();
    const dist = size / (2 * Math.tan((c.camera.fov * Math.PI) / 360)) * 1.05;
    c.controls.target.copy(center);
    c.camera.position.copy(center).addScaledVector(dir.normalize(), dist);
    c.camera.near = dist / 100;
    c.camera.far = dist * 20;
    c.camera.updateProjectionMatrix();
    c.render();
  };

  useImperativeHandle(ref, () => ({
    view: (v) =>
      fit(
        v === 'front'
          ? new THREE.Vector3(0, 0.05, 1)
          : v === 'back'
            ? new THREE.Vector3(0, 0.05, -1)
            : v === 'side'
              ? new THREE.Vector3(1, 0.1, 0)
              : new THREE.Vector3(0.45, 0.35, 1),
      ),
  }));

  useEffect(() => {
    const c = ctx.current;
    if (!c) return;
    const dispose = (o: THREE.Object3D) =>
      o.traverse((n) => {
        if (n instanceof THREE.Mesh) {
          n.geometry.dispose();
          (n.material as THREE.Material).dispose();
        }
      });
    [...c.figure.children].forEach((n) => {
      dispose(n);
      c.figure.remove(n);
    });
    [...c.root.children].filter((n) => n !== c.figure).forEach((n) => {
      dispose(n);
      c.root.remove(n);
    });

    const mat = (id: string) =>
      new THREE.MeshStandardMaterial({ color: colors[id] ?? '#888', roughness: 0.62, metalness: 0.02, flatShading: true });
    for (const p of model.parts) c.figure.add(new THREE.Mesh(toGeometry(p.mesh), mat(p.filamentId)));

    // Print coordinates already stand the figure up (+Y up, front +Z); center it on the stand.
    const lift = model.stand ? standHeight - slotDepth : 0;
    c.figure.position.set(-model.tabCenterX, lift, -model.thickness / 2);

    if (model.stand) {
      const s = new THREE.Mesh(toGeometry(model.stand.mesh), mat(model.stand.filamentId));
      s.rotation.x = -Math.PI / 2;
      c.root.add(s);
    }
    if (!fitted.current) {
      fitted.current = true;
      fit(new THREE.Vector3(0.45, 0.35, 1));
    }
    c.render();
  }, [model, colors, standHeight, slotDepth]);

  return <div className="viewer" ref={host} />;
});

export default Viewer3D;
