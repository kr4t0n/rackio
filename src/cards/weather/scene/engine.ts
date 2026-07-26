import * as THREE from "three";
import type { SceneMode } from "@/lib/api";
import {
  cloudFragment,
  mistFragment,
  planeVertex,
  skyFragment,
  snowPointFragment,
  snowPointVertex,
} from "./shaders";

/**
 * The layered weather scene from the reference design: shader sky, three
 * parallax cloud planes, ground mist, and line-rain / point-snow particles.
 * Plain TS class — WeatherScene.tsx owns the React lifecycle around it.
 */

// `cloudy` reuses the rain palette family without precipitation.
const MODE_UNIFORM: Record<SceneMode, number> = {
  clear: 0,
  cloudy: 1,
  rain: 1,
  storm: 2,
  snow: 3,
};

interface RainState {
  index: number;
  z: number;
  x: number;
  y: number;
  speed: number;
  length: number;
}

interface SnowState {
  index: number;
  z: number;
  x: number;
  y: number;
  speed: number;
  phase: number;
  drift: number;
}

export class WeatherSceneEngine {
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera(40, 1, 0.1, 20);
  private sky: THREE.Mesh;
  private mist: THREE.Mesh;
  private clouds: THREE.Mesh[] = [];
  private rain: THREE.LineSegments;
  private snow: THREE.Points;
  private rainStates: RainState[] = [];
  private snowStates: SnowState[] = [];
  private animatedUniforms: Array<Record<string, THREE.IUniform>> = [];
  private mode: SceneMode = "clear";
  /* 0 = day, 1 = night; eased so sunrise/sunset transitions glide. */
  private night = 0;
  private nightTarget = 0;
  private frameHandle = 0;
  private lastFrame = 0;
  private readonly animated: boolean;
  /* Minimum gap between rendered frames, ms. 0 = every frame the display offers. */
  private readonly minFrameMs: number;
  /* Delta clamp, seconds — guards the physics against a long stall (a
     backgrounded tab, a stutter). Derived from the cap so a capped frame
     isn't mistaken for one. */
  private readonly maxDelta: number;
  private disposed = false;

  /**
   * @param maxFps Cap the render rate; 0 (default) renders as fast as the
   *   display refreshes. The wallpaper shell caps it — a desktop-level window
   *   is always "visible", so none of the browser's hidden-tab throttling
   *   applies and the scene would otherwise pull the GPU forever.
   */
  constructor(canvas: HTMLCanvasElement, animated: boolean, maxFps = 0) {
    this.animated = animated;
    this.minFrameMs = maxFps > 0 ? 1000 / maxFps : 0;
    this.maxDelta = Math.max(0.05, this.minFrameMs * 0.002);
    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: true,
      alpha: false,
      powerPreference: "low-power",
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.08;
    this.camera.position.set(0, 0, 5);

    const geometry = new THREE.PlaneGeometry(1, 1);

    this.sky = new THREE.Mesh(
      geometry,
      new THREE.ShaderMaterial({
        uniforms: this.makeUniforms({
          uFlash: { value: 0 },
          uAspect: { value: 1 },
        }),
        vertexShader: planeVertex,
        fragmentShader: skyFragment,
        depthWrite: false,
        depthTest: false,
      }),
    );
    this.sky.renderOrder = 0;
    this.scene.add(this.sky);

    [-2.55, -1.75, -0.95].forEach((z, index) => {
      const uniforms = this.makeUniforms({
        uLayer: { value: index },
        uAspect: { value: 1 },
      });
      const cloud = new THREE.Mesh(
        geometry,
        new THREE.ShaderMaterial({
          uniforms,
          vertexShader: planeVertex,
          fragmentShader: cloudFragment,
          transparent: true,
          depthWrite: false,
          depthTest: false,
        }),
      );
      cloud.userData.targetZ = z;
      cloud.renderOrder = 2 + index;
      this.clouds.push(cloud);
      this.scene.add(cloud);
    });

    this.mist = new THREE.Mesh(
      geometry,
      new THREE.ShaderMaterial({
        uniforms: this.makeUniforms(),
        vertexShader: planeVertex,
        fragmentShader: mistFragment,
        transparent: true,
        depthWrite: false,
        depthTest: false,
      }),
    );
    this.mist.renderOrder = 6;
    this.scene.add(this.mist);

    this.rain = this.createRain();
    this.snow = this.createSnow();

    if (this.animated) {
      this.frameHandle = requestAnimationFrame(this.renderFrame);
    }
  }

  private makeUniforms(
    extra: Record<string, THREE.IUniform> = {},
  ): Record<string, THREE.IUniform> {
    const uniforms: Record<string, THREE.IUniform> = {
      uTime: { value: 0 },
      uWeather: { value: MODE_UNIFORM[this.mode] },
      uNight: { value: this.night },
      ...extra,
    };
    this.animatedUniforms.push(uniforms);
    return uniforms;
  }

  private viewBoundsAt(z: number): { width: number; height: number } {
    const distance = this.camera.position.z - z;
    const height =
      2 * Math.tan(THREE.MathUtils.degToRad(this.camera.fov * 0.5)) * distance;
    return { width: height * this.camera.aspect, height };
  }

  private fitPlane(mesh: THREE.Mesh, z: number, overscan = 1.04): void {
    const bounds = this.viewBoundsAt(z);
    mesh.position.z = z;
    mesh.scale.set(bounds.width * overscan, bounds.height * overscan, 1);
  }

  private createRain(): THREE.LineSegments {
    const count = 280;
    const positions = new Float32Array(count * 6);
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute(
      "position",
      new THREE.BufferAttribute(positions, 3).setUsage(THREE.DynamicDrawUsage),
    );
    this.rainStates = Array.from({ length: count }, (_, index) => {
      const z = -0.7 + Math.random() * 3.0;
      const bounds = this.viewBoundsAt(z);
      return {
        index,
        z,
        x: (Math.random() - 0.5) * bounds.width * 1.18,
        y: (Math.random() - 0.5) * bounds.height * 1.28,
        speed: 0.68 + Math.random() * 0.92 + Math.max(0, z) * 0.16,
        length: 0.055 + Math.random() * 0.13 + Math.max(0, z) * 0.018,
      };
    });
    const material = new THREE.LineBasicMaterial({
      color: 0xc7e2f2,
      transparent: true,
      opacity: 0.42,
      depthWrite: false,
    });
    const lines = new THREE.LineSegments(geometry, material);
    lines.frustumCulled = false;
    lines.renderOrder = 8;
    this.scene.add(lines);
    return lines;
  }

  private createSnow(): THREE.Points {
    const count = 190;
    const positions = new Float32Array(count * 3);
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute(
      "position",
      new THREE.BufferAttribute(positions, 3).setUsage(THREE.DynamicDrawUsage),
    );
    this.snowStates = Array.from({ length: count }, (_, index) => {
      const z = -0.5 + Math.random() * 3.0;
      const bounds = this.viewBoundsAt(z);
      return {
        index,
        z,
        x: (Math.random() - 0.5) * bounds.width * 1.15,
        y: (Math.random() - 0.5) * bounds.height * 1.25,
        speed: 0.08 + Math.random() * 0.16,
        phase: Math.random() * Math.PI * 2,
        drift: 0.03 + Math.random() * 0.07,
      };
    });
    const material = new THREE.ShaderMaterial({
      uniforms: {
        uPixelRatio: { value: Math.min(window.devicePixelRatio || 1, 1.5) },
      },
      transparent: true,
      depthWrite: false,
      vertexShader: snowPointVertex,
      fragmentShader: snowPointFragment,
    });
    const points = new THREE.Points(geometry, material);
    points.frustumCulled = false;
    points.renderOrder = 9;
    this.scene.add(points);
    return points;
  }

  setMode(mode: SceneMode, isDay = true): void {
    this.mode = mode;
    this.nightTarget = isDay ? 0 : 1;
    if (!this.animated) {
      // No animation loop to ease it — snap.
      this.night = this.nightTarget;
      this.animatedUniforms.forEach((uniforms) => {
        uniforms.uNight.value = this.night;
      });
    }
    const value = MODE_UNIFORM[mode];
    this.animatedUniforms.forEach((uniforms) => {
      uniforms.uWeather.value = value;
    });
    this.rain.visible = mode === "rain" || mode === "storm";
    (this.rain.material as THREE.LineBasicMaterial).opacity =
      mode === "storm" ? 0.56 : 0.39;
    this.snow.visible = mode === "snow";
    this.renderer.toneMappingExposure =
      (mode === "storm" ? 0.88 : 1.08) * (this.nightTarget > 0.5 ? 0.82 : 1);
    if (!this.animated) this.renderFrame(0);
  }

  resize(width: number, height: number): void {
    if (width < 1 || height < 1) return;
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(width, height, false);
    const skyUniforms = (this.sky.material as THREE.ShaderMaterial).uniforms;
    skyUniforms.uAspect.value = this.camera.aspect;
    this.fitPlane(this.sky, -3.1);
    this.clouds.forEach((cloud) => {
      this.fitPlane(cloud, cloud.userData.targetZ as number, 1.12);
      (cloud.material as THREE.ShaderMaterial).uniforms.uAspect.value =
        this.camera.aspect;
    });
    this.fitPlane(this.mist, -0.55, 1.08);
    this.rainStates.forEach((state) => {
      const bounds = this.viewBoundsAt(state.z);
      state.x = (Math.random() - 0.5) * bounds.width * 1.18;
    });
    this.snowStates.forEach((state) => {
      const bounds = this.viewBoundsAt(state.z);
      state.x = (Math.random() - 0.5) * bounds.width * 1.15;
    });
    if (!this.animated) this.renderFrame(0);
  }

  private writePrecipitation(delta: number, elapsed: number): void {
    if (this.rain.visible) {
      const position = this.rain.geometry.attributes.position
        .array as Float32Array;
      const wind = this.mode === "storm" ? 0.42 : 0.18;
      this.rainStates.forEach((state) => {
        const bounds = this.viewBoundsAt(state.z);
        state.y -= state.speed * delta * (this.mode === "storm" ? 1.34 : 1);
        state.x -= wind * delta;
        if (state.y < -bounds.height * 0.62 || state.x < -bounds.width * 0.68) {
          state.y = bounds.height * (0.52 + Math.random() * 0.16);
          state.x = (Math.random() - 0.38) * bounds.width * 1.2;
        }
        const offset = state.index * 6;
        position[offset] = state.x;
        position[offset + 1] = state.y;
        position[offset + 2] = state.z;
        position[offset + 3] = state.x + wind * state.length * 0.32;
        position[offset + 4] = state.y + state.length;
        position[offset + 5] = state.z;
      });
      this.rain.geometry.attributes.position.needsUpdate = true;
    }
    if (this.snow.visible) {
      const position = this.snow.geometry.attributes.position
        .array as Float32Array;
      this.snowStates.forEach((state) => {
        const bounds = this.viewBoundsAt(state.z);
        state.y -= state.speed * delta;
        state.x += Math.sin(elapsed * 0.7 + state.phase) * state.drift * delta;
        if (state.y < -bounds.height * 0.58) {
          state.y = bounds.height * (0.52 + Math.random() * 0.12);
          state.x = (Math.random() - 0.5) * bounds.width * 1.12;
        }
        const offset = state.index * 3;
        position[offset] = state.x;
        position[offset + 1] = state.y;
        position[offset + 2] = state.z;
      });
      this.snow.geometry.attributes.position.needsUpdate = true;
    }
  }

  private renderFrame = (time: number): void => {
    if (this.disposed) return;
    // Under a cap, stay in the rAF chain but skip the work. lastFrame only
    // advances on a rendered frame, so delta still covers the whole skipped
    // interval and the rain falls at the same speed, just in bigger steps.
    if (
      this.animated &&
      this.minFrameMs > 0 &&
      time - this.lastFrame < this.minFrameMs
    ) {
      this.frameHandle = requestAnimationFrame(this.renderFrame);
      return;
    }
    const elapsed = time * 0.001;
    const delta = this.animated
      ? Math.min(this.maxDelta, Math.max(0, (time - this.lastFrame) * 0.001))
      : 0;
    this.lastFrame = time;
    if (this.night !== this.nightTarget) {
      const step = Math.min(0.04, Math.abs(this.nightTarget - this.night));
      this.night += this.nightTarget > this.night ? step : -step;
    }
    this.animatedUniforms.forEach((uniforms) => {
      uniforms.uTime.value = this.animated ? elapsed : 0;
      uniforms.uNight.value = this.night;
    });
    const flash =
      this.mode === "storm" && this.animated
        ? Math.pow(Math.max(0, Math.sin(elapsed * 0.72)), 72) * 0.72
        : 0;
    (this.sky.material as THREE.ShaderMaterial).uniforms.uFlash.value = flash;
    this.writePrecipitation(delta, elapsed);
    this.renderer.render(this.scene, this.camera);
    if (this.animated) {
      this.frameHandle = requestAnimationFrame(this.renderFrame);
    }
  };

  dispose(): void {
    this.disposed = true;
    cancelAnimationFrame(this.frameHandle);
    this.scene.traverse((object) => {
      if (object instanceof THREE.Mesh || object instanceof THREE.Points) {
        object.geometry.dispose();
        const material = object.material as THREE.Material;
        material.dispose();
      } else if (object instanceof THREE.LineSegments) {
        object.geometry.dispose();
        (object.material as THREE.Material).dispose();
      }
    });
    this.renderer.dispose();
  }
}
