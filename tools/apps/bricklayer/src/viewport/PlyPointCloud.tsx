import React, { useEffect, useMemo, useState } from 'react';
import * as THREE from 'three';
import { readFileAtPath } from '@gseurat/project-root';

/**
 * Parse a binary PLY file into position + color arrays.
 * Supports GSeurat format (f_dc_0/1/2 SH DC) and standard RGB.
 */
function parsePlyBuffer(buffer: ArrayBuffer): { positions: Float32Array; colors: Float32Array } | null {
  const headerText = new TextDecoder().decode(new Uint8Array(buffer, 0, Math.min(4096, buffer.byteLength)));
  const headerLines = headerText.split('\n');
  let vertexCount = 0;
  const propNames: string[] = [];
  let dataStart = 0;

  for (const line of headerLines) {
    dataStart += line.length + 1;
    if (line.startsWith('element vertex')) vertexCount = parseInt(line.split(' ')[2]);
    if (line.startsWith('property float')) propNames.push(line.split(' ')[2]);
    if (line.trim() === 'end_header') break;
  }

  if (vertexCount === 0 || propNames.length === 0) return null;

  const stride = propNames.length * 4;
  const dataView = new DataView(buffer, dataStart);
  const positions = new Float32Array(vertexCount * 3);
  const colors = new Float32Array(vertexCount * 4);

  const xIdx = propNames.indexOf('x');
  const yIdx = propNames.indexOf('y');
  const zIdx = propNames.indexOf('z');
  const dcR = propNames.indexOf('f_dc_0');
  const dcG = propNames.indexOf('f_dc_1');
  const dcB = propNames.indexOf('f_dc_2');
  const rIdx = propNames.indexOf('red');
  const gIdx = propNames.indexOf('green');
  const bIdx = propNames.indexOf('blue');

  for (let i = 0; i < vertexCount; i++) {
    const off = i * stride;
    positions[i * 3] = dataView.getFloat32(off + xIdx * 4, true);
    positions[i * 3 + 1] = dataView.getFloat32(off + yIdx * 4, true);
    positions[i * 3 + 2] = dataView.getFloat32(off + zIdx * 4, true);
    if (dcR >= 0) {
      colors[i * 4] = 0.5 + 0.2820948 * dataView.getFloat32(off + dcR * 4, true);
      colors[i * 4 + 1] = 0.5 + 0.2820948 * dataView.getFloat32(off + dcG * 4, true);
      colors[i * 4 + 2] = 0.5 + 0.2820948 * dataView.getFloat32(off + dcB * 4, true);
    } else if (rIdx >= 0) {
      colors[i * 4] = dataView.getUint8(off + rIdx) / 255;
      colors[i * 4 + 1] = dataView.getUint8(off + gIdx) / 255;
      colors[i * 4 + 2] = dataView.getUint8(off + bIdx) / 255;
    } else {
      colors[i * 4] = 0.7;
      colors[i * 4 + 1] = 0.7;
      colors[i * 4 + 2] = 0.7;
    }
    colors[i * 4 + 3] = 1.0;
  }

  return { positions, colors };
}

const pointCloudMaterial = new THREE.ShaderMaterial({
  vertexShader: `
    uniform float uPointSize;
    uniform float uOpacity;
    varying vec4 vColor;
    void main() {
      vColor = vec4(color.rgb, uOpacity);
      vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
      gl_PointSize = uPointSize * (20.0 / -mvPosition.z);
      gl_Position = projectionMatrix * mvPosition;
    }
  `,
  fragmentShader: `
    varying vec4 vColor;
    void main() {
      float d = length(gl_PointCoord - vec2(0.5));
      if (d > 0.5) discard;
      gl_FragColor = vColor;
    }
  `,
  vertexColors: true,
  transparent: true,
  depthWrite: false,
});

export function PlyPointCloud({
  plyPath,
  projectHandle,
  visible,
  position,
  rotation,
  scale,
  pointSize = 1.0,
  opacity = 1.0,
}: {
  plyPath: string;
  projectHandle: FileSystemDirectoryHandle | null;
  visible: boolean;
  position?: [number, number, number];
  rotation?: [number, number, number];
  scale?: number;
  pointSize?: number;
  opacity?: number;
}) {
  const [geometry, setGeometry] = useState<THREE.BufferGeometry | null>(null);

  useEffect(() => {
    if (!plyPath || !projectHandle || !visible) return;

    let cancelled = false;
    (async () => {
      try {
        const blob = await readFileAtPath(projectHandle, plyPath);
        if (cancelled) return;
        const buffer = await blob.arrayBuffer();
        if (cancelled) return;

        const parsed = parsePlyBuffer(buffer);
        if (!parsed || cancelled) return;

        const geo = new THREE.BufferGeometry();
        geo.setAttribute('position', new THREE.BufferAttribute(parsed.positions, 3));
        geo.setAttribute('color', new THREE.BufferAttribute(parsed.colors, 4));
        setGeometry(geo);
      } catch {
        // PLY file not found — silently ignore
      }
    })();

    return () => { cancelled = true; };
  }, [plyPath, projectHandle, visible]);

  const material = useMemo(() => {
    const mat = pointCloudMaterial.clone();
    mat.uniforms.uPointSize = { value: pointSize };
    mat.uniforms.uOpacity = { value: opacity };
    return mat;
  }, [pointSize, opacity]);

  if (!visible || !geometry) return null;

  const rot = rotation
    ? [rotation[0] * Math.PI / 180, rotation[1] * Math.PI / 180, rotation[2] * Math.PI / 180] as [number, number, number]
    : undefined;

  return (
    <points
      geometry={geometry}
      material={material}
      position={position}
      rotation={rot}
      scale={scale !== undefined ? [scale, scale, scale] : undefined}
    />
  );
}
