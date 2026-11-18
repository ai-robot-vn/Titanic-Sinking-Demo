export class SoundEngine {
  private ctx: AudioContext | null = null;
  private masterGain: GainNode | null = null;
  private engineOsc1: OscillatorNode | null = null;
  private engineOsc2: OscillatorNode | null = null;
  private engineGain: GainNode | null = null;
  private oceanNoiseGain: GainNode | null = null;
  private oceanFilter: BiquadFilterNode | null = null;
  private muted = false;
  private initialized = false;

  public isMuted(): boolean {
    return this.muted;
  }

  public setMuted(muted: boolean): void {
    this.muted = muted;
    if (this.masterGain && this.ctx) {
      this.masterGain.gain.setTargetAtTime(muted ? 0 : 0.7, this.ctx.currentTime, 0.05);
    }
  }

  public toggleMute(): boolean {
    this.setMuted(!this.muted);
    return this.muted;
  }

  public unlock(): void {
    if (this.initialized) {
      if (this.ctx && this.ctx.state === 'suspended') {
        void this.ctx.resume();
      }
      return;
    }

    const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!AudioCtx) return;

    this.ctx = new AudioCtx();
    this.masterGain = this.ctx.createGain();
    this.masterGain.gain.value = this.muted ? 0 : 0.7;
    this.masterGain.connect(this.ctx.destination);

    // Continuous steam turbine & hull vibration hum
    this.engineGain = this.ctx.createGain();
    this.engineGain.gain.value = 0.02;
    const engFilter = this.ctx.createBiquadFilter();
    engFilter.type = 'lowpass';
    engFilter.frequency.value = 140;

    this.engineOsc1 = this.ctx.createOscillator();
    this.engineOsc1.type = 'sawtooth';
    this.engineOsc1.frequency.value = 42;

    this.engineOsc2 = this.ctx.createOscillator();
    this.engineOsc2.type = 'triangle';
    this.engineOsc2.frequency.value = 63;

    this.engineOsc1.connect(engFilter);
    this.engineOsc2.connect(engFilter);
    engFilter.connect(this.engineGain);
    this.engineGain.connect(this.masterGain);

    this.engineOsc1.start();
    this.engineOsc2.start();

    // Continuous North Atlantic ocean wash (filtered noise buffer)
    const bufferSize = this.ctx.sampleRate * 2;
    const noiseBuffer = this.ctx.createBuffer(1, bufferSize, this.ctx.sampleRate);
    const data = noiseBuffer.getChannelData(0);
    let lastOut = 0;
    for (let i = 0; i < bufferSize; i++) {
      const white = Math.random() * 2 - 1;
      data[i] = (lastOut + 0.03 * white) / 1.03;
      lastOut = data[i];
      data[i] *= 2.8;
    }
    const noiseSource = this.ctx.createBufferSource();
    noiseSource.buffer = noiseBuffer;
    noiseSource.loop = true;

    this.oceanFilter = this.ctx.createBiquadFilter();
    this.oceanFilter.type = 'bandpass';
    this.oceanFilter.frequency.value = 280;
    this.oceanFilter.Q.value = 0.7;

    this.oceanNoiseGain = this.ctx.createGain();
    this.oceanNoiseGain.gain.value = 0.08;

    noiseSource.connect(this.oceanFilter);
    this.oceanFilter.connect(this.oceanNoiseGain);
    this.oceanNoiseGain.connect(this.masterGain);
    noiseSource.start();

    this.initialized = true;
  }

  public updateShipAmbience(speedKnots: number, active: boolean): void {
    if (!this.initialized || !this.ctx || !this.engineGain || !this.engineOsc1 || !this.engineOsc2 || !this.oceanNoiseGain || !this.oceanFilter) {
      return;
    }
    const t = this.ctx.currentTime;
    const absSpd = Math.abs(speedKnots);
    const norm = Math.min(1, absSpd / 24);
    const baseGain = active ? 0.02 + norm * 0.09 : 0.015;
    this.engineGain.gain.setTargetAtTime(baseGain, t, 0.15);
    this.engineOsc1.frequency.setTargetAtTime(34 + norm * 28, t, 0.2);
    this.engineOsc2.frequency.setTargetAtTime(51 + norm * 42, t, 0.2);

    this.oceanNoiseGain.gain.setTargetAtTime(active ? 0.05 + norm * 0.14 : 0.04, t, 0.2);
    this.oceanFilter.frequency.setTargetAtTime(210 + norm * 420, t, 0.2);
  }

  public playTelegraphBell(): void {
    if (!this.ctx || !this.masterGain || this.muted) return;
    const now = this.ctx.currentTime;
    // Double brass Chadburn chime
    [0, 0.11].forEach((offset, idx) => {
      const osc = this.ctx!.createOscillator();
      const gain = this.ctx!.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(idx === 0 ? 1180 : 1480, now + offset);
      gain.gain.setValueAtTime(0.18, now + offset);
      gain.gain.exponentialRampToValueAtTime(0.001, now + offset + 0.45);
      osc.connect(gain);
      gain.connect(this.masterGain!);
      osc.start(now + offset);
      osc.stop(now + offset + 0.48);
    });
  }

  public playHelmTick(): void {
    if (!this.ctx || !this.masterGain || this.muted) return;
    const now = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(160, now);
    osc.frequency.exponentialRampToValueAtTime(75, now + 0.05);
    gain.gain.setValueAtTime(0.06, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.06);
    osc.connect(gain);
    gain.connect(this.masterGain);
    osc.start(now);
    osc.stop(now + 0.07);
  }

  public playSteamWhistle(): void {
    if (!this.ctx || !this.masterGain || this.muted) return;
    const now = this.ctx.currentTime;
    // Deep Titanic triple-chime steam whistle chord
    const freqs = [110, 138.59, 164.81];
    freqs.forEach((f) => {
      const osc = this.ctx!.createOscillator();
      const filter = this.ctx!.createBiquadFilter();
      const gain = this.ctx!.createGain();

      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(f * 0.96, now);
      osc.frequency.linearRampToValueAtTime(f, now + 0.12);

      filter.type = 'lowpass';
      filter.frequency.value = 520;

      gain.gain.setValueAtTime(0.001, now);
      gain.gain.linearRampToValueAtTime(0.11, now + 0.09);
      gain.gain.setValueAtTime(0.1, now + 0.85);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 1.55);

      osc.connect(filter);
      filter.connect(gain);
      gain.connect(this.masterGain!);
      osc.start(now);
      osc.stop(now + 1.6);
    });
  }

  public playCarpathiaWhistle(): void {
    if (!this.ctx || !this.masterGain || this.muted) return;
    const now = this.ctx.currentTime;
    // Warm Cunard two-tone steam whistle chord
    const freqs = [146.83, 185.0];
    freqs.forEach((f) => {
      const osc = this.ctx!.createOscillator();
      const filter = this.ctx!.createBiquadFilter();
      const gain = this.ctx!.createGain();

      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(f * 0.97, now);
      osc.frequency.linearRampToValueAtTime(f, now + 0.14);

      filter.type = 'lowpass';
      filter.frequency.value = 560;

      gain.gain.setValueAtTime(0.001, now);
      gain.gain.linearRampToValueAtTime(0.095, now + 0.12);
      gain.gain.setValueAtTime(0.09, now + 1.1);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 2.0);

      osc.connect(filter);
      filter.connect(gain);
      gain.connect(this.masterGain!);
      osc.start(now);
      osc.stop(now + 2.05);
    });
  }

  public playRescueFlare(): void {
    if (!this.ctx || !this.masterGain || this.muted) return;
    const now = this.ctx.currentTime;
    const dur = 0.75;
    const buf = this.ctx.createBuffer(1, Math.floor(this.ctx.sampleRate * dur), this.ctx.sampleRate);
    const ch = buf.getChannelData(0);
    for (let i = 0; i < ch.length; i++) {
      ch[i] = (Math.random() * 2 - 1) * Math.exp(-i / (this.ctx.sampleRate * 0.25));
    }
    const noise = this.ctx.createBufferSource();
    noise.buffer = buf;

    const bp = this.ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.setValueAtTime(900, now);
    bp.frequency.exponentialRampToValueAtTime(2200, now + dur);
    bp.Q.value = 2.0;

    const gain = this.ctx.createGain();
    gain.gain.setValueAtTime(0.09, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + dur);

    noise.connect(bp);
    bp.connect(gain);
    gain.connect(this.masterGain);
    noise.start(now);
  }

  public playLookoutBell(): void {
    if (!this.ctx || !this.masterGain || this.muted) return;
    const now = this.ctx.currentTime;
    // Urgent triple bell from the Crow's Nest
    [0, 0.15, 0.3].forEach((offset) => {
      const osc = this.ctx!.createOscillator();
      const overtone = this.ctx!.createOscillator();
      const gain = this.ctx!.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(1760, now + offset);
      overtone.type = 'sine';
      overtone.frequency.setValueAtTime(2640, now + offset);

      gain.gain.setValueAtTime(0.12, now + offset);
      gain.gain.exponentialRampToValueAtTime(0.001, now + offset + 0.35);

      osc.connect(gain);
      overtone.connect(gain);
      gain.connect(this.masterGain!);
      osc.start(now + offset);
      overtone.start(now + offset);
      osc.stop(now + offset + 0.38);
      overtone.stop(now + offset + 0.38);
    });
  }

  public playNearMissChime(): void {
    if (!this.ctx || !this.masterGain || this.muted) return;
    const now = this.ctx.currentTime;
    [523.25, 659.25].forEach((freq, i) => {
      const osc = this.ctx!.createOscillator();
      const gain = this.ctx!.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(freq, now + i * 0.08);
      gain.gain.setValueAtTime(0.1, now + i * 0.08);
      gain.gain.exponentialRampToValueAtTime(0.001, now + i * 0.08 + 0.35);
      osc.connect(gain);
      gain.connect(this.masterGain!);
      osc.start(now + i * 0.08);
      osc.stop(now + i * 0.08 + 0.38);
    });
  }

  public playCollisionImpact(severity: number): void {
    if (!this.ctx || !this.masterGain || this.muted) return;
    const now = this.ctx.currentTime;
    const clamped = Math.min(1, Math.max(0.25, severity));

    // Low hull boom
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(88, now);
    osc.frequency.exponentialRampToValueAtTime(26, now + 0.65);
    gain.gain.setValueAtTime(0.35 * clamped, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.75);
    osc.connect(gain);
    gain.connect(this.masterGain);
    osc.start(now);
    osc.stop(now + 0.8);

    // Metallic hull screech / tearing steel + shattering ice noise
    const dur = 0.7;
    const buf = this.ctx.createBuffer(1, Math.floor(this.ctx.sampleRate * dur), this.ctx.sampleRate);
    const ch = buf.getChannelData(0);
    for (let i = 0; i < ch.length; i++) {
      ch[i] = (Math.random() * 2 - 1) * Math.exp(-i / (this.ctx.sampleRate * 0.22));
    }
    const noise = this.ctx.createBufferSource();
    noise.buffer = buf;

    const bp = this.ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.setValueAtTime(620, now);
    bp.frequency.exponentialRampToValueAtTime(190, now + dur);
    bp.Q.value = 1.6;

    const nGain = this.ctx.createGain();
    nGain.gain.setValueAtTime(0.45 * clamped, now);
    nGain.gain.exponentialRampToValueAtTime(0.001, now + dur);

    noise.connect(bp);
    bp.connect(nGain);
    nGain.connect(this.masterGain);
    noise.start(now);
  }

  public playHullGroan(intensity = 1): void {
    if (!this.ctx || !this.masterGain || this.muted) return;
    const now = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const osc2 = this.ctx.createOscillator();
    const filter = this.ctx.createBiquadFilter();
    const gain = this.ctx.createGain();

    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(52, now);
    osc.frequency.linearRampToValueAtTime(34, now + 1.8);

    osc2.type = 'triangle';
    osc2.frequency.setValueAtTime(79, now);
    osc2.frequency.linearRampToValueAtTime(48, now + 1.8);

    filter.type = 'lowpass';
    filter.frequency.value = 180;

    gain.gain.setValueAtTime(0.001, now);
    gain.gain.linearRampToValueAtTime(0.24 * Math.min(1, intensity), now + 0.35);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 2.1);

    osc.connect(filter);
    osc2.connect(filter);
    filter.connect(gain);
    gain.connect(this.masterGain);

    osc.start(now);
    osc2.start(now);
    osc.stop(now + 2.15);
    osc2.stop(now + 2.15);
  }

  public playBreakupSnap(): void {
    if (!this.ctx || !this.masterGain || this.muted) return;
    const now = this.ctx.currentTime;

    // 1. Massive low-frequency keel & girder snap boom
    const subOsc = this.ctx.createOscillator();
    const subGain = this.ctx.createGain();
    subOsc.type = 'sawtooth';
    subOsc.frequency.setValueAtTime(105, now);
    subOsc.frequency.exponentialRampToValueAtTime(22, now + 1.4);
    subGain.gain.setValueAtTime(0.42, now);
    subGain.gain.exponentialRampToValueAtTime(0.001, now + 1.5);
    subOsc.connect(subGain);
    subGain.connect(this.masterGain);
    subOsc.start(now);
    subOsc.stop(now + 1.55);

    // 2. Two-stage tearing steel screech & collapsing bulkheads
    [0, 0.24].forEach((offset, idx) => {
      const dur = idx === 0 ? 1.15 : 1.55;
      const buf = this.ctx!.createBuffer(
        1,
        Math.floor(this.ctx!.sampleRate * dur),
        this.ctx!.sampleRate,
      );
      const ch = buf.getChannelData(0);
      for (let i = 0; i < ch.length; i++) {
        ch[i] = (Math.random() * 2 - 1) * Math.exp(-i / (this.ctx!.sampleRate * (idx === 0 ? 0.32 : 0.48)));
      }
      const noise = this.ctx!.createBufferSource();
      noise.buffer = buf;

      const bp = this.ctx!.createBiquadFilter();
      bp.type = 'bandpass';
      bp.frequency.setValueAtTime(idx === 0 ? 860 : 480, now + offset);
      bp.frequency.exponentialRampToValueAtTime(140, now + offset + dur);
      bp.Q.value = 1.9;

      const nGain = this.ctx!.createGain();
      nGain.gain.setValueAtTime(idx === 0 ? 0.45 : 0.38, now + offset);
      nGain.gain.exponentialRampToValueAtTime(0.001, now + offset + dur);

      noise.connect(bp);
      bp.connect(nGain);
      nGain.connect(this.masterGain!);
      noise.start(now + offset);
    });
  }

  public updateSinkingAmbience(sinkProgress: number): void {
    if (!this.initialized || !this.ctx || !this.engineGain || !this.engineOsc1 || !this.engineOsc2 || !this.oceanNoiseGain || !this.oceanFilter) {
      return;
    }
    const t = this.ctx.currentTime;
    // Turbines fail as boiler rooms flood
    const powerLeft = Math.max(0, 1 - sinkProgress * 1.4);
    this.engineGain.gain.setTargetAtTime(0.04 * powerLeft, t, 0.15);
    this.engineOsc1.frequency.setTargetAtTime(22 + powerLeft * 36, t, 0.2);
    this.engineOsc2.frequency.setTargetAtTime(33 + powerLeft * 54, t, 0.2);

    // Rushing floodwater swells loudly
    this.oceanNoiseGain.gain.setTargetAtTime(0.14 + sinkProgress * 0.22, t, 0.2);
    this.oceanFilter.frequency.setTargetAtTime(340 + sinkProgress * 580, t, 0.2);
  }

  public dispose(): void {
    try {
      this.engineOsc1?.stop();
      this.engineOsc2?.stop();
      void this.ctx?.close();
    } catch {
      // ignore close errors
    }
    this.ctx = null;
    this.initialized = false;
  }
}
