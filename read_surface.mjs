/** SRF1 v1. Normals and radii are already in the same metric frame as XYZ. */
export function readSurfaceBuffer(input) {
  const v = input instanceof ArrayBuffer ? new DataView(input) : new DataView(input.buffer,input.byteOffset,input.byteLength);
  if(v.byteLength%32) throw Error('Surface length');
  const count=v.byteLength/32, pointIds=new Uint32Array(count), normals=new Float32Array(count*3), radii=new Float32Array(count), support=new Float32Array(count), flags=new Uint32Array(count);
  for(let i=0;i<count;i++) {
    const b=i*32;pointIds[i]=v.getUint32(b,true);
    for(let j=0;j<3;j++) normals[3*i+j]=v.getFloat32(b+4+j*4,true);
    radii[i]=v.getFloat32(b+16,true);support[i]=v.getFloat32(b+20,true);flags[i]=v.getUint32(b+24,true);
    const n=normals.subarray(3*i,3*i+3), valid=flags[i]&1;
    if([...n,radii[i],support[i]].some(x=>!Number.isFinite(x)) || flags[i]&~7 || v.getUint32(b+28,true) || support[i]<0 || support[i]>1) throw Error('Invalid surface record');
    if(valid ? (Math.abs(Math.hypot(...n)-1)>1e-5 || radii[i]<=0) : ([...n,radii[i],support[i]].some(x=>x!==0))) throw Error('Invalid surface normal/radius');
  }
  return {count,pointIds,normals,radii,support,flags};
}
export function readSurfacePacket(input) {
  const v=input instanceof ArrayBuffer ? new DataView(input) : new DataView(input.buffer,input.byteOffset,input.byteLength);
  if(v.byteLength<32 || String.fromCharCode(...new Uint8Array(v.buffer,v.byteOffset,4))!=='SRF1' || v.getUint16(4,true)!==1 || v.getUint16(6,true)!==32 || v.getUint32(20,true)!==32 || v.getUint32(24,true)&~1 || v.getUint32(28,true)!==0) throw Error('Invalid SRF1 header');
  const count=v.getUint32(16,true);if(v.byteLength!==32+count*32) throw Error('SRF1 count mismatch');
  return {frameId:v.getUint32(8,true),chunkIndex:v.getUint32(12,true),isLast:!!(v.getUint32(24,true)&1),...readSurfaceBuffer(new Uint8Array(v.buffer,v.byteOffset+32,count*32))};
}
