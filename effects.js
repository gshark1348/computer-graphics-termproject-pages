import * as THREE from 'three';

// Convert hardware depth to positive camera-space distance in metres.
const depthFunction = `
  uniform vec2 clipPlanes;
  float distanceAt(float d) {
    return clipPlanes.x * clipPlanes.y / mix(clipPlanes.y, clipPlanes.x, d);
  }`;

export function createEffects(renderer, scene, camera, mesh) {
  const base = mesh.material;
  const nearest = new THREE.WebGLRenderTarget(1, 1, {
    depthTexture: new THREE.DepthTexture(1, 1, THREE.UnsignedIntType),
    minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter
  });
  const canBlend = renderer.extensions.has('EXT_color_buffer_float');
  const sum = canBlend ? new THREE.WebGLRenderTarget(1, 1, {
    type: THREE.HalfFloatType, depthBuffer: false,
    minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter
  }) : null;
  const clipPlanes = {value: new THREE.Vector2(camera.near, camera.far)};
  const nearestDepth = {value: nearest.depthTexture};
  const accumulation = base.clone();
  accumulation.uniforms = {...base.uniforms, clipPlanes, nearestDepth};
  accumulation.fragmentShader = base.fragmentShader.replace('void main()', `
    uniform sampler2D nearestDepth;
    uniform vec2 viewport;
    ${depthFunction}
    void main()`).replace('gl_FragColor = vec4(color,1);', `
      float front = distanceAt(texture2D(nearestDepth, gl_FragCoord.xy / viewport).r);
      float separation = distanceAt(gl_FragCoord.z) - front;
      if (separation > max(0.015, front * 0.003)) discard;
      float weight = exp(-2.5 * dot(disc,disc));
      gl_FragColor = vec4(pow(color,vec3(2.2))*weight,weight);`);
  Object.assign(accumulation, {
    transparent: true, forceSinglePass: true, depthTest: false, depthWrite: false,
    blending: THREE.CustomBlending, blendEquation: THREE.AddEquation,
    blendSrc: THREE.OneFactor, blendDst: THREE.OneFactor
  });
  const composite = new THREE.ShaderMaterial({
    uniforms: {
      clipPlanes, nearestDepth, baseColor: {value: nearest.texture},
      weightedColor: {value: sum?.texture ?? nearest.texture},
      viewport: base.uniforms.viewport, blend: {value: false}, edl: {value: false}
    },
    vertexShader: `varying vec2 tex;
      void main(){tex = uv; gl_Position = vec4(position.xy,0,1);}`,
    fragmentShader: `
      varying vec2 tex;
      uniform sampler2D nearestDepth, baseColor, weightedColor;
      uniform vec2 viewport;
      uniform bool blend, edl;
      ${depthFunction}
      float response(vec2 offset,float center) {
        float d = texture2D(nearestDepth, tex + offset / viewport).r;
        if (d >= 1.0) return 0.0;
        return max(0.0,log(center / distanceAt(d)));
      }
      void main(){
        vec3 color = texture2D(baseColor, tex).rgb;
        float d = texture2D(nearestDepth,tex).r;
        if (d < 1.0) {
          if (blend) {
            vec4 total = texture2D(weightedColor,tex);
            if (total.a > 0.0) color = pow(total.rgb / total.a,vec3(1.0/2.2));
          }
          if (edl) {
            float z = distanceAt(d);
            float shadow = response(vec2(2,0),z)+response(vec2(-2,0),z)
                         + response(vec2(0,2),z)+response(vec2(0,-2),z);
            color *= max(0.45,exp(-2.0*shadow));
          }
        }
        gl_FragColor = vec4(color,1);
      }`,
    depthTest: false, depthWrite: false
  });
  const screen = new THREE.Scene();
  screen.add(new THREE.Mesh(new THREE.PlaneGeometry(2,2),composite));
  const screenCamera = new THREE.Camera();
  const clearColor = renderer.getClearColor(new THREE.Color());
  const clearAlpha = renderer.getClearAlpha();
  return {
    canBlend,
    resize(size) {
      nearest.setSize(size.x,size.y);
      sum?.setSize(size.x,size.y);
    },
    draw(blend, edl) {
      if (!blend && !edl) {
        renderer.render(scene,camera);
        return;
      }
      renderer.setRenderTarget(nearest);
      renderer.render(scene,camera);
      if (blend && sum) {
        renderer.setRenderTarget(sum);
        renderer.setClearColor(0,0);
        mesh.material = accumulation;
        renderer.render(scene,camera);
        mesh.material = base;
        renderer.setClearColor(clearColor,clearAlpha);
      }
      renderer.setRenderTarget(null);
      composite.uniforms.blend.value = blend && canBlend;
      composite.uniforms.edl.value = edl;
      renderer.render(screen,screenCamera);
    }
  };
}
