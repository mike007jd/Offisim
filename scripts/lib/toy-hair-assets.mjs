import { mkdir, readdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { deflateSync } from 'node:zlib';
import { Document, Logger } from '@gltf-transform/core';
import { dedup, meshopt } from '@gltf-transform/functions';
import { MeshoptEncoder } from 'meshoptimizer';

export const HAIR_STYLE_ENTRIES = [
  { style: 'short', asset: 'hair_01', label: 'Short crop' },
  { style: 'long', asset: 'hair_02', label: 'Long drape' },
  { style: 'ponytail', asset: 'hair_03', label: 'Ponytail' },
  { style: 'curly', asset: 'hair_04', label: 'Curly halo' },
  { style: 'bald', asset: null, label: 'Bald' },
  { style: 'bob', asset: 'hair_05', label: 'Helmet bob' },
  { style: 'spiky', asset: 'hair_06', label: 'Spiky crop' },
  { style: 'braids', asset: 'hair_07', label: 'Twin braids' },
  { style: 'bun', asset: 'hair_08', label: 'High bun' },
  { style: 'afro', asset: 'hair_09', label: 'Afro' },
  { style: 'mohawk', asset: 'hair_10', label: 'Mohawk' },
  { style: 'sidepart', asset: 'hair_11', label: 'Side part' },
  { style: 'undercut', asset: 'hair_12', label: 'Undercut' },
];

export const HAIR_ASSET_IDS = HAIR_STYLE_ENTRIES.flatMap((entry) =>
  entry.asset ? [entry.asset] : [],
);

export const HAIR_ASSET_LABELS = Object.fromEntries(
  HAIR_STYLE_ENTRIES.flatMap((entry) =>
    entry.asset ? [[entry.asset, `offisim-procedural:${entry.style}`]] : [],
  ),
);

const HEAD_RADII = [0.3745, 0.4115, 0.3662];
const AUTHORED_HAIR_COLOR = [0.72, 0.72, 0.72, 1];

const add3 = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const subtract3 = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const scale3 = (value, scalar) => value.map((component) => component * scalar);
const dot3 = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross3 = (a, b) => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
const length3 = (value) => Math.hypot(...value);
const normalize3 = (value) => {
  const length = length3(value);
  if (length <= Number.EPSILON) throw new Error('Cannot normalize a zero-length vector');
  return scale3(value, 1 / length);
};

function createGeometry() {
  return { positions: [], normals: [], indices: [] };
}

function pushVertex(geometry, position, normal) {
  const index = geometry.positions.length / 3;
  geometry.positions.push(...position);
  geometry.normals.push(...normalize3(normal));
  return index;
}

function addEllipsoid(geometry, center, radii, latSegments = 8, lonSegments = 12) {
  const first = geometry.positions.length / 3;
  for (let lat = 0; lat <= latSegments; lat += 1) {
    const phi = (lat / latSegments) * Math.PI;
    const sinPhi = Math.sin(phi);
    const cosPhi = Math.cos(phi);
    for (let lon = 0; lon <= lonSegments; lon += 1) {
      const theta = (lon / lonSegments) * Math.PI * 2;
      const local = [sinPhi * Math.cos(theta), cosPhi, sinPhi * Math.sin(theta)];
      pushVertex(
        geometry,
        [
          center[0] + local[0] * radii[0],
          center[1] + local[1] * radii[1],
          center[2] + local[2] * radii[2],
        ],
        [local[0] / radii[0], local[1] / radii[1], local[2] / radii[2]],
      );
    }
  }
  const row = lonSegments + 1;
  for (let lat = 0; lat < latSegments; lat += 1) {
    for (let lon = 0; lon < lonSegments; lon += 1) {
      const a = first + lat * row + lon;
      const b = a + row;
      geometry.indices.push(a, a + 1, b, a + 1, b + 1, b);
    }
  }
}

function addCapsule(geometry, start, end, radius, radialSegments = 9) {
  const axis = normalize3(subtract3(end, start));
  const reference = Math.abs(dot3(axis, [0, 0, 1])) < 0.92 ? [0, 0, 1] : [1, 0, 0];
  const basisX = normalize3(cross3(reference, axis));
  const basisZ = normalize3(cross3(axis, basisX));
  const center = scale3(add3(start, end), 0.5);
  const halfCylinder = length3(subtract3(end, start)) / 2;
  const rings = [];
  for (let step = 0; step <= 3; step += 1) {
    const angle = -Math.PI / 2 + (step / 3) * (Math.PI / 2);
    rings.push({
      y: -halfCylinder + Math.sin(angle) * radius,
      r: Math.cos(angle) * radius,
      ny: Math.sin(angle),
      nr: Math.cos(angle),
    });
  }
  for (let step = 1; step <= 3; step += 1) {
    const angle = (step / 3) * (Math.PI / 2);
    rings.push({
      y: halfCylinder + Math.sin(angle) * radius,
      r: Math.cos(angle) * radius,
      ny: Math.sin(angle),
      nr: Math.cos(angle),
    });
  }
  const first = geometry.positions.length / 3;
  for (const ring of rings) {
    for (let segment = 0; segment <= radialSegments; segment += 1) {
      const theta = (segment / radialSegments) * Math.PI * 2;
      const radial = add3(scale3(basisX, Math.cos(theta)), scale3(basisZ, Math.sin(theta)));
      pushVertex(
        geometry,
        add3(center, add3(scale3(axis, ring.y), scale3(radial, ring.r))),
        add3(scale3(axis, ring.ny), scale3(radial, ring.nr)),
      );
    }
  }
  const row = radialSegments + 1;
  for (let ring = 0; ring < rings.length - 1; ring += 1) {
    for (let segment = 0; segment < radialSegments; segment += 1) {
      const a = first + ring * row + segment;
      const b = a + row;
      geometry.indices.push(a, a + 1, b, a + 1, b + 1, b);
    }
  }
}

function addShell(geometry, center = [0, 0.13, -0.03], radii = [0.402, 0.4, 0.392]) {
  addEllipsoid(geometry, center, radii, 10, 14);
}

function addFringe(geometry, lobes = [-0.21, 0, 0.21], y = 0.2, z = 0.295) {
  for (const x of lobes) addEllipsoid(geometry, [x, y, z], [0.15, 0.09, 0.1], 6, 9);
}

function addTriangle(geometry, a, b, c) {
  const normal = cross3(subtract3(b, a), subtract3(c, a));
  const first = pushVertex(geometry, a, normal);
  pushVertex(geometry, b, normal);
  pushVertex(geometry, c, normal);
  geometry.indices.push(first, first + 1, first + 2);
}

function addMohawkFin(geometry, zFront, zBack, height, halfWidth = 0.105) {
  const baseY = 0.29;
  const zPeak = (zFront + zBack) / 2;
  const leftFront = [-halfWidth, baseY, zFront];
  const rightFront = [halfWidth, baseY, zFront];
  const leftBack = [-halfWidth, baseY, zBack];
  const rightBack = [halfWidth, baseY, zBack];
  const peak = [0, baseY + height, zPeak];

  addTriangle(geometry, leftFront, rightFront, peak);
  addTriangle(geometry, rightFront, rightBack, peak);
  addTriangle(geometry, rightBack, leftBack, peak);
  addTriangle(geometry, leftBack, leftFront, peak);
  addTriangle(geometry, leftFront, leftBack, rightBack);
  addTriangle(geometry, leftFront, rightBack, rightFront);
}

const BUILDERS = {
  hair_01(geometry) {
    addShell(geometry, [0, 0.13, -0.03], [0.4, 0.385, 0.39]);
    addFringe(geometry);
    addEllipsoid(geometry, [-0.36, 0.02, 0.05], [0.09, 0.14, 0.13], 6, 9);
    addEllipsoid(geometry, [0.36, 0.02, 0.05], [0.09, 0.14, 0.13], 6, 9);
  },
  hair_02(geometry) {
    addShell(geometry);
    addFringe(geometry);
    addEllipsoid(geometry, [0, -0.16, -0.3], [0.34, 0.44, 0.15], 8, 12);
    addEllipsoid(geometry, [-0.32, -0.08, 0.02], [0.11, 0.36, 0.16], 6, 9);
    addEllipsoid(geometry, [0.32, -0.08, 0.02], [0.11, 0.36, 0.16], 6, 9);
  },
  hair_03(geometry) {
    addShell(geometry);
    addFringe(geometry);
    addEllipsoid(geometry, [0.08, 0.3, -0.37], [0.13, 0.13, 0.13], 6, 9);
    addCapsule(geometry, [0.08, 0.27, -0.43], [0.18, -0.13, -0.62], 0.14, 9);
    addEllipsoid(geometry, [0.2, -0.22, -0.65], [0.13, 0.18, 0.13], 6, 9);
  },
  hair_04(geometry) {
    addShell(geometry, [0, 0.12, -0.04], [0.41, 0.39, 0.4]);
    const curls = [
      [-0.23, 0.28, 0.23],
      [0, 0.3, 0.27],
      [0.23, 0.28, 0.23],
      [-0.34, 0.12, 0.13],
      [0.34, 0.12, 0.13],
      [-0.2, 0.4, -0.02],
      [0.2, 0.4, -0.02],
      [0, 0.43, -0.12],
      [-0.22, 0.24, -0.31],
      [0.22, 0.24, -0.31],
    ];
    for (const center of curls) addEllipsoid(geometry, center, [0.14, 0.13, 0.14], 6, 9);
  },
  hair_05(geometry) {
    addShell(geometry, [0, 0.04, -0.06], [0.42, 0.43, 0.395]);
    addFringe(geometry, [-0.18, 0, 0.18], 0.22, 0.27);
  },
  hair_06(geometry) {
    addShell(geometry, [0, 0.13, -0.03], [0.398, 0.385, 0.388]);
    addFringe(geometry, [-0.24, 0, 0.24], 0.19, 0.285);
    for (const center of [
      [-0.26, 0.32, -0.04],
      [-0.09, 0.42, 0],
      [0.09, 0.42, 0],
      [0.26, 0.32, -0.04],
      [-0.17, 0.36, -0.2],
      [0.17, 0.36, -0.2],
      [0, 0.38, -0.24],
    ])
      addEllipsoid(geometry, center, [0.075, 0.24, 0.075], 3, 5);
  },
  hair_07(geometry) {
    addShell(geometry, [0, 0.12, -0.04], [0.405, 0.39, 0.392]);
    addFringe(geometry, [-0.2, 0, 0.2], 0.21, 0.285);
    for (const side of [-1, 1]) {
      const x = side * 0.3;
      addCapsule(geometry, [x, 0.1, -0.15], [side * 0.32, -0.18, -0.14], 0.085, 7);
      addCapsule(geometry, [side * 0.32, -0.18, -0.14], [side * 0.27, -0.5, -0.08], 0.072, 7);
      addEllipsoid(geometry, [side * 0.27, -0.53, -0.08], [0.075, 0.09, 0.075], 5, 7);
    }
  },
  hair_08(geometry) {
    addShell(geometry, [0, 0.12, -0.04], [0.405, 0.39, 0.392]);
    addFringe(geometry, [-0.2, 0, 0.2], 0.2, 0.285);
    addEllipsoid(geometry, [0, 0.48, -0.16], [0.22, 0.22, 0.2], 8, 12);
    addEllipsoid(geometry, [0, 0.36, -0.22], [0.13, 0.12, 0.11], 6, 9);
  },
  hair_09(geometry) {
    addShell(geometry, [0, 0.2, -0.11], [0.43, 0.34, 0.35]);
    for (const center of [
      [-0.27, 0.32, 0.13],
      [0, 0.34, 0.18],
      [0.27, 0.32, 0.13],
      [-0.4, 0.34, -0.03],
      [0.4, 0.34, -0.03],
      [-0.27, 0.47, -0.05],
      [0, 0.51, -0.08],
      [0.27, 0.47, -0.05],
      [-0.22, 0.38, -0.29],
      [0.22, 0.38, -0.29],
      [0, 0.42, -0.35],
    ])
      addEllipsoid(geometry, center, [0.15, 0.14, 0.15], 6, 9);
  },
  hair_10(geometry) {
    addShell(geometry, [0, 0.1, -0.04], [0.4, 0.36, 0.39]);
    const fins = [
      [0.36, 0.2, 0.18],
      [0.2, 0.04, 0.29],
      [0.04, -0.13, 0.39],
      [-0.13, -0.3, 0.31],
      [-0.3, -0.42, 0.2],
    ];
    for (const [zFront, zBack, height] of fins) addMohawkFin(geometry, zFront, zBack, height);
  },
  hair_11(geometry) {
    addShell(geometry, [0, 0.12, -0.04], [0.405, 0.39, 0.39]);
    addEllipsoid(geometry, [-0.18, 0.27, 0.27], [0.24, 0.12, 0.11], 6, 9);
    addEllipsoid(geometry, [0.08, 0.3, 0.25], [0.25, 0.11, 0.1], 6, 9);
    addEllipsoid(geometry, [0.31, 0.17, 0.18], [0.13, 0.18, 0.13], 6, 9);
  },
  hair_12(geometry) {
    addShell(geometry, [0, 0.06, -0.07], [0.395, 0.33, 0.375]);
    addEllipsoid(geometry, [-0.17, 0.31, 0.06], [0.25, 0.16, 0.19], 7, 10);
    addCapsule(geometry, [-0.19, 0.34, 0.03], [0.24, 0.4, -0.03], 0.15, 9);
    addEllipsoid(geometry, [0.28, 0.34, -0.06], [0.2, 0.16, 0.18], 7, 10);
    addEllipsoid(geometry, [-0.15, 0.25, 0.27], [0.22, 0.1, 0.1], 6, 9);
    addEllipsoid(geometry, [0.16, 0.28, 0.24], [0.25, 0.11, 0.1], 6, 9);
  },
};

export function createHairGeometry(assetId) {
  const builder = BUILDERS[assetId];
  if (!builder) throw new Error(`No authored hair builder for ${assetId}`);
  const geometry = createGeometry();
  builder(geometry);
  return geometry;
}

function createStaticAccessors(document, buffer, name, geometry) {
  const vertexCount = geometry.positions.length / 3;
  const indexArray =
    vertexCount > 65535 ? new Uint32Array(geometry.indices) : new Uint16Array(geometry.indices);
  return {
    position: document
      .createAccessor(`${name}_POSITION`)
      .setType('VEC3')
      .setArray(new Float32Array(geometry.positions))
      .setBuffer(buffer),
    normal: document
      .createAccessor(`${name}_NORMAL`)
      .setType('VEC3')
      .setArray(new Float32Array(geometry.normals))
      .setBuffer(buffer),
    indices: document
      .createAccessor(`${name}_INDICES`)
      .setType('SCALAR')
      .setArray(indexArray)
      .setBuffer(buffer),
  };
}

async function writeHairAsset(io, outDir, assetId) {
  const document = new Document();
  document.setLogger(new Logger(Logger.Verbosity.WARN));
  const buffer = document.createBuffer();
  const scene = document.createScene(assetId);
  document.getRoot().setDefaultScene(scene);
  const geometry = createHairGeometry(assetId);
  const accessors = createStaticAccessors(document, buffer, assetId, geometry);
  const material = document
    .createMaterial('Hair')
    .setBaseColorFactor(AUTHORED_HAIR_COLOR)
    .setMetallicFactor(0)
    .setRoughnessFactor(1);
  const primitive = document
    .createPrimitive()
    .setAttribute('POSITION', accessors.position)
    .setAttribute('NORMAL', accessors.normal)
    .setIndices(accessors.indices)
    .setMaterial(material);
  scene.addChild(
    document.createNode(assetId).setMesh(document.createMesh(assetId).addPrimitive(primitive)),
  );
  await document.transform(dedup(), meshopt({ encoder: MeshoptEncoder, level: 'medium' }));
  await io.write(join(outDir, `${assetId}.glb`), document);
  return geometry;
}

export async function buildToyHairAssets({ io, outDir, manifest }) {
  await MeshoptEncoder.ready;
  const geometries = new Map();
  for (const assetId of HAIR_ASSET_IDS) {
    console.log(`building ${assetId}.glb (${HAIR_ASSET_LABELS[assetId]})`);
    geometries.set(assetId, await writeHairAsset(io, outDir, assetId));
    if (manifest) manifest.hair[assetId] = HAIR_ASSET_LABELS[assetId];
  }
  return geometries;
}

function vertexAt(values, index) {
  return values.slice(index * 3, index * 3 + 3);
}

function validateFit(geometry) {
  const vertices = geometry.positions.length / 3;
  const points = Array.from({ length: vertices }, (_, index) =>
    vertexAt(geometry.positions, index),
  );
  const min = [0, 1, 2].map((axis) => Math.min(...points.map((point) => point[axis])));
  const max = [0, 1, 2].map((axis) => Math.max(...points.map((point) => point[axis])));
  let exterior = 0;
  let hairline = 0;
  let eyeBandZMax = Number.NEGATIVE_INFINITY;
  for (const point of points) {
    const q =
      (point[0] / HEAD_RADII[0]) ** 2 +
      (point[1] / HEAD_RADII[1]) ** 2 +
      (point[2] / HEAD_RADII[2]) ** 2;
    if (q > 1.03) exterior += 1;
    if (point[1] < 0.13) eyeBandZMax = Math.max(eyeBandZMax, point[2]);
    if (q > 1.02 && point[1] >= 0.14 && point[1] <= 0.34 && point[2] > 0.24) hairline += 1;
  }
  const width = max[0] - min[0];
  const exteriorRatio = exterior / vertices;
  const valid =
    width >= HEAD_RADII[0] * 2 * 0.82 &&
    max[1] >= HEAD_RADII[1] * 0.92 &&
    min[1] <= HEAD_RADII[1] * 0.8 &&
    min[2] <= -HEAD_RADII[2] * 0.65 &&
    eyeBandZMax <= 0.37 &&
    max[2] <= 0.46 &&
    exteriorRatio >= 0.5 &&
    hairline >= 8;
  return {
    valid,
    vertices,
    triangles: geometry.indices.length / 3,
    min,
    max,
    exteriorRatio,
    hairline,
    eyeBandZMax,
  };
}

function transformPoint(point, yaw) {
  const cos = Math.cos(yaw);
  const sin = Math.sin(yaw);
  const x = point[0] * cos + point[2] * sin;
  const z = point[2] * cos - point[0] * sin;
  return { x: 256 + x * 360, y: 244 - point[1] * 360, z };
}

function renderGeometry(pixels, zBuffer, geometry, baseColor, yaw) {
  const light = normalize3([-0.35, 0.7, 0.62]);
  for (let offset = 0; offset < geometry.indices.length; offset += 3) {
    const ids = geometry.indices.slice(offset, offset + 3);
    const world = ids.map((index) => vertexAt(geometry.positions, index));
    const projected = world.map((point) => transformPoint(point, yaw));
    const faceNormal = cross3(subtract3(world[1], world[0]), subtract3(world[2], world[0]));
    if (length3(faceNormal) <= 1e-8) continue;
    const normal = normalize3(faceNormal);
    const intensity = 0.52 + 0.48 * Math.max(0, dot3(normal, light));
    const color = baseColor.map((channel) => Math.round(channel * intensity));
    const minX = Math.max(0, Math.floor(Math.min(...projected.map((point) => point.x))));
    const maxX = Math.min(511, Math.ceil(Math.max(...projected.map((point) => point.x))));
    const minY = Math.max(0, Math.floor(Math.min(...projected.map((point) => point.y))));
    const maxY = Math.min(511, Math.ceil(Math.max(...projected.map((point) => point.y))));
    const [a, b, c] = projected;
    const denom = (b.y - c.y) * (a.x - c.x) + (c.x - b.x) * (a.y - c.y);
    if (Math.abs(denom) < 1e-8) continue;
    for (let y = minY; y <= maxY; y += 1) {
      for (let x = minX; x <= maxX; x += 1) {
        const w1 = ((b.y - c.y) * (x - c.x) + (c.x - b.x) * (y - c.y)) / denom;
        const w2 = ((c.y - a.y) * (x - c.x) + (a.x - c.x) * (y - c.y)) / denom;
        const w3 = 1 - w1 - w2;
        if (w1 < 0 || w2 < 0 || w3 < 0) continue;
        const depth = w1 * a.z + w2 * b.z + w3 * c.z;
        const pixelIndex = y * 512 + x;
        if (depth <= zBuffer[pixelIndex]) continue;
        zBuffer[pixelIndex] = depth;
        const rgbaIndex = pixelIndex * 4;
        pixels[rgbaIndex] = color[0];
        pixels[rgbaIndex + 1] = color[1];
        pixels[rgbaIndex + 2] = color[2];
        pixels[rgbaIndex + 3] = 255;
      }
    }
  }
}

function drawEye(pixels, zBuffer, point, yaw) {
  const center = transformPoint(point, yaw);
  for (let y = Math.floor(center.y - 9); y <= Math.ceil(center.y + 9); y += 1) {
    for (let x = Math.floor(center.x - 7); x <= Math.ceil(center.x + 7); x += 1) {
      if (((x - center.x) / 7) ** 2 + ((y - center.y) / 9) ** 2 > 1) continue;
      const pixelIndex = y * 512 + x;
      if (center.z < zBuffer[pixelIndex] - 0.008) continue;
      const rgbaIndex = pixelIndex * 4;
      pixels[rgbaIndex] = 32;
      pixels[rgbaIndex + 1] = 38;
      pixels[rgbaIndex + 2] = 43;
      pixels[rgbaIndex + 3] = 255;
    }
  }
}

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function pngChunk(type, data) {
  const typeBuffer = Buffer.from(type);
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const checksum = Buffer.alloc(4);
  checksum.writeUInt32BE(crc32(Buffer.concat([typeBuffer, data])));
  return Buffer.concat([length, typeBuffer, data, checksum]);
}

function encodePng(pixels, width = 512, height = 512) {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  header[9] = 6;
  const rows = [];
  for (let y = 0; y < height; y += 1)
    rows.push(Buffer.from([0]), pixels.subarray(y * width * 4, (y + 1) * width * 4));
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    pngChunk('IHDR', header),
    pngChunk('IDAT', deflateSync(Buffer.concat(rows), { level: 9 })),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
}

function renderPreview(hairGeometry, yaw) {
  const pixels = Buffer.alloc(512 * 512 * 4);
  for (let index = 0; index < pixels.length; index += 4) {
    pixels[index] = 238;
    pixels[index + 1] = 241;
    pixels[index + 2] = 244;
    pixels[index + 3] = 255;
  }
  const zBuffer = new Float32Array(512 * 512).fill(Number.NEGATIVE_INFINITY);
  const head = createGeometry();
  addCapsule(head, [0, -0.62, -0.03], [0, -0.34, -0.03], 0.13, 12);
  addEllipsoid(head, [0, 0, 0], HEAD_RADII, 16, 22);
  renderGeometry(pixels, zBuffer, head, [226, 178, 142], yaw);
  if (hairGeometry) renderGeometry(pixels, zBuffer, hairGeometry, [67, 43, 36], yaw);
  drawEye(pixels, zBuffer, [-0.14, 0.07, 0.37], yaw);
  drawEye(pixels, zBuffer, [0.14, 0.07, 0.37], yaw);
  return pixels;
}

function addContactSheetPreview(sheet, sheetWidth, preview, column, row, previewSize) {
  for (let y = 0; y < previewSize; y += 1) {
    const sourceY = Math.floor((y / previewSize) * 512);
    for (let x = 0; x < previewSize; x += 1) {
      const sourceX = Math.floor((x / previewSize) * 512);
      const sourceOffset = (sourceY * 512 + sourceX) * 4;
      const targetX = column * previewSize + x;
      const targetY = row * previewSize + y;
      const targetOffset = (targetY * sheetWidth + targetX) * 4;
      preview.copy(sheet, targetOffset, sourceOffset, sourceOffset + 4);
    }
  }
}

export async function renderHairEvidence(evidenceDir, geometries) {
  await mkdir(evidenceDir, { recursive: true });
  const existingFiles = await readdir(evidenceDir);
  await Promise.all(
    existingFiles
      .filter((file) => /^\d{2}-.*\.png$/.test(file) || file === 'contact-sheet.png')
      .map((file) => rm(join(evidenceDir, file))),
  );
  const rows = [];
  const frontPreviews = [];
  const rearPreviews = [];
  for (const [index, entry] of HAIR_STYLE_ENTRIES.entries()) {
    const geometry = entry.asset
      ? (geometries.get(entry.asset) ?? createHairGeometry(entry.asset))
      : null;
    const prefix = `${String(index + 1).padStart(2, '0')}-${entry.style}`;
    const frontFile = `${prefix}-front.png`;
    const rearFile = `${prefix}-rear-three-quarter.png`;
    const frontPreview = renderPreview(geometry, 0);
    const rearPreview = renderPreview(geometry, 2.25);
    await Promise.all([
      writeFile(join(evidenceDir, frontFile), encodePng(frontPreview)),
      writeFile(join(evidenceDir, rearFile), encodePng(rearPreview)),
    ]);
    frontPreviews.push(frontPreview);
    rearPreviews.push(rearPreview);
    const fit = geometry ? validateFit(geometry) : null;
    if (fit && !fit.valid)
      throw new Error(`${entry.asset} failed head-fit validation: ${JSON.stringify(fit)}`);
    rows.push({ entry, frontFile, rearFile, fit });
  }
  const previewSize = 192;
  const sheetWidth = previewSize * HAIR_STYLE_ENTRIES.length;
  const sheetHeight = previewSize * 2;
  const contactSheet = Buffer.alloc(sheetWidth * sheetHeight * 4);
  for (let index = 0; index < HAIR_STYLE_ENTRIES.length; index += 1) {
    addContactSheetPreview(contactSheet, sheetWidth, frontPreviews[index], index, 0, previewSize);
    addContactSheetPreview(contactSheet, sheetWidth, rearPreviews[index], index, 1, previewSize);
  }
  await writeFile(
    join(evidenceDir, 'contact-sheet.png'),
    encodePng(contactSheet, sheetWidth, sheetHeight),
  );
  const manifest = [
    '# Offisim toy hair evidence',
    '',
    'Generated from the exact procedural geometry written to the shipped GLBs. The head uses the production toy-head radii. Every style includes a front view and a three-quarter rear view; the contact sheet places all front views on the first row and matching rear views on the second row.',
    '',
    '![Two-view contact sheet](./contact-sheet.png)',
    '',
    '| # | Style | Asset | Vertices | Triangles | Exterior | Hairline | Front | Rear 3/4 |',
    '|---:|---|---|---:|---:|---:|---:|---|---|',
    ...rows.map(
      ({ entry, frontFile, rearFile, fit }, index) =>
        `| ${index + 1} | ${entry.label} | ${entry.asset ?? 'none (intentional bald)'} | ${fit?.vertices ?? 0} | ${fit?.triangles ?? 0} | ${fit ? fit.exteriorRatio.toFixed(3) : 'n/a'} | ${fit?.hairline ?? 'n/a'} | [front](./${frontFile}) | [rear](./${rearFile}) |`,
    ),
    '',
  ].join('\n');
  await writeFile(join(evidenceDir, 'manifest.md'), manifest);
}
