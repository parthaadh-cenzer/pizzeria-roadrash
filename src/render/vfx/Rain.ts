// GPU rain streaks (near + mid layers) wrapping around the camera. Streak density, length,
// wind slant and relative-speed elongation scale with weather intensity.
import * as THREE from 'three';

function layer(count: number, box: THREE.Vector3, width: number, lenScale: number, opacity: number): THREE.Mesh {
  const geo = new THREE.InstancedBufferGeometry();
  const quad = new Float32Array([-0.5, 0, 0, 0.5, 0, 0, -0.5, 1, 0, 0.5, 1, 0]);
  geo.setAttribute('position', new THREE.BufferAttribute(quad, 3));
  geo.setIndex([0, 1, 2, 1, 3, 2]);
  const off = new Float32Array(count * 4);
  for (let i = 0; i < count; i++) {
    off[i * 4] = Math.random();
    off[i * 4 + 1] = Math.random();
    off[i * 4 + 2] = Math.random();
    off[i * 4 + 3] = Math.random();
  }
  geo.setAttribute('aOffset', new THREE.InstancedBufferAttribute(off, 4));
  geo.instanceCount = count;
  const mat = new THREE.ShaderMaterial({
    uniforms: {
      uCam: { value: new THREE.Vector3() },
      uBox: { value: box },
      uFall: { value: new THREE.Vector3() },
      uVel: { value: new THREE.Vector3(0, -24, 0) },
      uDensity: { value: 1 },
      uWidth: { value: width },
      uLen: { value: lenScale },
      uOpacity: { value: opacity },
      uColor: { value: new THREE.Color(0.75, 0.82, 1.0) },
    },
    vertexShader: /* glsl */ `
      attribute vec4 aOffset;
      uniform vec3 uCam, uBox, uVel, uFall;
      uniform float uDensity, uWidth, uLen;
      varying float vAlpha;
      varying float vU;
      void main() {
        if (aOffset.w > uDensity) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); vAlpha = 0.0; return; }
        vec3 fall = uFall * (0.85 + aOffset.w * 0.3);
        vec3 p = mod(aOffset.xyz * uBox + fall - uCam, uBox) - uBox * 0.5 + uCam;
        vec3 axis = normalize(uVel);
        float len = uLen * (0.6 + 0.4 * aOffset.w) * (0.5 + length(uVel) * 0.03);
        vec3 toCam = normalize(cameraPosition - p);
        vec3 side = normalize(cross(axis, toCam)) * uWidth;
        vec3 wp = p + side * position.x + axis * (position.y - 0.5) * len;
        vAlpha = 1.0 - smoothstep(uBox.x * 0.3, uBox.x * 0.5, length(p - uCam));
        vU = position.x * 2.0;
        gl_Position = projectionMatrix * viewMatrix * vec4(wp, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      uniform float uOpacity; uniform vec3 uColor;
      varying float vAlpha; varying float vU;
      void main() {
        float a = (1.0 - abs(vU)) * vAlpha * uOpacity;
        if (a < 0.003) discard;
        gl_FragColor = vec4(uColor * a, a);
      }
    `,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.frustumCulled = false;
  mesh.renderOrder = 20;
  return mesh;
}

export class Rain {
  readonly group = new THREE.Group();
  private near: THREE.Mesh;
  private mid: THREE.Mesh;
  private wind = new THREE.Vector3(2.5, 0, 1.2);
  private fallOffset = new THREE.Vector3();
  private last = -1;

  constructor(count: number) {
    this.near = layer(Math.floor(count * 0.7), new THREE.Vector3(36, 26, 36), 0.012, 0.9, 0.34);
    this.mid = layer(Math.floor(count * 0.3), new THREE.Vector3(110, 60, 110), 0.035, 2.4, 0.2);
    this.group.add(this.near, this.mid);
    this.group.name = 'rain';
  }

  /** intensity: 0..3 weather scale; factor: 1 outdoors, ~0 in the tunnel; camVel: world velocity. */
  update(time: number, camera: THREE.Camera, intensity: number, factor: number, camVel: THREE.Vector3): void {
    const k = Math.max(0, Math.min(1, (intensity + 0.4) / 3.4)) * factor;
    const fall = 16 + intensity * 4;
    const wind = this.wind.clone().multiplyScalar(0.6 + intensity * 0.5);
    const dt = this.last < 0 ? 0 : Math.min(0.1, time - this.last);
    this.last = time;
    this.fallOffset.x = (this.fallOffset.x + wind.x * dt);
    this.fallOffset.y = (this.fallOffset.y - fall * dt);
    this.fallOffset.z = (this.fallOffset.z + wind.z * dt);
    for (const [mesh, dens] of [[this.near, k], [this.mid, k * 0.9]] as const) {
      const u = (mesh.material as THREE.ShaderMaterial).uniforms;
      u.uCam!.value.copy(camera.position);
      u.uFall!.value.copy(this.fallOffset);
      u.uDensity!.value = dens;
      // Relative velocity elongates and slants streaks at speed.
      (u.uVel!.value as THREE.Vector3).set(wind.x - camVel.x * 0.55, -fall - Math.max(0, camVel.y) * 0.2, wind.z - camVel.z * 0.55);
    }
    this.group.visible = k > 0.005;
  }
}
