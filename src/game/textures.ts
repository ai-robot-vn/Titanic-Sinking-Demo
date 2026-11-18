import * as THREE from 'three';

export interface ProceduralTextureSet {
  mahoganyAlbedo: THREE.CanvasTexture;
  mahoganyRoughness: THREE.CanvasTexture;
  teakDeckAlbedo: THREE.CanvasTexture;
  teakDeckNormal: THREE.DataTexture;
  steelHullAlbedo: THREE.CanvasTexture;
  steelHullNormal: THREE.DataTexture;
  compassDial: THREE.CanvasTexture;
  telegraphDial: THREE.CanvasTexture;
  clinometerDial: THREE.CanvasTexture;
  iceAlbedo: THREE.CanvasTexture;
  iceNormal: THREE.DataTexture;
  sprayParticle: THREE.CanvasTexture;
  hullNameplateBow: THREE.CanvasTexture;
  hullNameplateStern: THREE.CanvasTexture;
  hullNameplateCarpathia: THREE.CanvasTexture;
  whiteStarPennant: THREE.CanvasTexture;
  redEnsignFlag: THREE.CanvasTexture;
  whiteEnsignFlag: THREE.CanvasTexture;
  interiorMarbleAlbedo: THREE.CanvasTexture;
  interiorPanelAlbedo: THREE.CanvasTexture;
  dispose: () => void;
}

function makeCanvas(w: number, h: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d')!;
  return [canvas, ctx];
}

function configureColorTexture(
  canvas: HTMLCanvasElement,
  maxAnisotropy: number,
  repeatX = 1,
  repeatY = 1,
): THREE.CanvasTexture {
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(repeatX, repeatY);
  tex.anisotropy = maxAnisotropy;
  tex.needsUpdate = true;
  return tex;
}

function configureDataTexture(
  canvas: HTMLCanvasElement,
  maxAnisotropy: number,
  repeatX = 1,
  repeatY = 1,
): THREE.CanvasTexture {
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(repeatX, repeatY);
  tex.anisotropy = maxAnisotropy;
  tex.needsUpdate = true;
  return tex;
}

/**
 * Converts a grayscale height canvas into a tangent-space normal DataTexture (linear space).
 */
function heightCanvasToNormalTexture(
  canvas: HTMLCanvasElement,
  strength: number,
  maxAnisotropy: number,
  repeatX = 1,
  repeatY = 1,
): THREE.DataTexture {
  const w = canvas.width;
  const h = canvas.height;
  const ctx = canvas.getContext('2d')!;
  const src = ctx.getImageData(0, 0, w, h).data;
  const out = new Uint8Array(w * h * 4);

  const sample = (x: number, y: number): number => {
    const wx = ((x % w) + w) % w;
    const wy = ((y % h) + h) % h;
    return src[(wy * w + wx) * 4] / 255;
  };

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const hL = sample(x - 1, y);
      const hR = sample(x + 1, y);
      const hU = sample(x, y - 1);
      const hD = sample(x, y + 1);

      const dx = (hL - hR) * strength;
      const dy = (hU - hD) * strength;
      const dz = 1.0;
      const invLen = 1 / Math.hypot(dx, dy, dz);

      const idx = (y * w + x) * 4;
      out[idx] = Math.round((dx * invLen * 0.5 + 0.5) * 255);
      out[idx + 1] = Math.round((dy * invLen * 0.5 + 0.5) * 255);
      out[idx + 2] = Math.round((dz * invLen * 0.5 + 0.5) * 255);
      out[idx + 3] = 255;
    }
  }

  const tex = new THREE.DataTexture(out, w, h, THREE.RGBAFormat);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(repeatX, repeatY);
  tex.anisotropy = maxAnisotropy;
  tex.needsUpdate = true;
  return tex;
}

export function createProceduralTextures(maxAnisotropy: number): ProceduralTextureSet {
  // 1. Rich Quarter-Sawn Mahogany Albedo & Gloss-Varnish Roughness
  const [mahCanvas, mahCtx] = makeCanvas(512, 512);
  mahCtx.fillStyle = '#3a190f';
  mahCtx.fillRect(0, 0, 512, 512);
  for (let y = 0; y < 512; y++) {
    const ribbon = Math.sin(y * 0.045) * 14 + Math.sin(y * 0.19) * 5;
    const tone = Math.floor(40 + Math.sin((y + ribbon) * 0.13) * 16);
    mahCtx.fillStyle = `rgb(${tone + 34}, ${Math.max(10, tone - 6)}, ${Math.max(5, tone - 18)})`;
    mahCtx.fillRect(0, y, 512, 1);
  }
  for (let i = 0; i < 650; i++) {
    const x = (i * 89) % 512;
    const y = (i * 149) % 512;
    mahCtx.fillStyle = i % 3 === 0 ? 'rgba(18, 5, 2, 0.22)' : 'rgba(112, 54, 28, 0.15)';
    mahCtx.fillRect(x, y, 36 + (i % 78), 1.5);
  }
  const mahoganyAlbedo = configureColorTexture(mahCanvas, maxAnisotropy, 2, 2);

  const [mahRCanvas, mahRCtx] = makeCanvas(256, 256);
  mahRCtx.fillStyle = '#484848';
  mahRCtx.fillRect(0, 0, 256, 256);
  for (let y = 0; y < 256; y += 2) {
    const v = 64 + Math.floor(Math.sin(y * 0.22) * 18);
    mahRCtx.fillStyle = `rgb(${v},${v},${v})`;
    mahRCtx.fillRect(0, y, 256, 2);
  }
  const mahoganyRoughness = configureDataTexture(mahRCanvas, maxAnisotropy, 2, 2);

  // 2. Teak Deck Planking Albedo & Normal Map
  const [teakCanvas, teakCtx] = makeCanvas(512, 512);
  const [teakHCanvas, teakHCtx] = makeCanvas(512, 512);
  teakCtx.fillStyle = '#8b6f4e';
  teakCtx.fillRect(0, 0, 512, 512);
  teakHCtx.fillStyle = '#d0d0d0';
  teakHCtx.fillRect(0, 0, 512, 512);

  const plankCount = 16;
  const plankW = 512 / plankCount;
  for (let p = 0; p < plankCount; p++) {
    const x = p * plankW;
    const shade = ((p * 31) % 20) - 10;
    teakCtx.fillStyle = `rgb(${138 + shade}, ${112 + shade}, ${82 + shade})`;
    teakCtx.fillRect(x + 2, 0, plankW - 3, 512);

    // Subtle longitudinal grain lines
    for (let g = 0; g < 6; g++) {
      teakCtx.fillStyle = g % 2 === 0 ? 'rgba(65, 45, 25, 0.12)' : 'rgba(175, 145, 108, 0.1)';
      teakCtx.fillRect(x + 4 + g * 4, 0, 1.5, 512);
    }

    // Caulked pitch seam
    teakCtx.fillStyle = '#1f1914';
    teakCtx.fillRect(x, 0, 2.2, 512);
    teakHCtx.fillStyle = '#202020';
    teakHCtx.fillRect(x, 0, 2.5, 512);

    const jointY = ((p * 173) % 380) + 60;
    teakCtx.fillRect(x, jointY, plankW, 2);
    teakHCtx.fillRect(x, jointY, plankW, 2);
  }
  const teakDeckAlbedo = configureColorTexture(teakCanvas, maxAnisotropy, 4, 14);
  const teakDeckNormal = heightCanvasToNormalTexture(teakHCanvas, 2.4, maxAnisotropy, 4, 14);

  // 3. Crisp Riveted Steel Hull Plates (Albedo + Normal Map)
  const [hullCanvas, hullCtx] = makeCanvas(512, 512);
  const [hullHCanvas, hullHCtx] = makeCanvas(512, 512);
  hullCtx.fillStyle = '#141b24';
  hullCtx.fillRect(0, 0, 512, 512);
  hullHCtx.fillStyle = '#808080';
  hullHCtx.fillRect(0, 0, 512, 512);

  for (let row = 0; row < 8; row++) {
    const y = row * 64;
    const offset = (row % 2) * 64;
    hullCtx.fillStyle = row % 2 === 0 ? '#1b2430' : '#131922';
    hullCtx.fillRect(0, y, 512, 62);
    hullHCtx.fillStyle = row % 2 === 0 ? '#a4a4a4' : '#767676';
    hullHCtx.fillRect(0, y, 512, 62);

    // Subtle salt/brushing horizontal micro-strakes
    for (let s = 0; s < 5; s++) {
      hullCtx.fillStyle = s % 2 === 0 ? 'rgba(255,255,255,0.035)' : 'rgba(0,0,0,0.08)';
      hullCtx.fillRect(0, y + 10 + s * 10, 512, 2);
    }

    // Deep plate lap seam
    hullCtx.fillStyle = '#070a0e';
    hullCtx.fillRect(0, y + 61, 512, 3);
    hullHCtx.fillStyle = '#242424';
    hullHCtx.fillRect(0, y + 61, 512, 3);

    // Vertical plate butt joints
    for (let vx = offset; vx < 512; vx += 128) {
      hullCtx.fillStyle = '#090d13';
      hullCtx.fillRect(vx, y, 2.5, 64);
      hullHCtx.fillStyle = '#2c2c2c';
      hullHCtx.fillRect(vx, y, 2.5, 64);
    }

    // Crisp raised double-rivet rows
    for (let r = 6; r < 512; r += 12) {
      hullCtx.fillStyle = '#2d394a';
      hullCtx.fillRect(r, y + 4, 3, 3);
      hullCtx.fillRect(r, y + 54, 3, 3);

      hullHCtx.fillStyle = '#e5e5e5';
      hullHCtx.fillRect(r, y + 4, 3, 3);
      hullHCtx.fillRect(r, y + 54, 3, 3);
    }
  }
  const steelHullAlbedo = configureColorTexture(hullCanvas, maxAnisotropy, 12, 3.5);
  const steelHullNormal = heightCanvasToNormalTexture(hullHCanvas, 3.3, maxAnisotropy, 12, 3.5);

  // 4. Compass Card Dial
  const [compCanvas, compCtx] = makeCanvas(512, 512);
  compCtx.fillStyle = '#11151d';
  compCtx.fillRect(0, 0, 512, 512);
  compCtx.save();
  compCtx.translate(256, 256);
  const cardGrad = compCtx.createRadialGradient(0, 0, 10, 0, 0, 236);
  cardGrad.addColorStop(0, '#fff9e4');
  cardGrad.addColorStop(0.75, '#ecd9a8');
  cardGrad.addColorStop(1, '#b59352');
  compCtx.fillStyle = cardGrad;
  compCtx.beginPath();
  compCtx.arc(0, 0, 236, 0, Math.PI * 2);
  compCtx.fill();

  for (let deg = 0; deg < 360; deg += 5) {
    const rad = (deg * Math.PI) / 180;
    const isMajor = deg % 30 === 0;
    const isMid = deg % 10 === 0;
    const rOuter = 230;
    const rInner = isMajor ? 196 : isMid ? 208 : 218;
    compCtx.strokeStyle = '#1e1b16';
    compCtx.lineWidth = isMajor ? 4 : isMid ? 2.5 : 1.5;
    compCtx.beginPath();
    compCtx.moveTo(Math.cos(rad) * rInner, Math.sin(rad) * rInner);
    compCtx.lineTo(Math.cos(rad) * rOuter, Math.sin(rad) * rOuter);
    compCtx.stroke();
  }
  compCtx.font = 'bold 34px Georgia, serif';
  compCtx.textAlign = 'center';
  compCtx.textBaseline = 'middle';
  const labels: Array<[string, number, string]> = [
    ['N', -Math.PI / 2, '#991b1b'],
    ['E', 0, '#1b1610'],
    ['S', Math.PI / 2, '#1b1610'],
    ['W', Math.PI, '#1b1610'],
  ];
  for (const [text, ang, col] of labels) {
    compCtx.fillStyle = col;
    compCtx.fillText(text, Math.cos(ang) * 155, Math.sin(ang) * 155);
  }
  compCtx.fillStyle = '#2d2418';
  for (let i = 0; i < 8; i++) {
    const a = (i * Math.PI) / 4;
    compCtx.beginPath();
    compCtx.moveTo(0, 0);
    compCtx.lineTo(Math.cos(a - 0.16) * 40, Math.sin(a - 0.16) * 40);
    compCtx.lineTo(Math.cos(a) * (i % 2 === 0 ? 115 : 75), Math.sin(a) * (i % 2 === 0 ? 115 : 75));
    compCtx.lineTo(Math.cos(a + 0.16) * 40, Math.sin(a + 0.16) * 40);
    compCtx.closePath();
    compCtx.fill();
  }
  compCtx.restore();
  const compassDial = configureColorTexture(compCanvas, maxAnisotropy, 1, 1);
  compassDial.wrapS = THREE.ClampToEdgeWrapping;
  compassDial.wrapT = THREE.ClampToEdgeWrapping;

  // 5. Chadburn Engine Telegraph Dial
  const [teleCanvas, teleCtx] = makeCanvas(512, 512);
  teleCtx.fillStyle = '#14171d';
  teleCtx.fillRect(0, 0, 512, 512);
  teleCtx.save();
  teleCtx.translate(256, 256);
  teleCtx.fillStyle = '#f5ecd2';
  teleCtx.beginPath();
  teleCtx.arc(0, 0, 232, 0, Math.PI * 2);
  teleCtx.fill();
  teleCtx.strokeStyle = '#8b6a2b';
  teleCtx.lineWidth = 14;
  teleCtx.stroke();

  const sectors: Array<{ text: string; angle: number; bg: string; fg: string }> = [
    { text: 'ASTERN', angle: -1.15, bg: '#7f1d1d', fg: '#fef2f2' },
    { text: 'STOP', angle: -0.68, bg: '#334155', fg: '#f8fafc' },
    { text: 'SLOW', angle: -0.22, bg: '#e6d7b0', fg: '#1e293b' },
    { text: 'HALF', angle: 0.25, bg: '#e6d7b0', fg: '#1e293b' },
    { text: 'FULL', angle: 0.72, bg: '#1e3a5f', fg: '#f8fafc' },
    { text: 'FLANK', angle: 1.18, bg: '#92400e', fg: '#fef3c7' },
  ];
  const halfSpan = 0.23;
  for (const s of sectors) {
    const a0 = s.angle - Math.PI / 2 - halfSpan;
    const a1 = s.angle - Math.PI / 2 + halfSpan;
    teleCtx.fillStyle = s.bg;
    teleCtx.beginPath();
    teleCtx.moveTo(0, 0);
    teleCtx.arc(0, 0, 220, a0, a1);
    teleCtx.closePath();
    teleCtx.fill();
    teleCtx.strokeStyle = '#1f2937';
    teleCtx.lineWidth = 3;
    teleCtx.stroke();

    teleCtx.save();
    teleCtx.rotate(s.angle);
    teleCtx.fillStyle = s.fg;
    teleCtx.font = 'bold 24px Georgia, serif';
    teleCtx.textAlign = 'center';
    teleCtx.fillText(s.text, 0, -155);
    teleCtx.restore();
  }
  teleCtx.fillStyle = '#b48a3e';
  teleCtx.beginPath();
  teleCtx.arc(0, 0, 48, 0, Math.PI * 2);
  teleCtx.fill();
  teleCtx.fillStyle = '#1e2430';
  teleCtx.font = 'bold 18px Georgia, serif';
  teleCtx.textAlign = 'center';
  teleCtx.fillText('WHITE STAR', 0, 96);
  teleCtx.restore();
  const telegraphDial = configureColorTexture(teleCanvas, maxAnisotropy, 1, 1);
  telegraphDial.wrapS = THREE.ClampToEdgeWrapping;
  telegraphDial.wrapT = THREE.ClampToEdgeWrapping;

  // 6. Clinometer (Heel Angle Gauge) Dial
  const [clinCanvas, clinCtx] = makeCanvas(256, 256);
  clinCtx.fillStyle = '#f3ebd0';
  clinCtx.fillRect(0, 0, 256, 256);
  clinCtx.save();
  clinCtx.translate(128, 128);
  clinCtx.strokeStyle = '#292218';
  clinCtx.lineWidth = 4;
  clinCtx.beginPath();
  clinCtx.arc(0, 0, 110, 0.2, Math.PI - 0.2);
  clinCtx.stroke();
  for (let deg = -40; deg <= 40; deg += 5) {
    const rad = Math.PI / 2 + (deg * Math.PI) / 180;
    const inner = deg % 10 === 0 ? 84 : 96;
    clinCtx.lineWidth = deg % 10 === 0 ? 3 : 1.5;
    clinCtx.beginPath();
    clinCtx.moveTo(Math.cos(rad) * inner, Math.sin(rad) * inner);
    clinCtx.lineTo(Math.cos(rad) * 110, Math.sin(rad) * 110);
    clinCtx.stroke();
  }
  clinCtx.fillStyle = '#1e2430';
  clinCtx.font = 'bold 16px Georgia, serif';
  clinCtx.textAlign = 'center';
  clinCtx.fillText('CLINOMETER', 0, -45);
  clinCtx.restore();
  const clinometerDial = configureColorTexture(clinCanvas, maxAnisotropy, 1, 1);
  clinometerDial.wrapS = THREE.ClampToEdgeWrapping;
  clinometerDial.wrapT = THREE.ClampToEdgeWrapping;

  // 7. Glacial Ice Albedo & Normal Map
  const [iceCanvas, iceCtx] = makeCanvas(512, 512);
  const [iceHCanvas, iceHCtx] = makeCanvas(512, 512);
  iceCtx.fillStyle = '#cbe5f6';
  iceCtx.fillRect(0, 0, 512, 512);
  iceHCtx.fillStyle = '#808080';
  iceHCtx.fillRect(0, 0, 512, 512);

  for (let i = 0; i < 950; i++) {
    const x = (i * 53) % 512;
    const y = (i * 97) % 512;
    const w = 14 + (i % 48);
    const h = 10 + ((i * 7) % 36);
    iceCtx.fillStyle =
      i % 3 === 0
        ? 'rgba(242, 250, 255, 0.28)'
        : i % 3 === 1
          ? 'rgba(110, 178, 224, 0.22)'
          : 'rgba(56, 126, 178, 0.16)';
    iceCtx.fillRect(x, y, w, h);

    const hv = 85 + ((i * 23) % 135);
    iceHCtx.fillStyle = `rgb(${hv},${hv},${hv})`;
    iceHCtx.beginPath();
    iceHCtx.moveTo(x, y);
    iceHCtx.lineTo(x + w * 0.85, y + h * 0.25);
    iceHCtx.lineTo(x + w * 0.35, y + h);
    iceHCtx.closePath();
    iceHCtx.fill();
  }
  const iceAlbedo = configureColorTexture(iceCanvas, maxAnisotropy, 2, 2);
  const iceNormal = heightCanvasToNormalTexture(iceHCanvas, 2.2, maxAnisotropy, 2, 2);

  // 8. Soft radial spray particle
  const [sprayCanvas, sprayCtx] = makeCanvas(128, 128);
  const sGrad = sprayCtx.createRadialGradient(64, 64, 4, 64, 64, 60);
  sGrad.addColorStop(0, 'rgba(235, 246, 255, 0.95)');
  sGrad.addColorStop(0.45, 'rgba(195, 225, 248, 0.45)');
  sGrad.addColorStop(1, 'rgba(180, 220, 250, 0)');
  sprayCtx.fillStyle = sGrad;
  sprayCtx.fillRect(0, 0, 128, 128);
  const sprayParticle = configureColorTexture(sprayCanvas, maxAnisotropy, 1, 1);
  sprayParticle.wrapS = THREE.ClampToEdgeWrapping;
  sprayParticle.wrapT = THREE.ClampToEdgeWrapping;

  // 9. Hull Bow Nameplate ("TITANIC") & Stern Nameplate ("TITANIC · LIVERPOOL")
  const [bowNameCanvas, bowNameCtx] = makeCanvas(512, 128);
  bowNameCtx.clearRect(0, 0, 512, 128);
  bowNameCtx.fillStyle = '#e7bf62';
  bowNameCtx.strokeStyle = '#6c4d14';
  bowNameCtx.lineWidth = 3;
  bowNameCtx.font = 'bold 74px Georgia, "Times New Roman", serif';
  bowNameCtx.textAlign = 'center';
  bowNameCtx.textBaseline = 'middle';
  bowNameCtx.strokeText('T I T A N I C', 256, 66);
  bowNameCtx.fillText('T I T A N I C', 256, 66);
  const hullNameplateBow = configureColorTexture(bowNameCanvas, maxAnisotropy, 1, 1);
  hullNameplateBow.wrapS = THREE.ClampToEdgeWrapping;
  hullNameplateBow.wrapT = THREE.ClampToEdgeWrapping;

  const [sternNameCanvas, sternNameCtx] = makeCanvas(512, 160);
  sternNameCtx.clearRect(0, 0, 512, 160);
  sternNameCtx.fillStyle = '#e7bf62';
  sternNameCtx.strokeStyle = '#6c4d14';
  sternNameCtx.lineWidth = 2.5;
  sternNameCtx.font = 'bold 58px Georgia, "Times New Roman", serif';
  sternNameCtx.textAlign = 'center';
  sternNameCtx.textBaseline = 'middle';
  sternNameCtx.strokeText('T I T A N I C', 256, 56);
  sternNameCtx.fillText('T I T A N I C', 256, 56);
  sternNameCtx.font = 'bold 34px Georgia, "Times New Roman", serif';
  sternNameCtx.strokeText('L I V E R P O O L', 256, 118);
  sternNameCtx.fillText('L I V E R P O O L', 256, 118);
  const hullNameplateStern = configureColorTexture(sternNameCanvas, maxAnisotropy, 1, 1);
  hullNameplateStern.wrapS = THREE.ClampToEdgeWrapping;
  hullNameplateStern.wrapT = THREE.ClampToEdgeWrapping;

  const [carpNameCanvas, carpNameCtx] = makeCanvas(512, 128);
  carpNameCtx.clearRect(0, 0, 512, 128);
  carpNameCtx.fillStyle = '#e7bf62';
  carpNameCtx.strokeStyle = '#6c4d14';
  carpNameCtx.lineWidth = 2.5;
  carpNameCtx.font = 'bold 62px Georgia, "Times New Roman", serif';
  carpNameCtx.textAlign = 'center';
  carpNameCtx.textBaseline = 'middle';
  carpNameCtx.strokeText('C A R P A T H I A', 256, 66);
  carpNameCtx.fillText('C A R P A T H I A', 256, 66);
  const hullNameplateCarpathia = configureColorTexture(carpNameCanvas, maxAnisotropy, 1, 1);
  hullNameplateCarpathia.wrapS = THREE.ClampToEdgeWrapping;
  hullNameplateCarpathia.wrapT = THREE.ClampToEdgeWrapping;

  // 10. White Star Line Burgee Pennant (Red swallowtail with 5-pointed white star)
  const [wsCanvas, wsCtx] = makeCanvas(256, 128);
  wsCtx.clearRect(0, 0, 256, 128);
  wsCtx.fillStyle = '#b91c1c';
  wsCtx.beginPath();
  wsCtx.moveTo(0, 8);
  wsCtx.lineTo(256, 26);
  wsCtx.lineTo(192, 64);
  wsCtx.lineTo(256, 102);
  wsCtx.lineTo(0, 120);
  wsCtx.closePath();
  wsCtx.fill();
  wsCtx.fillStyle = '#f8fafc';
  wsCtx.beginPath();
  for (let i = 0; i < 10; i++) {
    const r = i % 2 === 0 ? 32 : 13;
    const a = -Math.PI / 2 + (i * Math.PI) / 5;
    const sx = 88 + Math.cos(a) * r;
    const sy = 64 + Math.sin(a) * r;
    if (i === 0) wsCtx.moveTo(sx, sy);
    else wsCtx.lineTo(sx, sy);
  }
  wsCtx.closePath();
  wsCtx.fill();
  const whiteStarPennant = configureColorTexture(wsCanvas, maxAnisotropy, 1, 1);
  whiteStarPennant.wrapS = THREE.ClampToEdgeWrapping;
  whiteStarPennant.wrapT = THREE.ClampToEdgeWrapping;

  // 11. British Merchant Marine Red Ensign
  const [ensCanvas, ensCtx] = makeCanvas(256, 128);
  ensCtx.fillStyle = '#b91c1c';
  ensCtx.fillRect(0, 0, 256, 128);
  ensCtx.fillStyle = '#1e3a8a';
  ensCtx.fillRect(0, 0, 118, 64);
  ensCtx.strokeStyle = '#f8fafc';
  ensCtx.lineWidth = 10;
  ensCtx.beginPath();
  ensCtx.moveTo(0, 0);
  ensCtx.lineTo(118, 64);
  ensCtx.moveTo(118, 0);
  ensCtx.lineTo(0, 64);
  ensCtx.stroke();
  ensCtx.fillStyle = '#f8fafc';
  ensCtx.fillRect(50, 0, 18, 64);
  ensCtx.fillRect(0, 23, 118, 18);
  ensCtx.fillStyle = '#dc2626';
  ensCtx.fillRect(54, 0, 10, 64);
  ensCtx.fillRect(0, 27, 118, 10);
  const redEnsignFlag = configureColorTexture(ensCanvas, maxAnisotropy, 1, 1);
  redEnsignFlag.wrapS = THREE.ClampToEdgeWrapping;
  redEnsignFlag.wrapT = THREE.ClampToEdgeWrapping;

  // 11B. Royal Navy White Ensign (White field, Red St. George Cross, Union Jack Canton)
  const [wensCanvas, wensCtx] = makeCanvas(256, 128);
  wensCtx.fillStyle = '#f4f6fa';
  wensCtx.fillRect(0, 0, 256, 128);
  // St George's Cross
  wensCtx.fillStyle = '#b91c1c';
  wensCtx.fillRect(116, 0, 24, 128);
  wensCtx.fillRect(0, 52, 256, 24);
  // Union Flag in upper-left canton
  wensCtx.fillStyle = '#1e3a8a';
  wensCtx.fillRect(0, 0, 116, 52);
  wensCtx.strokeStyle = '#f8fafc';
  wensCtx.lineWidth = 9;
  wensCtx.beginPath();
  wensCtx.moveTo(0, 0);
  wensCtx.lineTo(116, 52);
  wensCtx.moveTo(116, 0);
  wensCtx.lineTo(0, 52);
  wensCtx.stroke();
  wensCtx.fillStyle = '#f8fafc';
  wensCtx.fillRect(49, 0, 18, 52);
  wensCtx.fillRect(0, 17, 116, 18);
  wensCtx.fillStyle = '#dc2626';
  wensCtx.fillRect(53, 0, 10, 52);
  wensCtx.fillRect(0, 21, 116, 10);
  const whiteEnsignFlag = configureColorTexture(wensCanvas, maxAnisotropy, 1, 1);
  whiteEnsignFlag.wrapS = THREE.ClampToEdgeWrapping;
  whiteEnsignFlag.wrapT = THREE.ClampToEdgeWrapping;

  // 12. First-Class Checkered Parquet / Linoleum Marble Floor (Reception & Dining Saloon)
  const [marbCanvas, marbCtx] = makeCanvas(512, 512);
  const tile = 64;
  for (let ty = 0; ty < 8; ty++) {
    for (let tx = 0; tx < 8; tx++) {
      const dark = (tx + ty) % 2 === 0;
      marbCtx.fillStyle = dark ? '#20242c' : '#e7ddc6';
      marbCtx.fillRect(tx * tile, ty * tile, tile, tile);
      // Subtle marble veining inside each square
      marbCtx.strokeStyle = dark ? 'rgba(130, 145, 165, 0.14)' : 'rgba(155, 132, 95, 0.18)';
      marbCtx.lineWidth = 1.5;
      marbCtx.beginPath();
      marbCtx.moveTo(tx * tile + 6, ty * tile + 14);
      marbCtx.bezierCurveTo(
        tx * tile + 24,
        ty * tile + 30,
        tx * tile + 40,
        ty * tile + 18,
        tx * tile + tile - 6,
        ty * tile + tile - 10,
      );
      marbCtx.stroke();
      // Gold hairline border
      marbCtx.strokeStyle = 'rgba(164, 126, 62, 0.25)';
      marbCtx.lineWidth = 1;
      marbCtx.strokeRect(tx * tile + 0.5, ty * tile + 0.5, tile - 1, tile - 1);
    }
  }
  const interiorMarbleAlbedo = configureColorTexture(marbCanvas, maxAnisotropy, 6, 8);

  // 13. Edwardian Georgian Cream & Oak Wainscot Interior Wall Paneling
  const [panCanvas, panCtx] = makeCanvas(512, 512);
  panCtx.fillStyle = '#eae1cc';
  panCtx.fillRect(0, 0, 512, 512);
  // Lower oak dado rail & wainscoting
  panCtx.fillStyle = '#6e4526';
  panCtx.fillRect(0, 355, 512, 157);
  panCtx.fillStyle = '#c49b4d';
  panCtx.fillRect(0, 350, 512, 7);
  // Carved recessed molding frames
  for (let px = 18; px < 512; px += 128) {
    panCtx.strokeStyle = '#c8b896';
    panCtx.lineWidth = 5;
    panCtx.strokeRect(px, 32, 92, 290);
    panCtx.strokeStyle = '#9c7c46';
    panCtx.lineWidth = 2;
    panCtx.strokeRect(px + 10, 44, 72, 266);
    // Wainscot oak inset
    panCtx.strokeStyle = '#472914';
    panCtx.lineWidth = 4;
    panCtx.strokeRect(px, 376, 92, 114);
  }
  const interiorPanelAlbedo = configureColorTexture(panCanvas, maxAnisotropy, 4, 1);

  return {
    mahoganyAlbedo,
    mahoganyRoughness,
    teakDeckAlbedo,
    teakDeckNormal,
    steelHullAlbedo,
    steelHullNormal,
    compassDial,
    telegraphDial,
    clinometerDial,
    iceAlbedo,
    iceNormal,
    sprayParticle,
    hullNameplateBow,
    hullNameplateStern,
    hullNameplateCarpathia,
    whiteStarPennant,
    redEnsignFlag,
    whiteEnsignFlag,
    interiorMarbleAlbedo,
    interiorPanelAlbedo,
    dispose: () => {
      mahoganyAlbedo.dispose();
      mahoganyRoughness.dispose();
      teakDeckAlbedo.dispose();
      teakDeckNormal.dispose();
      steelHullAlbedo.dispose();
      steelHullNormal.dispose();
      compassDial.dispose();
      telegraphDial.dispose();
      clinometerDial.dispose();
      iceAlbedo.dispose();
      iceNormal.dispose();
      sprayParticle.dispose();
      hullNameplateBow.dispose();
      hullNameplateStern.dispose();
      hullNameplateCarpathia.dispose();
      whiteStarPennant.dispose();
      redEnsignFlag.dispose();
      whiteEnsignFlag.dispose();
      interiorMarbleAlbedo.dispose();
      interiorPanelAlbedo.dispose();
    },
  };
}
