(function () {
  'use strict';

  var PI = '3141592653589793238462643383279502884197169399375105820974944592307816406286208998628034825342117067';

  var starsCv = document.getElementById('bg-stars');
  var digitsCv = document.getElementById('bg-digits');
  var sctx = starsCv.getContext('2d');
  var dctx = digitsCv.getContext('2d');

  var W = 0, H = 0;
  var stars = [];
  var columns = [];
  var bursts = [];

  // 动画状态（平滑过渡）
  var pull = 0, pullTarget = 0;
  var boost = 1, boostTarget = 1;

  function rand(a, b) { return a + Math.random() * (b - a); }

  function resize() {
    var dpr = Math.min(window.devicePixelRatio || 1, 1.5);
    W = window.innerWidth;
    H = window.innerHeight;
    [starsCv, digitsCv].forEach(function (cv) {
      cv.width = Math.round(W * dpr);
      cv.height = Math.round(H * dpr);
      cv.style.width = W + 'px';
      cv.style.height = H + 'px';
    });
    sctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    dctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    buildStars();
    buildColumns();
  }

  function buildStars() {
    stars = [];
    var n = Math.min(240, Math.round((W * H) / 8200));
    for (var i = 0; i < n; i++) {
      stars.push({
        x: Math.random() * W,
        y: Math.random() * H,
        r: rand(0.4, 1.9),
        a: rand(0.18, 0.85),
        tw: Math.random() * Math.PI * 2,
        sp: rand(0.4, 1.4)
      });
    }
  }

  function digitAt(offset) {
    return PI.charAt((offset + PI.length) % PI.length);
  }

  function buildColumns() {
    columns = [];
    var gap = 30;
    var count = Math.max(1, Math.floor(W / gap));
    for (var c = 0; c < count; c++) {
      columns.push({
        x: c * gap + 6,
        y: rand(-H, 0),
        sp: rand(24, 78),
        off: Math.floor(rand(0, 200)),
        bright: rand(0.06, 0.2)
      });
    }
  }

  function tick(ts, dt) {
    pull += (pullTarget - pull) * Math.min(1, dt * 4);
    boost += (boostTarget - boost) * Math.min(1, dt * 3);

    // ── 星场 ──
    sctx.clearRect(0, 0, W, H);
    var cx = W / 2, cy = H / 2;
    var spiral = pull * (ts / 1000) * 1.2;

    // 统一用 globalAlpha 控制亮度，避免逐星拼接颜色字符串
    sctx.fillStyle = 'rgb(165, 212, 255)';
    for (var i = 0; i < stars.length; i++) {
      var s = stars[i];
      var tx = s.x, ty = s.y;

      if (pull > 0.01) {
        // 向中心螺旋收拢
        var dx = s.x - cx, dy = s.y - cy;
        var k = 1 - pull * 0.82;
        var rot = spiral * (0.35 + s.r);
        var cos = Math.cos(rot), sin = Math.sin(rot);
        tx = cx + (dx * cos - dy * sin) * k;
        ty = cy + (dx * sin + dy * cos) * k;
      }

      var alpha = s.a * (0.55 + 0.45 * Math.sin(ts / 900 * s.sp + s.tw));
      alpha *= 1 + pull * 0.5;

      sctx.globalAlpha = Math.min(1, alpha);
      sctx.beginPath();
      sctx.arc(tx, ty, s.r * (1 + pull * 0.8), 0, Math.PI * 2);
      sctx.fill();

      if (s.r > 1.5 && pull < 0.15) {
        sctx.globalAlpha = Math.min(1, alpha * 0.1);
        sctx.beginPath();
        sctx.arc(tx, ty, s.r * 3.5, 0, Math.PI * 2);
        sctx.fill();
      }
    }
    sctx.globalAlpha = 1;

    // ── π 数字雨 ──
    dctx.clearRect(0, 0, W, H);

    // 汇合阶段数字雨会明显拖慢帧率，随收拢逐渐淡出直至停绘
    var rainFade = 1 - pull * 1.7;
    if (rainFade > 0.02) {
      dctx.font = '13px Consolas, "Courier New", monospace';
      dctx.textBaseline = 'middle';
      dctx.fillStyle = pull > 0.35 ? '#ffd682' : '#78beff';

      for (var c = 0; c < columns.length; c++) {
        var col = columns[c];
        col.y += col.sp * dt * boost;
        if (col.y > H + 160) {
          col.y = -rand(60, 260);
          col.off = (col.off + 7) % PI.length;
          col.bright = rand(0.06, 0.2);
        }
        col.off = (col.off + dt * 6 * boost) % PI.length;

        var tail = 8;
        for (var r = 0; r < tail; r++) {
          var yy = col.y - r * 22;
          if (yy < -20 || yy > H + 20) continue;
          var a = col.bright * (1 - r / tail) * (1.6 + pull * 1.6) * rainFade;
          dctx.globalAlpha = Math.min(0.8, a);
          dctx.fillText(digitAt(Math.floor(col.off) + r * 3), col.x, yy);
        }
      }
      dctx.globalAlpha = 1;
    }

    // ── 爆发粒子 ──
    for (var b = bursts.length - 1; b >= 0; b--) {
      var p = bursts[b];
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.vy += 26 * dt;
      p.vx *= 0.985;
      p.vy *= 0.985;
      p.life -= dt;
      var la = Math.max(0, p.life / p.max);
      if (la <= 0) { bursts.splice(b, 1); continue; }

      sctx.globalAlpha = la;
      if (p.char) {
        sctx.font = p.size + 'px Consolas, "Courier New", monospace';
        sctx.fillStyle = p.color + la + ')';
        sctx.fillText(p.char, p.x, p.y);
      } else {
        sctx.beginPath();
        sctx.arc(p.x, p.y, p.size * 0.5, 0, Math.PI * 2);
        sctx.fillStyle = p.color + la + ')';
        sctx.fill();
      }
      sctx.globalAlpha = 1;
    }
  }

  var last = 0;
  function frame(ts) {
    if (!last) last = ts;
    var dt = Math.min(0.05, (ts - last) / 1000);
    last = ts;
    tick(ts, dt);
    requestAnimationFrame(frame);
  }

  window.addEventListener('resize', resize);
  resize();
  requestAnimationFrame(frame);

  window.PiScene = {
    attract: function (on) { pullTarget = on ? 1 : 0; },
    boost: function (v) { boostTarget = v; },
    burst: function (count) {
      count = count || 70;
      var cx = W / 2, cy = H / 2;
      for (var i = 0; i < count; i++) {
        var ang = Math.random() * Math.PI * 2;
        var sp = rand(120, 520);
        var life = rand(0.9, 1.8);
        bursts.push({
          x: cx + rand(-40, 40),
          y: cy + rand(-30, 30),
          vx: Math.cos(ang) * sp,
          vy: Math.sin(ang) * sp - 120,
          life: life,
          max: life,
          size: rand(11, 22),
          char: Math.random() > 0.45 ? digitAt(Math.floor(Math.random() * 200)) : '',
          color: Math.random() > 0.5 ? 'rgba(255, 214, 130, ' : 'rgba(120, 220, 255, '
        });
      }
    }
  };
})();
