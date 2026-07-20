/** GLSL for the weather scene — ported verbatim from the reference design. */

export const planeVertex = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const noiseFunctions = /* glsl */ `
  float hash12(vec2 p) {
    vec3 p3 = fract(vec3(p.xyx) * 0.1031);
    p3 += dot(p3, p3.yzx + 33.33);
    return fract((p3.x + p3.y) * p3.z);
  }
  float noise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash12(i), hash12(i + vec2(1.0, 0.0)), f.x),
               mix(hash12(i + vec2(0.0, 1.0)), hash12(i + vec2(1.0)), f.x), f.y);
  }
  float fbm(vec2 p) {
    float value = 0.0;
    float amplitude = 0.54;
    mat2 rotation = mat2(0.82, -0.57, 0.57, 0.82);
    for (int i = 0; i < 5; i++) {
      value += amplitude * noise(p);
      p = rotation * p * 2.03 + 17.1;
      amplitude *= 0.48;
    }
    return value;
  }
`;

export const skyFragment = /* glsl */ `
  precision highp float;
  varying vec2 vUv;
  uniform float uTime;
  uniform float uWeather;
  uniform float uFlash;
  uniform float uAspect;
  vec3 palette(float weather, float y) {
    vec3 top;
    vec3 bottom;
    if (weather < 0.5) {
      top = vec3(0.025, 0.25, 0.57);
      bottom = vec3(0.30, 0.62, 0.80);
    } else if (weather < 1.5) {
      top = vec3(0.035, 0.12, 0.20);
      bottom = vec3(0.22, 0.35, 0.44);
    } else if (weather < 2.5) {
      top = vec3(0.012, 0.024, 0.055);
      bottom = vec3(0.085, 0.12, 0.18);
    } else {
      top = vec3(0.16, 0.32, 0.45);
      bottom = vec3(0.58, 0.68, 0.73);
    }
    return mix(bottom, top, smoothstep(0.0, 1.0, y));
  }
  void main() {
    vec3 color = palette(uWeather, vUv.y);
    float horizon = exp(-abs(vUv.y - 0.22) * 5.5);
    color += vec3(0.15, 0.19, 0.21) * horizon * (uWeather < 0.5 ? 0.18 : 0.08);
    if (uWeather < 0.5) {
      vec2 sunDelta = (vUv - vec2(0.76, 0.70)) * vec2(uAspect, 1.0);
      float sunDistance = length(sunDelta);
      float softDisc = 1.0 - smoothstep(0.020, 0.033, sunDistance);
      float innerGlow = exp(-sunDistance * 11.0);
      float atmosphericBloom = exp(-sunDistance * 3.8);
      color = mix(color, vec3(1.0, 0.86, 0.57), softDisc * 0.72);
      color += vec3(1.0, 0.57, 0.20) * innerGlow * 0.28;
      color += vec3(0.96, 0.50, 0.18) * atmosphericBloom * 0.09;
    }
    color += vec3(0.55, 0.68, 0.90) * uFlash;
    float vignette = 1.0 - smoothstep(0.44, 0.94, distance(vUv, vec2(0.5, 0.54)));
    color *= mix(0.72, 1.0, vignette);
    gl_FragColor = vec4(color, 1.0);
  }
`;

export const cloudFragment = /* glsl */ `
  precision highp float;
  varying vec2 vUv;
  uniform float uTime;
  uniform float uWeather;
  uniform float uLayer;
  uniform float uAspect;
  ${noiseFunctions}
  void main() {
    float speed = mix(0.012, 0.034, uLayer / 2.0);
    float scale = mix(1.55, 2.65, uLayer / 2.0);
    vec2 p = (vUv - 0.5) * vec2(uAspect, 1.0) * scale;
    p += vec2(-uTime * speed, uLayer * 3.73);
    float broad = fbm(p);
    float detail = fbm(p * 2.35 + 8.1);
    float threshold = uWeather < 0.5 ? 0.64 : (uWeather < 2.5 ? 0.48 : 0.55);
    float shape = smoothstep(threshold, threshold + 0.22, broad * 0.78 + detail * 0.32);
    shape *= smoothstep(0.03, 0.24, vUv.y) * (1.0 - smoothstep(0.78, 1.02, vUv.y));
    vec3 lightColor;
    vec3 shadeColor;
    if (uWeather < 0.5) {
      lightColor = vec3(0.93, 0.96, 0.98);
      shadeColor = vec3(0.28, 0.48, 0.62);
    } else if (uWeather < 2.5) {
      lightColor = vec3(0.43, 0.51, 0.55);
      shadeColor = vec3(0.035, 0.055, 0.08);
    } else {
      lightColor = vec3(0.87, 0.91, 0.93);
      shadeColor = vec3(0.29, 0.40, 0.47);
    }
    float lighting = smoothstep(0.18, 0.88, detail + vUv.y * 0.12);
    vec3 color = mix(shadeColor, lightColor, lighting);
    float density = uWeather < 0.5 ? 0.36 : (uWeather < 2.5 ? 0.66 : 0.50);
    float depthFade = 1.0 - uLayer * 0.10;
    gl_FragColor = vec4(color, shape * density * depthFade);
  }
`;

export const mistFragment = /* glsl */ `
  precision highp float;
  varying vec2 vUv;
  uniform float uTime;
  uniform float uWeather;
  ${noiseFunctions}
  void main() {
    vec2 p = vec2(vUv.x * 2.2 - uTime * 0.009, vUv.y * 5.0);
    float textureNoise = fbm(p);
    float bottom = 1.0 - smoothstep(0.02, 0.56, vUv.y);
    // "active" is reserved in GLSL ES 3.0 (WebGL2) — hence "strength".
    float strength = uWeather < 0.5 ? 0.05 : (uWeather < 2.5 ? 0.30 : 0.18);
    float alpha = bottom * smoothstep(0.25, 0.78, textureNoise) * strength;
    vec3 color = uWeather > 2.5 ? vec3(0.72, 0.80, 0.82) : vec3(0.28, 0.37, 0.42);
    gl_FragColor = vec4(color, alpha);
  }
`;

export const snowPointVertex = /* glsl */ `
  uniform float uPixelRatio;
  void main() {
    vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
    float depthScale = clamp(5.0 / -mvPosition.z, 0.65, 1.65);
    gl_PointSize = 5.2 * depthScale * uPixelRatio;
    gl_Position = projectionMatrix * mvPosition;
  }
`;

export const snowPointFragment = /* glsl */ `
  void main() {
    float distanceToCenter = length(gl_PointCoord - 0.5);
    float alpha = 1.0 - smoothstep(0.28, 0.5, distanceToCenter);
    gl_FragColor = vec4(0.90, 0.96, 1.0, alpha * 0.84);
  }
`;
