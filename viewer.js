import * as THREE from 'three';
import {OrbitControls} from './vendor/three/OrbitControls.js';
import {readPointBuffer} from './read_points.mjs';
import {readSurfaceBuffer} from './read_surface.mjs';
import {createSplats} from './splats.js';

import {createEffects} from './effects.js';

import {spacingRadii} from './spacing.js';

import {brushStroke, gunStroke} from './paint.js';

const element = id => document.getElementById(id);
async function load(name, type) {
  const result = await fetch('./data/' + name);
  if (!result.ok) throw Error(name + ' 로드 실패 (' + result.status + ')');
  return result[type]();
}
async function start() {
  const [frame, pointBytes, surfaceBytes] = await Promise.all([
    load('frame.json','json'), load('new_points.bin','arrayBuffer'), load('surface.bin','arrayBuffer')
  ]);
  const points = readPointBuffer(pointBytes,frame.point_count);
  const surface = readSurfaceBuffer(surfaceBytes);
  const [width,height] = frame.image_size;
  const times = Float32Array.from(points.pointIds, (_,i) => 5*points.uv[2*i]/width);
  const brush = brushStroke(points,frame);
  const shots = gunStroke(points);
  const mesh = createSplats(points,surface,times,spacingRadii(points,surface,frame),brush);
  // Reserve a single last shot on bright, nearly horizontal foreground road.
  let hero = -1, best = Infinity;
  for (let i=0;i<points.count;i++) {
    if (surface.normals[3*i+1] > -0.93 || points.rgb[3*i]<105) continue;
    const score = Math.hypot(points.uv[2*i]/width-0.54, points.uv[2*i+1]/height-0.84);
    if (score<best) { best=score; hero=i; }
  }
  const heroFlags = new Float32Array(points.count);
  if (hero>=0) {
    heroFlags[hero]=1;
    shots.set([9.5,1.4,0],3*hero);
  }
  mesh.geometry.setAttribute('hero',new THREE.InstancedBufferAttribute(heroFlags,1));
  const scene = new THREE.Scene();
  scene.add(mesh);
  const canvas = document.querySelector('canvas');
  const renderer = new THREE.WebGLRenderer({canvas,antialias:true});
  renderer.setPixelRatio(Math.min(devicePixelRatio,2));
  renderer.setClearColor(0x0b1014);
  const K = frame.K_rect;
  const camera = new THREE.PerspectiveCamera(THREE.MathUtils.radToDeg(2*Math.atan(height/(2*K[1][1]))),width/height,0.05,2000);
  const projection = camera.projectionMatrix.elements;
  projection[0] = 2*K[0][0]/width;
  projection[8] = 1-2*(K[0][2]+0.5)/width;
  projection[9] = 2*(K[1][2]+0.5)/height-1;
  camera.projectionMatrixInverse.copy(camera.projectionMatrix).invert();
  const flip = new THREE.Matrix4().makeScale(1,-1,-1);
  const pose = new THREE.Matrix4().fromArray(frame.T_world_from_observation_camera_column_major);
  pose.premultiply(flip).multiply(flip).decompose(camera.position,camera.quaternion,camera.scale);
  camera.up.applyQuaternion(camera.quaternion);
  const initialTarget = camera.getWorldDirection(new THREE.Vector3()).multiplyScalar(12).add(camera.position);
  const controls = new OrbitControls(camera,canvas);
  controls.target.copy(initialTarget);
  controls.update();
  controls.saveState();
  element('reset').onclick = () => controls.reset();
  const uniforms = mesh.material.uniforms;
  if (hero>=0) {
    uniforms.target.value.fromBufferAttribute(mesh.geometry.attributes.center,hero);
    uniforms.planeNormal.value.fromBufferAttribute(mesh.geometry.attributes.surfaceNormal,hero);
  }
  element('shadow').onchange = e => { uniforms.shadowOn.value=e.target.checked; };
  element('shadowDemo').disabled = hero<0;
  element('shadowDemo').onclick = () => {
    element('style').value='gun';
    element('style').dispatchEvent(new Event('change'));
    seek(9.27);
  };
  uniforms.muzzle.value.set(0.64,-0.20,-1.0).applyMatrix4(pose);
  element('style').onchange = e => {
    uniforms.gun.value = e.target.value === 'gun';
    const stroke = mesh.geometry.getAttribute('stroke');
    stroke.array = uniforms.gun.value ? shots : brush;
    stroke.needsUpdate = true;
    element('paint').checked = true;
    element('paint').onchange({target: element('paint')});
  };
  element('mode').onchange = e => { uniforms.mode.value = Number(e.target.value); };
  const effects = createEffects(renderer, scene, camera, mesh);
  const expand = element('expand'), scale = element('scale');
  function updateScale() {
    const adaptive = element('adaptive').checked;
    expand.disabled = adaptive;
    scale.disabled = adaptive || !expand.checked;
    element('strength').disabled = !adaptive;
    const strength = Number(element('strength').value);
    uniforms.spacingStrength.value = adaptive ? strength/100 : 0;
    element('amount').value = strength+'%';
    uniforms.radiusScale.value = expand.checked && !adaptive ? Number(scale.value) : 1;
    element('factor').value = Number(scale.value).toFixed(1)+'×';
  }
  expand.onchange = scale.oninput = element('adaptive').onchange = element('strength').oninput = updateScale;
  updateScale();
  if (!effects.canBlend) {
    element('blend').disabled = true;
    element('blend').parentElement.title = '이 장치에서는 부동소수점 렌더 타깃을 지원하지 않습니다.';
  }
  const resize = () => {
    const w = canvas.clientWidth;
    renderer.setSize(w,Math.round(w*height/width),false);
    canvas.style.height = Math.round(w*height/width)+'px';
    renderer.getDrawingBufferSize(uniforms.viewport.value);
    effects.resize(uniforms.viewport.value);
  };
  new ResizeObserver(resize).observe(canvas);
  resize();
  let playing = true;
  element('play').onclick = () => {
    if (!playing && uniforms.paint.value && uniforms.seconds.value >= 10) uniforms.seconds.value = 0;
    playing = !playing;
    element('play').textContent = playing ? '일시정지' : '재생';
  };
  function seek(t) {
    playing = false;
    element('play').textContent = '재생';
    uniforms.seconds.value = t;
  }
  element('time').oninput = e => seek(Number(e.target.value));
  element('paint').onchange = e => {
    uniforms.paint.value = e.target.checked;
    if (e.target.checked) {
      uniforms.seconds.value = 0;
      element('mode').value = '3';
      uniforms.mode.value = 3;
      playing = true;
      element('play').textContent = '일시정지';
    }
  };
  for (const button of document.querySelectorAll('[data-time]')) {
    button.onclick = () => {
      element('paint').checked = uniforms.paint.value = true;
      element('mode').value = '3';
      uniforms.mode.value = 3;
      seek(Number(button.dataset.time));
    };
  }
  let last = performance.now();
  renderer.setAnimationLoop(now => {
    if (playing) {
      const t = uniforms.seconds.value+Math.max(0,now-last)/1000;
      if (uniforms.paint.value && t >= 10) seek(10);
      else uniforms.seconds.value = t%10;
    }
    last = now;
    element('time').value = uniforms.seconds.value;
    element('clock').value = uniforms.seconds.value.toFixed(2)+'초';
    const phase=uniforms.seconds.value*0.6283185+Number(element('lightOffset').value)*Math.PI/180;
    uniforms.lightDir.value.set(1.6*Math.sin(phase),0.7,1).normalize();
    effects.draw(element('blend').checked, element('edl').checked);
  });
  element('status').textContent = '점 '+points.count.toLocaleString()+'개 · 유효 법선 '+surface.radii.reduce((sum,r)=>sum+Number(r>0),0).toLocaleString()+'개';
}
start().catch(error => { element('status').textContent = error.message; console.error(error); });
