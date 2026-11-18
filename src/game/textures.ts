import * as THREE from 'three';

export interface ProceduralTextureSet {
  mahoganyAlbedo: THREE.CanvasTexture;
  mahoganyRoughness: THREE.CanvasTexture;
  teakDeckAlbedo: THREE.CanvasTexture;
  steelHullAlbedo: THREE.CanvasTexture;
  compassDial: THREE.CanvasTexture;
  telegraphDial: THREE.CanvasTexture;
  iceAlbedo: THREE.CanvasTexture;
  iceBump: THREE.CanvasTexture;
  sprayParticle: THREE.CanvasTexture;
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

export function createProceduralTextures(maxAnisotropy: number): ProceduralTextureSet {
  // 1. Mahogany wood albedo & roughness
  const [mahCanvas, mahCtx] = makeCanvas(512, 512);
  mahCtx.fillStyle = '#3b1c12';
  mahCtx.fillRect(0, 0, 512, 512);
  for (let y = 0; y < 512; y++) {
    const wave = Math.sin(y * 0.08) * 10 + Math.sin(y * 0.31) * 4;
    const tone = Math.floor(38 + Math.sin((y + wave) * 0.14) * 14);
    mahCtx.fillStyle = `rgb(${tone + 26}, ${Math.max(10, tone - 8)}, ${Math.max(6, tone - 18)})`;
    mahCtx.fillRect(0, y, 512, 1);
  }
  for (let i = 0; i < 400; i++) {
    const x = (i * 73) % 512;
    const y = (i * 139) % 512;
    mahCtx.fillStyle = i % 2 === 0 ? 'rgba(20, 7, 4, 0.18)' : 'rgba(95, 48, 28, 0.14)';
    mahCtx.fillRect(x, y, 42 + (i % 60), 2);
  }
  const mahoganyAlbedo = configureColorTexture(mahCanvas, maxAnisotropy, 2, 2);

  const [mahRCanvas, mahRCtx] = makeCanvas(256, 256);
  mahRCtx.fillStyle = '#555555';
  mahRCtx.fillRect(0, 0, 256, 256);
  for (let y = 0; y < 256; y += 2) {
    const v = 70 + Math.floor(Math.sin(y * 0.25) * 20);
    mahRCtx.fillStyle = `rgb(${v},${v},${v})`;
    mahRCtx.fillRect(0, y, 256, 2);
  }
  const mahoganyRoughness = configureDataTexture(mahRCanvas, maxAnisotropy, 2, 2);

  // 2. Teak deck planking
  const [teakCanvas, teakCtx] = makeCanvas(512, 512);
  teakCtx.fillStyle = '#8b6f4e';
  teakCtx.fillRect(0, 0, 512, 512);
  const plankCount = 16;
  const plankW = 512 / plankCount;
  for (let p = 0; p < plankCount; p++) {
    const x = p * plankW;
    const shade = ((p * 29) % 18) - 9;
    teakCtx.fillStyle = `rgb(${132 + shade}, ${106 + shade}, ${76 + shade})`;
    teakCtx.fillRect(x + 2, 0, plankW - 3, 512);
    // Caulked seam
    teakCtx.fillStyle = '#241d17';
    teakCtx.fillRect(x, 0, 2, 512);
    // Butt joints
    const jointY = ((p * 173) % 380) + 60;
    teakCtx.fillRect(x, jointY, plankW, 2);
  }
  const teakDeckAlbedo = configureColorTexture(teakCanvas, maxAnisotropy, 4, 12);

  // 3. Riveted steel hull plates
  const [hullCanvas, hullCtx] = makeCanvas(512, 512);
  hullCtx.fillStyle = '#141921';
  hullCtx.fillRect(0, 0, 512, 512);
  for (let row = 0; row < 8; row++) {
    const y = row * 64;
    hullCtx.fillStyle = row % 2 === 0 ? '#161c25' : '#12171f';
    hullCtx.fillRect(0, y, 512, 62);
    hullCtx.fillStyle = '#0b0e14';
    hullCtx.fillRect(0, y + 62, 512, 2);
    for (let r = 8; r < 512; r += 24) {
      hullCtx.fillStyle = '#262f3d';
      hullCtx.fillRect(r, y + 4, 3, 3);
      hullCtx.fillRect(r, y + 56, 3, 3);
    }
  }
  const steelHullAlbedo = configureColorTexture(hullCanvas, maxAnisotropy, 6, 2);

  // 4. Compass Card Dial
  const [compCanvas, compCtx] = makeCanvas(512, 512);
  compCtx.fillStyle = '#11151d';
  compCtx.fillRect(0, 0, 512, 512);
  compCtx.save();
  compCtx.translate(256, 256);
  // Warm cream compass card
  const cardGrad = compCtx.createRadialGradient(0, 0, 10, 0, 0, 235);
  cardGrad.addColorStop(0, '#fff7dc');
  cardGrad.addColorStop(0.75, '#ead8a7');
  cardGrad.addColorStop(1, '#b89a60');
  compCtx.fillStyle = cardGrad;
  compCtx.beginPath();
  compCtx.arc(0, 0, 236, 0, Math.PI * 2);
  compCtx.fill();

  // Degree ticks
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
  // Cardinal labels
  compCtx.fillStyle = '#1b1610';
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
  // Compass star
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
  teleCtx.fillStyle = '#f4ebd0';
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

  // 6. Glacial Ice Albedo & Bump
  const [iceCanvas, iceCtx] = makeCanvas(256, 256);
  iceCtx.fillStyle = '#cce3f4';
  iceCtx.fillRect(0, 0, 256, 256);
  for (let i = 0; i < 600; i++) {
    const x = (i * 53) % 256;
    const y = (i * 97) % 256;
    const w = 10 + (i % 34);
    const h = 8 + ((i * 7) % 28);
    iceCtx.fillStyle =
      i % 3 === 0
        ? 'rgba(240, 249, 255, 0.25)'
        : i % 3 === 1
          ? 'rgba(120, 180, 222, 0.22)'
          : 'rgba(65, 130, 175, 0.16)';
    iceCtx.fillRect(x, y, w, h);
  }
  const iceAlbedo = configureColorTexture(iceCanvas, maxAnisotropy, 2, 2);

  const [iceBCanvas, iceBCtx] = makeCanvas(256, 256);
  iceBCtx.fillStyle = '#808080';
  iceBCtx.fillRect(0, 0, 256, 256);
  for (let i = 0; i < 300; i++) {
    const x = (i * 67) % 256;
    const y = (i * 113) % 256;
    const v = 90 + ((i * 17) % 130);
    iceBCtx.fillStyle = `rgb(${v},${v},${v})`;
    iceBCtx.beginPath();
    iceBCtx.moveTo(x, y);
    iceBCtx.lineTo(x + 22, y + 6);
    iceBCtx.lineTo(x + 8, y + 26);
    iceBCtx.closePath();
    iceBCtx.fill();
  }
  const iceBump = configureDataTexture(iceBCanvas, maxAnisotropy, 2, 2);

  // 7. Soft radial spray particle
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

  return {
    mahoganyAlbedo,
    mahoganyRoughness,
    teakDeckAlbedo,
    steelHullAlbedo,
    compassDial,
    telegraphDial,
    iceAlbedo,
    iceBump,
    sprayParticle,
    dispose: () => {
      mahoganyAlbedo.dispose();
      mahoganyRoughness.dispose();
      teakDeckAlbedo.dispose();
      steelHullAlbedo.dispose();
      compassDial.dispose();
      telegraphDial.dispose();
      iceAlbedo.dispose();
      iceBump.dispose();
      sprayParticle.dispose();
    },
  };
}
