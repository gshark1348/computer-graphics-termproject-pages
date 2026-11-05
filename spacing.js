// The frame UVs are rectified. Estimate once in the observation view, in metres.
export function spacingRadii(points, surface, frame) {
  const [w,h] = frame.image_size;
  const f = Math.max(frame.K_rect[0][0], frame.K_rect[1][1]);
  const fb = frame.K_rect[0][0] * frame.baseline_m;
  const {uv,positions,disparity,count} = points;
  const {radii,normals} = surface;
  const target = radii.slice();
  const grid = new Int32Array(w*h).fill(-1);
  for (let i=0;i<count;i++) grid[uv[2*i]+w*uv[2*i+1]] = i;
  const window = 8;
  const sectors = new Float64Array(4);
  for (let i=0;i<count;i++) {
    if (!radii[i] || disparity[i]<=0) continue;
    const u=uv[2*i], v=uv[2*i+1], z=fb/disparity[i], k=3*i;
    // Conservative bound on the projected extent, including off-axis magnification.
    const slope = Math.hypot((u-frame.K_rect[0][2])/frame.K_rect[0][0],
                             (v-frame.K_rect[1][2])/frame.K_rect[1][1]);
    let safePixels=window;
    sectors.fill(Infinity);
    for (let y=Math.max(0,v-window);y<=Math.min(h-1,v+window);y++) {
      for (let x=Math.max(0,u-window);x<=Math.min(w-1,u+window);x++) {
        const j=grid[y*w+x];
        if (j<0 || j===i) continue;
        const dx=x-u, dy=y-v, pixelDistance=Math.hypot(dx,dy);
        if (pixelDistance>window) continue;
        const t=3*j;
        const a=positions[t]-positions[k], b=positions[t+1]-positions[k+1], c=positions[t+2]-positions[k+2];
        const residual=Math.abs(a*normals[k]+b*normals[k+1]+c*normals[k+2]);
        // A slanted road can change depth rapidly while staying on one plane.
        if (Math.abs(disparity[j]-disparity[i])>Math.max(1,0.08*disparity[i]) &&
            residual>Math.max(0.025,0.009*z)) {
          safePixels=Math.min(safePixels,pixelDistance-0.5);
          continue;
        }
        if (!radii[j] || residual>Math.max(0.025,0.009*z)) continue;
        const agreement=normals[k]*normals[t]+normals[k+1]*normals[t+1]+normals[k+2]*normals[t+2];
        if (agreement<0.75) continue;
        const side=Math.abs(dx)>Math.abs(dy) ? (dx>0?0:1) : (dy>0?2:3);
        sectors[side]=Math.min(sectors[side],Math.hypot(a,b,c));
      }
    }
    sectors.sort();
    if (!Number.isFinite(sectors[2])) continue;
    const boundaryLimit=z*safePixels/(f*(1+slope)+safePixels);
    target[i]=Math.max(radii[i], Math.min(4*radii[i],boundaryLimit,1.15*sectors[2]));
  }
  return target;
}
