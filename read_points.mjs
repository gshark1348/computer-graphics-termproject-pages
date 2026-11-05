/** A→B 전달 규약 v1. 외부 패키지/Three.js/HTML 의존성 없음. */
export const POINT_STRIDE = 32;

function viewOf(input) {
  if (input instanceof ArrayBuffer) return new DataView(input);
  if (ArrayBuffer.isView(input)) return new DataView(input.buffer, input.byteOffset, input.byteLength);
  throw new TypeError('ArrayBuffer or typed-array view required');
}

/** 파일/packet body를 GPU에 올리기 쉬운 분리된 typed arrays로 변환. 좌표 변환은 하지 않음. */
export function readPointBuffer(input, expectedCount) {
  const view = viewOf(input);
  if (view.byteLength % POINT_STRIDE !== 0) throw new Error('Point byte length must be a multiple of 32');
  const count = view.byteLength / POINT_STRIDE;
  if (expectedCount !== undefined && count !== expectedCount) throw new Error('Point count mismatch');
  const positions = new Float32Array(count * 3);
  const rgb = new Uint8Array(count * 3);
  const uv = new Uint16Array(count * 2);
  const disparity = new Float32Array(count);
  const confidence = new Float32Array(count);
  const pointIds = new Uint32Array(count);
  for (let i = 0; i < count; i++) {
    const base = i * POINT_STRIDE;
    for (let c = 0; c < 3; c++) {
      const xyz = view.getFloat32(base + c * 4, true);
      if (!Number.isFinite(xyz)) throw new Error(`Nonfinite coordinate at record ${i}`);
      positions[i * 3 + c] = xyz;
      rgb[i * 3 + c] = view.getUint8(base + 12 + c);
    }
    if (view.getUint8(base + 15) !== 255) throw new Error('Unsupported alpha field');
    uv[i * 2] = view.getUint16(base + 16, true);
    uv[i * 2 + 1] = view.getUint16(base + 18, true);
    disparity[i] = view.getFloat32(base + 20, true);
    confidence[i] = view.getFloat32(base + 24, true);
    pointIds[i] = view.getUint32(base + 28, true);
    if (!Number.isFinite(disparity[i]) || !Number.isFinite(confidence[i]) || confidence[i] < 0 || confidence[i] > 1) {
      throw new Error(`Invalid disparity/confidence at record ${i}`);
    }
  }
  return { count, positions, rgb, uv, disparity, confidence, pointIds };
}

/** 선택적 STP1 packet 예시 decoder. 중복 제거/서버/프레임 누적은 구현하지 않음. */
export function readPointPacket(input) {
  const view = viewOf(input);
  if (view.byteLength < 32) throw new Error('Truncated packet header');
  if (String.fromCharCode(...new Uint8Array(view.buffer, view.byteOffset, 4)) !== 'STP1') throw new Error('Bad packet magic');
  if (view.getUint16(4, true) !== 1 || view.getUint16(6, true) !== 32) throw new Error('Unsupported packet version/header');
  const frameId = view.getUint32(8, true);
  const chunkIndex = view.getUint32(12, true);
  const count = view.getUint32(16, true);
  const stride = view.getUint32(20, true);
  const flags = view.getUint32(24, true);
  if (stride !== 32 || (flags & ~1) !== 0 || view.getUint32(28, true) !== 0) throw new Error('Unsupported packet layout');
  if (view.byteLength !== 32 + count * stride) throw new Error('Packet payload length mismatch');
  const payload = new Uint8Array(view.buffer, view.byteOffset + 32, count * stride);
  return { frameId, chunkIndex, isLast: Boolean(flags & 1), ...readPointBuffer(payload, count) };
}

/** 단일 카메라의 보기용 좌표로만 변환: (X,Y,Z)→(X,-Y,-Z), 단위 m 그대로. */
export function cameraToViewer(positions) {
  if (positions.length % 3) throw new Error('XYZ array length mismatch');
  const result = new Float32Array(positions);
  for (let i = 0; i < result.length; i += 3) {
    result[i + 1] = -result[i + 1];
    result[i + 2] = -result[i + 2];
  }
  return result;
}
