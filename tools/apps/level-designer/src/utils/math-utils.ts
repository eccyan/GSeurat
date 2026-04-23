// Euler angles (degrees) to quaternion [x, y, z, w]
// Uses YXZ convention: yaw (Y) applied first, then pitch (X), then roll (Z).
// This matches the standard game-engine convention where yaw rotates around
// the vertical Y-axis, pitch tilts around X, and roll spins around Z.
export function eulerToQuat(
  pitchDeg: number,  // X-axis rotation
  yawDeg: number,    // Y-axis rotation
  rollDeg: number,   // Z-axis rotation
): [number, number, number, number] {
  const px = (pitchDeg * Math.PI) / 360; // half angle
  const yy = (yawDeg * Math.PI) / 360;
  const rz = (rollDeg * Math.PI) / 360;

  const cx = Math.cos(px), sx = Math.sin(px);
  const cy = Math.cos(yy), sy = Math.sin(yy);
  const cz = Math.cos(rz), sz = Math.sin(rz);

  // Quaternion product: Qy * Qx * Qz
  return [
    cy * sx * cz + sy * cx * sz,  // x
    sy * cx * cz - cy * sx * sz,  // y
    cy * cx * sz - sy * sx * cz,  // z
    cy * cx * cz + sy * sx * sz,  // w
  ];
}

// Quaternion [x, y, z, w] to Euler angles [pitch, yaw, roll] in degrees
// Inverse of eulerToQuat — uses YXZ decomposition.
export function quatToEuler(
  q: [number, number, number, number],
): [number, number, number] {
  const [x, y, z, w] = q;

  // Pitch (X-axis rotation) — extracted from the YXZ matrix sin(pitch) element
  const sinP = 2 * (w * x - y * z);
  const pitch = Math.abs(sinP) >= 1
    ? (Math.sign(sinP) * Math.PI) / 2
    : Math.asin(sinP);

  // Yaw (Y-axis rotation)
  const sinYcosP = 2 * (w * y + x * z);
  const cosYcosP = 1 - 2 * (x * x + y * y);
  const yaw = Math.atan2(sinYcosP, cosYcosP);

  // Roll (Z-axis rotation)
  const sinRcosP = 2 * (w * z + x * y);
  const cosRcosP = 1 - 2 * (x * x + z * z);
  const roll = Math.atan2(sinRcosP, cosRcosP);

  return [
    (pitch * 180) / Math.PI,
    (yaw * 180) / Math.PI,
    (roll * 180) / Math.PI,
  ];
}
