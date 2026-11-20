(function () {
  'use strict';

  var STORAGE_KEY = 'pi_carnival_audio';
  var ctx = null;
  var master = null;
  var comp = null;
  var wetBus = null;
  var darkBus = null;
  var noiseBuf = null;
  var muted = false;
  var ambientStarted = false;
  var pannerOk = false;

  try {
    muted = localStorage.getItem(STORAGE_KEY) === 'off';
  } catch (e) { /* 忽略 */ }

  function makeNoise() {
    var len = Math.floor(ctx.sampleRate * 1.5);
    var buf = ctx.createBuffer(1, len, ctx.sampleRate);
    var data = buf.getChannelData(0);
    for (var i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
    return buf;
  }

  function makeImpulse(seconds, decay) {
    var rate = ctx.sampleRate;
    var len = Math.floor(rate * seconds);
    var buf = ctx.createBuffer(2, len, rate);
    for (var ch = 0; ch < 2; ch++) {
      var d = buf.getChannelData(ch);
      for (var i = 0; i < len; i++) {
        var k = i / len;
        d[i] = (Math.random() * 2 - 1) * Math.pow(1 - k, decay);
      }
    }
    return buf;
  }

  function createCtx() {
    if (ctx) return ctx;
    var AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;

    ctx = new AC();
    pannerOk = typeof ctx.createStereoPanner === 'function';

    master = ctx.createGain();
    master.gain.value = muted ? 0 : 0.82;

    comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -18;
    comp.knee.value = 26;
    comp.ratio.value = 3.4;
    comp.attack.value = 0.006;
    comp.release.value = 0.3;

    master.connect(comp);
    comp.connect(ctx.destination);

    // 暗色总线：削掉高频毛刺，让整体贴住大屏的厚重感
    darkBus = ctx.createBiquadFilter();
    darkBus.type = 'lowpass';
    darkBus.frequency.value = 2200;
    darkBus.Q.value = 0.6;
    darkBus.connect(master);

    // 更长更暗的混响，制造空间纵深
    var conv = ctx.createConvolver();
    conv.buffer = makeImpulse(3.6, 2.4);
    var wet = ctx.createGain();
    wet.gain.value = 0.36;
    conv.connect(wet);
    wet.connect(master);
    wetBus = conv;

    noiseBuf = makeNoise();
    startAmbient();
    return ctx;
  }

  function startAmbient() {
    if (ambientStarted) return;
    ambientStarted = true;

    var t = ctx.currentTime;
    var bus = ctx.createGain();
    bus.gain.setValueAtTime(0.0001, t);
    bus.gain.linearRampToValueAtTime(0.022, t + 3.5);

    var filt = ctx.createBiquadFilter();
    filt.type = 'lowpass';
    filt.frequency.value = 260;
    filt.Q.value = 1.8;

    var o1 = ctx.createOscillator();
    o1.type = 'sine';
    o1.frequency.value = 48;

    var o2 = ctx.createOscillator();
    o2.type = 'sawtooth';
    o2.frequency.value = 96;
    o2.detune.value = 8;

    var o3 = ctx.createOscillator();
    o3.type = 'sine';
    o3.frequency.value = 64;
    o3.detune.value = -11;

    var lfo = ctx.createOscillator();
    lfo.frequency.value = 0.05;
    var lfoGain = ctx.createGain();
    lfoGain.gain.value = 90;

    lfo.connect(lfoGain);
    lfoGain.connect(filt.frequency);
    o1.connect(filt);
    o2.connect(filt);
    o3.connect(filt);
    filt.connect(bus);
    bus.connect(darkBus);

    o1.start(t);
    o2.start(t);
    o3.start(t);
    lfo.start(t);
  }

  function out(node, wet, pan, dark) {
    var cur = node;
    if (pannerOk && pan) {
      var p = ctx.createStereoPanner();
      p.pan.value = Math.max(-1, Math.min(1, pan));
      cur.connect(p);
      cur = p;
    }
    cur.connect(dark ? darkBus : master);
    if (wet) {
      var s = ctx.createGain();
      s.gain.value = wet;
      cur.connect(s);
      s.connect(wetBus);
    }
  }

  function tone(opt) {
    if (!ctx) return;
    var t0 = ctx.currentTime + (opt.delay || 0);
    var dur = opt.dur || 0.2;
    var peak = opt.gain == null ? 0.15 : opt.gain;
    var attack = opt.attack == null ? 0.02 : opt.attack;

    var osc = ctx.createOscillator();
    osc.type = opt.type || 'sine';
    osc.frequency.setValueAtTime(opt.freq, t0);
    if (opt.to) osc.frequency.exponentialRampToValueAtTime(Math.max(1, opt.to), t0 + dur);

    var g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(peak, t0 + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);

    var tail = osc;
    if (opt.filter) {
      var f = ctx.createBiquadFilter();
      f.type = 'lowpass';
      f.frequency.setValueAtTime(opt.filter[0], t0);
      f.frequency.exponentialRampToValueAtTime(opt.filter[1], t0 + dur);
      osc.connect(f);
      tail = f;
    }
    tail.connect(g);
    out(g, opt.wet, opt.pan, opt.dark);

    osc.start(t0);
    osc.stop(t0 + dur + 0.06);
  }

  function pulseAt(t0, o) {
    if (!ctx) return;
    var dur = o.dur || 0.05;

    var osc = ctx.createOscillator();
    osc.type = o.type || 'sine';
    osc.frequency.setValueAtTime(o.freq, t0);
    if (o.to) osc.frequency.exponentialRampToValueAtTime(Math.max(1, o.to), t0 + dur);
    if (o.detune) osc.detune.value = o.detune;

    var g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(o.gain, t0 + (o.attack || 0.008));
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);

    osc.connect(g);
    out(g, o.wet, o.pan, o.dark);

    osc.start(t0);
    osc.stop(t0 + dur + 0.02);
  }

  function noiseAt(t0, o) {
    if (!ctx) return;
    var dur = o.dur || 0.06;

    var src = ctx.createBufferSource();
    src.buffer = noiseBuf;
    src.loop = true;

    var f = ctx.createBiquadFilter();
    f.type = o.type || 'bandpass';
    f.Q.value = o.q || 1.6;
    f.frequency.setValueAtTime(o.freq || 600, t0);
    if (o.to) f.frequency.exponentialRampToValueAtTime(Math.max(20, o.to), t0 + dur);

    var g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(o.gain, t0 + (o.attack || 0.02));
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);

    src.connect(f);
    f.connect(g);
    out(g, o.wet, o.pan, o.dark);

    src.start(t0);
    src.stop(t0 + dur + 0.02);
  }

  function noiseHit(opt) {
    if (!ctx) return;
    noiseAt(ctx.currentTime + (opt.delay || 0), {
      freq: opt.freq,
      to: opt.to,
      dur: opt.dur,
      gain: opt.gain || 0.2,
      type: opt.type,
      q: opt.q,
      wet: opt.wet,
      pan: opt.pan,
      dark: opt.dark,
      attack: opt.attack
    });
  }

  // 钟琴：泛音收敛，整体偏暖
  function bell(freq, delay, gain, wet) {
    var parts = [1, 2.0, 3.01];
    var gains = [1, 0.34, 0.12];
    var durs = [1.9, 1.1, 0.7];

    for (var k = 0; k < parts.length; k++) {
      tone({
        freq: freq * parts[k],
        dur: durs[k],
        type: 'sine',
        gain: gain * gains[k],
        delay: delay,
        attack: 0.012,
        wet: wet,
        dark: true
      });
    }
  }

  function stopTicks() { /* 数据流用音频时钟预排，无需清理 */ }

  function beep(freq, gain) {
    tone({ freq: freq, dur: 0.12, type: 'sine', gain: gain == null ? 0.04 : gain, dark: true });
  }

  window.PiAudio = {
    unlock: function () {
      if (!createCtx()) return;
      if (ctx.state === 'suspended') ctx.resume();
    },

    isMuted: function () { return muted; },

    toggle: function () {
      muted = !muted;
      try { localStorage.setItem(STORAGE_KEY, muted ? 'off' : 'on'); } catch (e) { /* 忽略 */ }
      if (createCtx()) {
        var t = ctx.currentTime;
        master.gain.cancelScheduledValues(t);
        master.gain.setValueAtTime(master.gain.value, t);
        master.gain.linearRampToValueAtTime(muted ? 0 : 0.82, t + 0.3);
      }
      if (!muted) beep(520, 0.05);
      return muted;
    },

    // 点击：闷响，不刺耳
    click: function () {
      if (!ctx || muted) return;
      noiseAt(ctx.currentTime + 0.005, {
        freq: 1400, dur: 0.06, gain: 0.025, type: 'lowpass', q: 0.9, dark: true
      });
      tone({ freq: 320, to: 240, dur: 0.09, type: 'sine', gain: 0.03, dark: true });
    },

    // 蓄力：深渊低频 + 暗色张力层 + 隧道气流 + 加速声呐
    charge: function (seconds) {
      if (!ctx || muted) return;
      var d = Math.max(1.6, seconds || 3.9);
      var t0 = ctx.currentTime + 0.02;

      // 1) 超低频基石，缓慢下沉
      tone({ freq: 38, to: 29, dur: d, type: 'sine', gain: 0.13, attack: 1.1 });
      tone({ freq: 76, to: 57, dur: d, type: 'sine', gain: 0.055, attack: 1.4, dark: true });

      // 2) 双锯齿张力层：低通缓慢打开，形成"能量在上涌"
      tone({
        freq: 55, to: 68, dur: d, type: 'sawtooth',
        gain: 0.032, filter: [150, 820], attack: 1.0, dark: true
      });
      tone({
        freq: 82.4, to: 96, dur: d, type: 'sawtooth',
        gain: 0.024, filter: [180, 640], attack: 1.2, dark: true, wet: 0.3
      });

      // 3) 隧道气流：窄带噪声从极低扫到中低
      noiseAt(t0, {
        freq: 110, to: 980, dur: d, gain: 0.075,
        type: 'bandpass', q: 0.85, attack: 1.5, dark: true, wet: 0.4
      });

      // 4) 声呐脉冲：节奏由缓到急，带长混响
      var tt = t0 + 0.5;
      var end = t0 + d - 0.15;

      while (tt < end) {
        var p = (tt - t0) / d;

        pulseAt(tt, {
          freq: 196 + p * 70,
          dur: 0.3,
          gain: 0.028 + p * 0.018,
          type: 'sine',
          wet: 0.75,
          dark: true
        });

        pulseAt(tt, {
          freq: 64,
          to: 40,
          dur: 0.17,
          gain: 0.05 + p * 0.035,
          type: 'sine',
          dark: true
        });

        // 间隙从 620ms 收紧到 150ms
        tt += 0.62 - p * 0.47;
      }
    },

    // 数据流：低中频颗粒，密度与音高随进度攀升
    startTicks: function (duration) {
      if (!ctx || muted) return;

      var total = (duration || 3560) / 1000;
      var t0 = ctx.currentTime + 0.02;
      var end = t0 + total;
      var t = t0;

      while (t < end - 0.03) {
        var p = (t - t0) / total;
        var pan = (Math.random() * 2 - 1) * 0.7;

        // 颗粒：三角波中低频，短促但不尖
        pulseAt(t, {
          freq: 230 + p * 300 + Math.random() * 70,
          dur: 0.05 + Math.random() * 0.03,
          gain: 0.02 + p * 0.014,
          type: 'triangle',
          pan: pan,
          dark: true
        });

        // 噪声颗粒：滤波在 1kHz 内，闷
        if (Math.random() < 0.34) {
          noiseAt(t + 0.003, {
            freq: 700 + Math.random() * 900,
            dur: 0.045,
            gain: 0.014 + p * 0.01,
            type: 'lowpass',
            q: 1.2,
            pan: pan,
            dark: true
          });
        }

        // 周期性的伺服扫描
        if (Math.random() < 0.06) {
          noiseAt(t, {
            freq: 380, to: 1250, dur: 0.36,
            gain: 0.02, type: 'bandpass', q: 5,
            pan: pan, dark: true, wet: 0.3
          });
        }

        var gap = (0.14 * Math.pow(1 - p, 1.45) + 0.028) * (0.65 + Math.random() * 0.7);
        t += gap;
      }
    },

    stopTicks: stopTicks,

    // 绘制核心：随笔画落点的细密走线声
    trace: function (seconds) {
      if (!ctx || muted) return;

      var dur = Math.max(0.4, seconds || 0.95);
      var t0 = ctx.currentTime + 0.01;
      var n = 26;

      for (var i = 0; i < n; i++) {
        var p = i / (n - 1);
        pulseAt(t0 + Math.pow(p, 0.92) * dur, {
          freq: 1180 + p * 820,
          dur: 0.028,
          gain: 0.012 + p * 0.009,
          type: 'triangle',
          pan: (Math.random() * 2 - 1) * 0.5,
          dark: true
        });
      }

      // 走线时的低频支撑，避免只有高频颗粒
      tone({ freq: 82, dur: dur + 0.3, type: 'sine', gain: 0.06, attack: 0.25, dark: true });
    },

    // 核心点亮：低频合鸣 + 缓升谐波，接住整个汇合过程
    power: function (buildTo) {
      if (!ctx || muted) return;
      var t0 = ctx.currentTime + 0.01;
      var build = Math.max(0.8, buildTo || 1.7);

      // 三音合鸣：根音、五度、八度
      tone({ freq: 55, dur: 2.6, type: 'sine', gain: 0.11, attack: 0.12, dark: true });
      tone({ freq: 82.5, dur: 2.2, type: 'sine', gain: 0.06, attack: 0.2, dark: true });
      tone({ freq: 110, dur: 1.8, type: 'triangle', gain: 0.04, attack: 0.3, dark: true, wet: 0.5 });

      // 缓慢上涌的谐波，正好推向公布时刻
      tone({
        freq: 110, to: 330, dur: build, type: 'sawtooth',
        gain: 0.032, filter: [280, 1600], attack: 0.5, dark: true, wet: 0.4
      });

      // 点亮瞬间的金属振铃
      pulseAt(t0, { freq: 660, dur: 0.6, gain: 0.05, type: 'sine', wet: 0.7, dark: true });
      pulseAt(t0 + 0.02, { freq: 990, dur: 0.42, gain: 0.028, type: 'sine', wet: 0.7, dark: true });

      // 极低的落地感
      tone({ freq: 62, to: 44, dur: 0.7, type: 'sine', gain: 0.12, attack: 0.01, dark: true });
    },

    // 揭晓：低频落锤 + 机械闭锁，不用噪声爆破（避免烟花感）
    impact: function () {
      if (!ctx || muted) return;
      var t0 = ctx.currentTime;

      // 1) 落锤：短起音、快速下潜，重量集中
      tone({ freq: 132, to: 30, dur: 0.85, type: 'sine', gain: 0.36, attack: 0.008 });

      // 2) 中低频躯干，给"实心"的冲击感
      tone({ freq: 268, to: 74, dur: 0.34, type: 'triangle', gain: 0.09, attack: 0.006, dark: true });

      // 3) 机械闭锁：两声高 Q 短脉冲，像继电器咬合
      noiseAt(t0, {
        freq: 720, dur: 0.028, gain: 0.05, type: 'bandpass', q: 9, dark: true
      });
      noiseAt(t0 + 0.062, {
        freq: 560, dur: 0.026, gain: 0.038, type: 'bandpass', q: 10, dark: true
      });

      // 4) 暗金属余响
      tone({ freq: 330, to: 296, dur: 0.55, type: 'sine', gain: 0.045, wet: 0.7, dark: true });
      tone({ freq: 494, dur: 0.32, type: 'sine', gain: 0.022, wet: 0.6, dark: true });

      // 5) 低频余震，缓慢铺开
      tone({ freq: 44, dur: 1.9, type: 'sine', gain: 0.11, attack: 0.08, dark: true });

      // 6) 机房底噪轻微抬升（不扫频，避免"呼"的爆音）
      noiseAt(t0 + 0.02, {
        freq: 160, dur: 1.6, gain: 0.045,
        type: 'lowpass', q: 0.6, attack: 0.3, dark: true, wet: 0.3
      });
    },

    // 中奖：暖调钟琴 + 低频托底，去掉高频亮点
    win: function () {
      if (!ctx || muted) return;

      var scale = [392, 440, 523.25, 587.33, 659.25, 783.99];
      for (var i = 0; i < scale.length; i++) {
        bell(scale[i], 0.08 + i * 0.095, 0.085 - i * 0.005, 0.55);
      }

      tone({ freq: 98, to: 147, dur: 2.1, type: 'sine', gain: 0.075, attack: 0.45, dark: true });
      tone({ freq: 196, dur: 1.8, type: 'triangle', gain: 0.03, attack: 0.35, dark: true, wet: 0.5 });

      for (var k = 0; k < 5; k++) {
        tone({
          freq: 1200 + Math.random() * 700,
          dur: 0.7,
          type: 'sine',
          gain: 0.01,
          delay: 0.45 + k * 0.18,
          wet: 0.8,
          dark: true
        });
      }
    },

    // 锁定：低频下行三连，机械感
    lock: function () {
      if (!ctx || muted) return;
      var t0 = ctx.currentTime + 0.01;
      var seq = [520, 390, 262];

      for (var i = 0; i < seq.length; i++) {
        pulseAt(t0 + i * 0.06, {
          freq: seq[i],
          dur: 0.11,
          gain: 0.05,
          type: 'triangle',
          pan: i % 2 ? 0.3 : -0.3,
          dark: true,
          wet: 0.35
        });
      }
      tone({ freq: 82, to: 54, dur: 0.5, type: 'sine', gain: 0.1, delay: 0.16, dark: true });
    }
  };
})();
