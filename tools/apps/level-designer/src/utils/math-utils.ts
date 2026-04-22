// Euler angles (degrees) to quaternion [x, y, z, w]
// Uses ZYX convention (yaw-pitch-roll)
export function eulerToQuat(
  pitchDeg: number,
  yawDeg: number,
  rollDeg: number,
): [number, number, number, number] {
  const p = (pitchDeg * Math.PI) / 360; // half angle in radians
  const y = (yawDeg * Math.PI) / 360;
  const r = (rollDeg * Math.PI) / 360;

  const cp = Math.cos(p), sp = Math.sin(p);
  const cy = Math.cos(y), sy = Math.sin(y);
  const cr = Math.cos(r), sr = Math.sin(r);

  return [
    sr * cp * cy - cr * sp * sy, // x
    cr * sp * cy + sr * cp * sy, // y
    cr * cp * sy - sr * sp * cy, // z
    cr * cp * cy + sr * sp * sy, // w
  ];
}

// Quaternion [x, y, z, w] to Euler angles [pitch, yaw, roll] in degrees
export function quatToEuler(
  q: [number, number, number, number],
): [number, number, number] {
  const [x, y, z, w] = q;

  // Pitch (X-axis rotation)
  const sinP = 2 * (w * x + y * z);
  const cosP = 1 - 2 * (x * x + y * y);
  const pitch = Math.atan2(sinP, cosP);

  // Yaw (Y-axis rotation)
  const sinY = 2 * (w * y - z * x);
  const yaw = Math.abs(sinY) >= 1
    ? (Math.sign(sinY) * Math.PI) / 2
    : Math.asin(sinY);

  // Roll (Z-axis rotation)
  const sinR = 2 * (w * z + x * y);
  const cosR = 1 - 2 * (y * y + z * z);
  const roll = Math.atan2(sinR, cosR);

  return [
    (pitch * 180) / Math.PI,
    (yaw * 180) / Math.PI,
    (roll * 180) / Math.PI,
  ];
}
