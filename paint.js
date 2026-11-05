// Sweep alternating rows from the foreground upward. Warping the brush path
// keeps adjacent strokes from revealing a ruler-straight seam.
export function brushStroke(points, frame) {
  const stroke = new Float32Array(points.count * 3);
  const [width,height] = frame.image_size;
  const passes = 5;
  for (let i=0;i<points.count;i++) {
    const u=points.uv[2*i]/width, v=points.uv[2*i+1]/height;
    const seed=(Math.imul(points.pointIds[i]+1,2654435761)>>>0)/4294967296;
    const level=passes*(1-v+0.045*Math.sin(8*u)+0.025*(seed-0.5));
    const row=Math.min(passes-1,Math.max(0,Math.floor(level)));
    const direction=row%2===0 ? 1 : -1;
    const along=direction===1 ? u : 1-u;
    const arrival=0.45+1.28*(row+along)+0.10*seed;
    stroke.set([arrival,0.16+0.12*seed,direction*(0.09+0.09*seed)],3*i);
  }
  return stroke;
}

// Give each target a distinct launch time. Start with individual shots,
// then accelerate the volley so even dense frames finish in ten seconds.
export function gunStroke(points) {
  const order = Uint32Array.from(points.pointIds, (_, i) => i);
  const key = i => Math.imul(points.pointIds[i], 2654435761) >>> 0;
  order.sort((a,b) => key(a)-key(b));
  const result = new Float32Array(points.count*3);
  order.forEach((i,rank) => {
    const progress = Math.sqrt(Math.max(0,rank-6)/Math.max(1,points.count-7));
    const launch = rank < 6 ? 0.08+0.32*rank : 2.0+5.8*progress;
    const flight = 0.48-0.31*progress;
    result.set([launch+flight,flight,0],3*i);
  });
  return result;
}
