import * as THREE from 'three';
import {cameraToViewer} from './read_points.mjs';

const shotPath = `
  vec3 projectile(vec3 origin, vec3 targetPoint, float t) {
    return mix(origin,targetPoint,t)+vec3(0.0,1.4*t*(1.0-t),0.0);
  }`;

// Geometry is a metric disc in the tangent plane. Invalid normals use a screen-space dot.
export function createSplats(points, surface, landingTimes, spacing = surface.radii, stroke = new Float32Array(points.count*3)) {
  if (points.count !== surface.count || landingTimes.length !== points.count ||
      points.pointIds.some((id, i) => id !== surface.pointIds[i])) {
    throw Error('점과 표면 데이터의 개수 또는 point_id가 일치하지 않습니다.');
  }
  const geometry = new THREE.InstancedBufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute([-1,-1,0, 1,-1,0, -1,1,0, 1,1,0], 3));
  geometry.setIndex([0,1,2, 2,1,3]);
  geometry.instanceCount = points.count;
  function attribute(name, data, size, normalized = false) {
    geometry.setAttribute(name, new THREE.InstancedBufferAttribute(data, size, normalized));
  }
  attribute('stroke',stroke,3);
  attribute('center', cameraToViewer(points.positions), 3);
  attribute('surfaceNormal', cameraToViewer(surface.normals), 3);
  attribute('radius', surface.radii, 1);
  attribute('spacingRadius', spacing, 1);
  attribute('pigment', points.rgb, 3, true);
  attribute('landedAt', landingTimes, 1);
  const material = new THREE.ShaderMaterial({
    side: THREE.DoubleSide,
    uniforms: {target: {value:new THREE.Vector3()}, planeNormal:{value:new THREE.Vector3()},
      shadowOn:{value:true}, lightDir:{value:new THREE.Vector3()}, gun: {value: false}, muzzle: {value: new THREE.Vector3()}, paint: {value: false}, spacingStrength: {value: 0}, radiusScale: {value: 1}, mode: {value: 3}, seconds: {value: 0}, viewport: {value: new THREE.Vector2()}},
    vertexShader: `
      attribute vec3 stroke;
      attribute float hero;
      ${shotPath}
      uniform bool paint, gun;
      uniform vec3 muzzle;
      uniform float seconds;
      attribute vec3 center, surfaceNormal, pigment;
      attribute float radius, landedAt;
      uniform int mode;
      uniform vec2 viewport;
      uniform float radiusScale, spacingStrength;
      attribute float spacingRadius;
      varying vec2 disc;
      varying vec3 rgb, n, eye;
      varying float valid, arrival, ink;
      void main() {
        disc = position.xy;
        rgb = pigment;
        arrival = landedAt;
        valid = float(radius > 0.0);
        vec3 p = center;
        ink = float(paint && stroke.y > 0.0);
        bool flying = false;
        float spread = 1.0;
        if (ink > 0.5) {
          arrival = stroke.x;
          float age = seconds-arrival;
          float t = 1.0+age/stroke.y;
          if (t < 0.0) { gl_Position = vec4(2,2,2,1); return; }
          flying = age < 0.0;
          if (flying) {
            if (gun) {
              p = projectile(muzzle, center, t);
              rgb = mix(rgb,vec3(1.0,0.78,0.42),0.45);
            } else p += vec3(-stroke.z*(1.0-t), (1.0-t)*0.08+0.24*t*(1.0-t),0.0);
            valid = 0.0;
          } else if (gun) {
            spread = (hero>0.5 ? 2.0 : 1.0)*(0.45 + 2.15*smoothstep(0.0,0.10,age)
                          - 1.60*smoothstep(0.10,0.48,age));
          } else {
            spread = 0.30 + 0.98*smoothstep(0.0,0.18,age)
                          - 0.28*smoothstep(0.18,0.48,age);
          }
        }
        if (!flying && mode != 0 && radius > 0.0) {
          vec3 normalDir = normalize(surfaceNormal);
          vec3 axis = abs(normalDir.y) < 0.9 ? vec3(0,1,0) : vec3(1,0,0);
          vec3 tangent = normalize(cross(axis,normalDir));
          p += spread * mix(radiusScale * radius, spacingRadius, spacingStrength) * (disc.x*tangent + disc.y*cross(normalDir,tangent));
        }
        eye = cameraPosition - p;
        n = surfaceNormal;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(p,1);
        if (flying || mode == 0 || radius == 0.0)
          gl_Position.xy += disc * (flying ? (gun ? (hero>0.5 ? 17.0 : 6.0) : 2.0) : (gun && ink > 0.5 ? 2.5*spread : 2.5)) / viewport * gl_Position.w;
      }`,
    fragmentShader: `
      ${shotPath}
      uniform bool paint, gun, shadowOn;
      uniform vec3 muzzle,target,planeNormal,lightDir;
      uniform int mode;
      uniform float seconds;
      varying vec2 disc;
      varying vec3 rgb, n, eye;
      varying float valid, arrival, ink;
      void main() {
        if (dot(disc,disc) > 1.0) discard;
        vec3 color = rgb;
        if (valid > 0.5 && mode == 1) color = normalize(n)*0.5+0.5;
        if (valid > 0.5 && mode == 3) {
          vec3 N = normalize(n);
          vec3 L = lightDir;
          float diffuse = max(dot(N,L),0.0);
          float wet = step(arrival,seconds)*(1.0-smoothstep(0.0,3.0,seconds-arrival));
          vec3 H = normalize(L+normalize(eye));
          float shine = diffuse > 0.0 ? pow(max(dot(N,H),0.0),mix(8.0,64.0,wet)) : 0.0;
          vec3 linearRGB = pow(rgb,vec3(2.2))*(0.34+0.8*diffuse) + shine*mix(0.03,0.7,wet);
          if (ink > 0.5) {
            float grazing = pow(1.0-clamp(dot(N,normalize(eye)),0.0,1.0),3.0);
            linearRGB += vec3(0.45,0.58,0.65)*wet*grazing;
          }
          color = pow(linearRGB,vec3(1.0/2.2));
        }
        if (shadowOn && paint && gun && valid>0.5 && seconds>=8.1 && seconds<=9.5) {
          float incidence=dot(planeNormal,lightDir);
          if (incidence>0.05 && dot(n,planeNormal)>0.75) {
            float t=clamp((seconds-8.1)/1.4,0.0,1.0);
            vec3 ball=projectile(muzzle,target,t);
            float travel=dot(ball-target,planeNormal)/incidence;
            vec3 hit=ball-travel*lightDir;
            vec3 delta=(cameraPosition-eye)-hit;
            float height=dot(delta,planeNormal);
            if (travel>=0.0 && abs(height)<0.18) {
              float distanceOnPlane=length(delta-height*planeNormal);
              float softness=0.045+min(travel*0.085,0.18);
              color*=mix(0.25,1.0,smoothstep(0.13,0.13+softness,distanceOnPlane));
            }
          }
        }
        gl_FragColor = vec4(color,1);
      }`
  });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.frustumCulled = false; // The base quad bounds exclude instance centers.
  return mesh;
}
