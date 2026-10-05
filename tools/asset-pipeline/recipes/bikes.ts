// Bike recipes. All six bikes are normalized to one frame (+Z forward, metres, ground y=0)
// and one material language; mount targets come from src/config/bikes.ts.
import type { Document, Node } from '@gltf-transform/core';
import * as THREE from 'three';
import { BIKES, type BikeDef } from '../../../src/config/bikes.js';
import type { BikeId } from '../../../src/shared/ids.js';
import type { BikeRuntimeInfo, ManifestEntry } from '../../../src/shared/manifest.js';
import { bakeAndMergeStatic, extractToNode, nodeWorldMatrix, primitiveIslands } from '../lib/components.js';
import { quatY, renameNode, type Measurement } from '../lib/gltfOps.js';
import { codeHashOf, libHash, processModel, type ModelSpec } from './common.js';

const CODE = () => libHash() + codeHashOf('tools/asset-pipeline/recipes/bikes.ts');

function forwardQuat(f: BikeDef['sourceForward']): THREE.Quaternion {
  switch (f) {
    case '+Z': return quatY(0);
    case '-Z': return quatY(Math.PI);
    case '+X': return quatY(-Math.PI / 2);
    case '-X': return quatY(Math.PI / 2);
  }
}

function lengthAlongForward(m: Measurement, f: BikeDef['sourceForward']): number {
  return f === '+Z' || f === '-Z' ? m.size.z : m.size.x;
}

interface BikeExtra {
  wheels: { node: string; front: boolean }[];
  steer: string[];
  spin: { node: string; rate: number }[];
  boostNode: string | null;
  idleClip: string | null;
}

function info(def: BikeDef, m: Measurement, extra: BikeExtra): BikeRuntimeInfo {
  return {
    length: +m.size.z.toFixed(3),
    width: +m.size.x.toFixed(3),
    height: +m.size.y.toFixed(3),
    hoverHeight: def.hoverHeight,
    wheels: extra.wheels.map((w) => {
      const p = m.nodes.get(w.node);
      if (!p) throw new Error(`${def.asset}: wheel node ${w.node} missing after processing`);
      return { node: w.node, radius: +p.y.toFixed(3), axis: [1, 0, 0] };
    }),
    steerNodes: extra.steer,
    spinNodes: extra.spin.map((s) => ({ node: s.node, axis: [1, 0, 0], rate: s.rate })),
    emissiveMaterials: def.emissiveMaterials,
    paintMaterials: [...def.paintMaterials, ...def.accentMaterials],
    boostNode: extra.boostNode,
    exhaust: def.exhaust,
    headlight: def.headlight,
    idleClip: extra.idleClip,
    mount: def.mount,
  };
}

function decorateBike(def: BikeDef) {
  return (e: ManifestEntry) => {
    if (!e.bike) return;
    e.bike.mount = def.mount;
    e.bike.exhaust = def.exhaust;
    e.bike.headlight = def.headlight;
    e.bike.emissiveMaterials = def.emissiveMaterials;
    e.bike.paintMaterials = [...def.paintMaterials, ...def.accentMaterials];
    e.bike.hoverHeight = def.hoverHeight;
    e.materialVariants = def.variants.map((v) => ({ name: v.name, colors: { paint: v.paint, accent: v.accent, emissive: v.emissive } }));
  };
}

function requireNode(doc: Document, re: RegExp, name: string): Node {
  const n = renameNode(doc, re, name);
  if (!n) throw new Error(`node ${re} not found`);
  return n;
}

function baseSpec(def: BikeDef, source: string, extra: BikeExtra, overrides: Partial<ModelSpec>): ModelSpec {
  return {
    id: def.asset,
    dir: 'bikes',
    source,
    codeHash: CODE(),
    textureMax: 1024,
    normalize: (m) => {
      const q = forwardQuat(def.sourceForward);
      const len = lengthAlongForward(m, def.sourceForward);
      return { q, scale: def.targetLength / len, groundY: def.hoverHeight };
    },
    lod1: { ratio: 0.25, error: 0.02, textureMax: 512 },
    describe: (m) => ({ bike: info(def, m, extra), animations: extra.idleClip ? [extra.idleClip] : [] }),
    decorate: decorateBike(def),
    ...overrides,
  };
}

export async function buildBikes(): Promise<ManifestEntry[]> {
  const out: ManifestEntry[] = [];
  const B = (id: BikeId) => BIKES[id];

  // 1. Sci-Fi Motorcycle: articulated skin; showcase clip removed (never looped).
  {
    const def = B('BIKE_01_SCIFI_MOTORCYCLE');
    const extra: BikeExtra = {
      wheels: [{ node: 'wheel_front', front: true }, { node: 'wheel_rear', front: false }],
      steer: ['steer_left', 'steer_right'],
      spin: [{ node: 'spin_1', rate: 1 }, { node: 'spin_2', rate: 1 }, { node: 'spin_3', rate: 1 }, { node: 'spin_4', rate: 1 }],
      boostNode: null,
      idleClip: null,
    };
    out.push(await processModel(baseSpec(def, 'Assets/Bikes/sci-fi_motorcycle.glb', extra, {
      // The showcase clip is read once for its deployed riding configuration, then discarded.
      keepAnimations: () => true,
      prepare: (doc) => {
        // The model's rest pose is the parked configuration (handlebars folded under the cowl,
        // dashboard collapsed). Bake the showcase's own final keyframes for the steering arms,
        // grips, dashboard and lights into the rest pose: that is the riding configuration.
        const deploy = /^(steeringWheel[123]\.[LR]_\d+|interface_03|lights\.[LR]_\d+)$/;
        const baked: string[] = [];
        for (const anim of doc.getRoot().listAnimations()) {
          for (const ch of anim.listChannels()) {
            const node = ch.getTargetNode();
            const out = ch.getSampler()?.getOutput();
            if (!node || !out || !deploy.test(node.getName())) continue;
            const last = out.getElement(out.getCount() - 1, [] as number[]);
            const path = ch.getTargetPath();
            if (path === 'rotation') node.setRotation(last as unknown as [number, number, number, number]);
            else if (path === 'translation') node.setTranslation(last as unknown as [number, number, number]);
            else if (path === 'scale') node.setScale(last as unknown as [number, number, number]);
            baked.push(`${node.getName()}.${path}`);
          }
          anim.dispose();
        }
        if (baked.length < 8) throw new Error(`bike.scifi: deployed steering pose not found (${baked.length} channels)`);
        requireNode(doc, /^wheel1_04$/, 'wheel_front');
        requireNode(doc, /^wheel2_036$/, 'wheel_rear');
        requireNode(doc, /^steeringWheel1\.L_06$/, 'steer_left');
        requireNode(doc, /^steeringWheel1\.R_013$/, 'steer_right');
        requireNode(doc, /^spiral1\.L_05$/, 'spin_1');
        requireNode(doc, /^spiral2\.L_012$/, 'spin_2');
        requireNode(doc, /^spiral1\.R_016$/, 'spin_3');
        requireNode(doc, /^spiral2\.R_017$/, 'spin_4');
        return [`deployed riding configuration baked from the showcase's final keyframes (${baked.length} channels: steering arms, grips, dashboard, lights); showcase clip removed`];
      },
      simplify: { ratio: 0.55, error: 0.002 },
    })));
  }

  // 2. Akira Class Cruiser: 1.44M triangles -> aggressive decimation, static meshes merged,
  //    wheel assemblies and emissives preserved as separate nodes/materials.
  {
    const def = B('BIKE_02_AKIRA_CRUISER');
    const extra: BikeExtra = { wheels: [{ node: 'wheel_front', front: true }, { node: 'wheel_rear', front: false }], steer: [], spin: [], boostNode: null, idleClip: null };
    out.push(await processModel(baseSpec(def, 'Assets/Bikes/akira_class_cruiser.glb', extra, {
      prepare: (doc) => {
        // The only textured material is a Sketchfab watermark decal; strip it.
        for (const mesh of doc.getRoot().listMeshes()) for (const p of mesh.listPrimitives()) if (p.getMaterial()?.getName() === 'Material.028') { mesh.removePrimitive(p); p.dispose(); }
        const f = requireNode(doc, /^Wheel Ft$/, 'wheel_front');
        const r = requireNode(doc, /^Wheel Ft\.001$/, 'wheel_rear');
        bakeAndMergeStatic(doc, [f, r], 'akira_body');
        return ['watermark decal (Material.028) removed; static meshes merged by material; wheel assemblies kept as pivots'];
      },
      simplify: { ratio: 0.075, error: 0.05, dropNormals: true },
      lod1: { ratio: 0.35, error: 0.08, textureMax: 512, dropNormals: true },
    })));
  }

  // 3. Hovering Engine: merge safe static meshes; rotating cylinders and boost flame preserved.
  {
    const def = B('BIKE_03_HOVERING_ENGINE');
    const extra: BikeExtra = { wheels: [], steer: ['steer_bar'], spin: [], boostNode: 'boost_flame', idleClip: '*' };
    out.push(await processModel(baseSpec(def, 'Assets/Bikes/hovering_engine_motorcycle.glb', extra, {
      keepAnimations: () => true,
      prepare: (doc) => {
        const a = requireNode(doc, /^Cylinder\.001$/, 'spin_a');
        const b = requireNode(doc, /^Cylinder\.003$/, 'spin_b');
        const fl = requireNode(doc, /^Flames$/, 'boost_flame');
        const bar = requireNode(doc, /^Cylinder\.008$/, 'steer_bar');
        bakeAndMergeStatic(doc, [a, b, fl, bar], 'hover_engine_body');
        for (const an of doc.getRoot().listAnimations()) an.setName(an.getName().includes('Cylinder.001|') ? 'spin_a' : 'spin_b');
        return ['static meshes merged; rotating cylinders keep their clips; boost flame tied to cheat boost'];
      },
    })));
  }

  // 4. Hover Rocket: texture optimisation; idle vent/flap animation preserved.
  {
    const def = B('BIKE_04_HOVER_ROCKET');
    const extra: BikeExtra = { wheels: [], steer: [], spin: [], boostNode: null, idleClip: 'idle' };
    out.push(await processModel(baseSpec(def, 'Assets/Bikes/hover_bike_-_the_rocket.glb', extra, {
      keepAnimations: (n) => /Idle/.test(n),
      prepare: (doc) => {
        for (const an of doc.getRoot().listAnimations()) an.setName('idle');
        return ['4x4096 textures reduced to 1024 KTX2; idle clip kept (vents spin, flaps flutter)'];
      },
      masks: [{ material: 'Test', kind: 'paint' }],
    })));
  }

  // 5. TRON Light Cycle: tire/handle bones preserved; prone mount profile.
  {
    const def = B('BIKE_05_TRON_LIGHT_CYCLE');
    const extra: BikeExtra = {
      wheels: [{ node: 'wheel_front', front: true }, { node: 'wheel_rear', front: false }],
      steer: ['steer_left', 'steer_right'],
      spin: [{ node: 'spin_engine', rate: 1 }],
      boostNode: null,
      idleClip: null,
    };
    out.push(await processModel(baseSpec(def, 'Assets/Bikes/tron_uprising_-_argoncity_light_cycle.glb', extra, {
      prepare: (doc) => {
        requireNode(doc, /^Front_Tire/, 'wheel_front');
        requireNode(doc, /^Rear_Tire/, 'wheel_rear');
        requireNode(doc, /^Rear_Engine/, 'spin_engine');
        requireNode(doc, /^L_Handle/, 'steer_left');
        requireNode(doc, /^R_Handle/, 'steer_right');
        return ['rear-engine spin clip replaced by procedural spin'];
      },
    })));
  }

  // 6. Monobike: spec-gloss converted; tyre + rim islands split into a pivoted wheel node.
  {
    const def = B('BIKE_06_MONOBIKE');
    const extra: BikeExtra = { wheels: [{ node: 'wheel_main', front: true }], steer: [], spin: [], boostNode: null, idleClip: null };
    out.push(await processModel(baseSpec(def, 'Assets/Bikes/monobike_-_toriyama_dragonseeker.glb', extra, {
      prepare: (doc) => {
        const centre = new THREE.Vector3(0, 0.376, 0);
        let moved = 0;
        let parent: Node | null = null;
        const all: { node: Node; prim: ReturnType<NonNullable<ReturnType<Node['getMesh']>>['listPrimitives']>[number]; tris: number[] }[] = [];
        for (const node of doc.getRoot().listNodes()) {
          const mesh = node.getMesh();
          if (!mesh) continue;
          const m = nodeWorldMatrix(node);
          for (const prim of mesh.listPrimitives()) {
            const tris: number[] = [];
            for (const isl of primitiveIslands(prim, m)) {
              const near = isl.center.distanceTo(centre) < 0.07;
              if (near && isl.size.y > 0.55 && isl.size.z > 0.55 && isl.size.x < 0.3) tris.push(...isl.tris);
            }
            if (tris.length) {
              all.push({ node, prim, tris });
              moved += tris.length;
              parent = (node.listParents().find((p) => p.propertyType === 'Node') as Node | undefined) ?? node;
            }
          }
        }
        if (!moved || !parent) throw new Error('monobike: tyre/rim islands not found');
        // First extraction creates the wheel node; the rest are merged into it.
        const wheelParent = parent;
        const first = all[0]!;
        const wheel = extractToNode(doc, first.node, first.prim, first.tris, 'wheel_main', centre, wheelParent);
        for (const rest of all.slice(1)) {
          const n = extractToNode(doc, rest.node, rest.prim, rest.tris, 'wheel_main_part', centre, wheelParent);
          // Reparent under the wheel with zero offset.
          wheelParent.removeChild(n);
          n.setTranslation([0, 0, 0]);
          wheel.addChild(n);
        }
        return [`tyre/rim split into pivoted node wheel_main (${moved} triangles)`];
      },
      masks: [{ material: 'Monobike_U1', kind: 'paint' }, { material: 'Monobike_U2', kind: 'paint' }],
    })));
  }
  return out;
}
