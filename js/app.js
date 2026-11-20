(function () {
  'use strict';

  var KEY = 'pi_carnival_v1';

  var DEFAULT_NAMES = [
    '朱旗', '曾彤', '王欣琦', '李春', '黄晓', '周雨航', '王月', '腾昆', '胡丹', '杜成',
    '张欣', '王娜', '陈浩', '刘硕', '孟真', '赵建', '周茜', '钟杰', '陈五净', '李蓉',
    '刘满', '孙浩', '徐斌', '何欣', '吴雨桐', '王翰林', '赵文博', '张子涵', '李子航', '王思远',
    '刘雨晴', '陈嘉怡', '杨梓涵', '王子轩', '刘欣然', '赵晨曦', '陈子墨', '孙可欣', '周晨阳', '吴梓晴',
    '郑一诺', '冯乐然'
  ];

  var $ = function (s) { return document.querySelector(s); };

  var cloudEl = $('#cloud');
  var netCv = $('#holo-net');
  var netCtx = netCv.getContext('2d');
  var waveCv = $('#rail-wave');
  var waveCtx = waveCv ? waveCv.getContext('2d') : null;
  var btnDraw = $('#btn-draw');
  var btnText = $('#btn-draw-text');
  var captionEl = $('#caption-text');
  var flashEl = $('#flash');
  var winnerLayer = $('#winner-layer');
  var namesEl = $('#w-names');
  var toastEl = $('#toast');
  var shockEl = $('#shockwave');
  var soundBtn = $('#btn-sound');
  var soundText = $('#sound-text');
  var fileInput = $('#file-import');
  var modalNames = $('#modal-names');
  var drawerHistory = $('#drawer-history');
  var historyList = $('#history-list');
  var namesInput = $('#names-input');

  var railLeft = document.querySelector('.rail-left');
  var railRight = document.querySelector('.rail-right');
  var matrixEl = $('#rl-matrix');
  var roundsEl = $('#rl-rounds');
  var yieldCv = $('#rl-yield');
  var yieldCtx = yieldCv ? yieldCv.getContext('2d') : null;
  var clockEl = $('#hud-clock');
  var corePi = $('#core-pi');
  var phaseEl = $('#hud-phase');
  var modeEl = $('#rl-mode');
  var latEl = $('#rl-lat');

  var state = loadState();
  var nodes = [];
  var drawing = false;
  var picked = [];

  var view = { W: 0, H: 0, rx: 0, ry: 0 };
  var anim = { yaw: 0, tilt: -0.3, radius: 1, from: 1, to: 1, t0: 0, dur: 1, spin: 1 };
  var pointer = { x: 0, y: 0 };
  var toastTimer = null;
  var latAcc = 0, latN = 0, latLast = 0;
  var yawLast = 0;

  /* ── 状态存取 ───────────────────────────── */

  function loadState() {
    try {
      var raw = localStorage.getItem(KEY);
      if (raw) {
        var d = JSON.parse(raw);
        if (Array.isArray(d.people) && d.people.length) {
          if (!Array.isArray(d.history)) d.history = [];
          return d;
        }
      }
    } catch (e) { /* 忽略损坏数据 */ }

    return {
      people: DEFAULT_NAMES.map(function (n) { return { n: n, w: false }; }),
      history: []
    };
  }

  function saveState() {
    try { localStorage.setItem(KEY, JSON.stringify(state)); } catch (e) { /* 存储不可用 */ }
  }

  /* ── 星云构建 ───────────────────────────── */

  function measure() {
    var wrap = cloudEl.parentElement;
    view.W = wrap.clientWidth;
    view.H = wrap.clientHeight;

    var count = state.people.length || 1;
    var dense = count > 150;

    // 人数较少时收敛星云半径；人数多时张开一些，给名字留出间距
    var density = Math.min(1, Math.max(0.7, Math.sqrt(count / 40)));
    var kw = dense ? 0.47 : 0.38;
    var kh = dense ? 0.44 : 0.36;

    view.rx = Math.min(view.W * kw, 680) * (dense ? 1 : density);
    view.ry = Math.min(view.H * kh, 420) * (dense ? 1 : density);
  }

  // 顶栏、侧栏与操作坞尺寸变化时，同步星云可用区域（CSS 变量驱动，避免遮挡）
  function syncLayout() {
    var hudEl = document.querySelector('.hud');
    var dockEl = document.querySelector('.dock');
    var style = document.documentElement.style;
    var dockH = dockEl ? dockEl.getBoundingClientRect().height : 150;

    if (hudEl) style.setProperty('--cloud-top', Math.round(hudEl.getBoundingClientRect().height) + 34 + 'px');
    if (dockEl) style.setProperty('--dock-h', Math.round(dockH) + 'px');

    // 侧栏可见时，为中央全息核心让出左右空间
    var lw = railLeft ? railLeft.getBoundingClientRect().width : 0;
    var rw = railRight ? railRight.getBoundingClientRect().width : 0;
    style.setProperty('--cloud-left', Math.round(lw ? lw + 74 : 0) + 'px');
    style.setProperty('--cloud-right', Math.round(rw ? rw + 74 : 0) + 'px');

    // 中央核心区尺寸：按可用区域约束，避免与左右数据栏重叠
    var telEl = document.querySelector('.telemetry');
    var telH = telEl ? telEl.getBoundingClientRect().height : 0;
    var extra = telH ? telH + 48 : 0;
    style.setProperty('--cloud-bottom', Math.round(dockH + 24 + extra) + 'px');
    measure();

    var core = Math.max(200, Math.min(view.W * 0.96, view.H * 0.98));
    style.setProperty('--core-size', Math.round(core) + 'px');

    var dpr = Math.min(window.devicePixelRatio || 1, 1.5);
    netCv.width = Math.round(view.W * dpr);
    netCv.height = Math.round(view.H * dpr);
    netCtx.setTransform(dpr, 0, 0, dpr, 0, 0);

    sizeYield();
  }

  function sizeYield() {
    if (!yieldCv || !yieldCtx) return;
    var w = yieldCv.clientWidth;
    if (!w) return;
    var dpr = Math.min(window.devicePixelRatio || 1, 1.5);
    yieldCv.width = Math.round(w * dpr);
    yieldCv.height = 96 * dpr;
    yieldCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  function buildCloud() {
    cloudEl.innerHTML = '';
    nodes = [];
    var people = state.people;
    var total = people.length;

    // 人数多时收紧球壳、压缩字号，避免糊成一团
    var dense = total > 150;
    var jitterMin = dense ? 0.95 : 0.82;
    var jitterSpan = dense ? 0.1 : 0.3;

    cloudEl.className = 'cloud' +
      (total > 260 ? ' d3' : total > 160 ? ' d2' : total > 90 ? ' d1' : '');

    people.forEach(function (person, i) {
      var el = document.createElement('span');
      el.className = 'name' + (person.w ? ' won' : '');
      el.textContent = person.n;
      cloudEl.appendChild(el);

      // 斐波那契球面分布 + 轻微随机抖动，避免过于规整
      // 用 (i+0.5)/n 取纬度，避开两极，少量姓名时也不会挤成一条竖线
      var y = 1 - ((i + 0.5) / total) * 2;
      var r = Math.sqrt(Math.max(0, 1 - y * y));
      var phi = i * 2.399963229728653;
      var jitter = jitterMin + Math.random() * jitterSpan;

      nodes.push({
        el: el,
        x: Math.cos(phi) * r * jitter,
        y: y * jitter,
        z: Math.sin(phi) * r * jitter,
        index: i,
        op: -1,
        zi: -1
      });
    });

    buildLinks();
    measure();

    // 名单缩小时同步截断投影缓冲，避免残留旧节点数据
    if (screenBuf.length > nodes.length) screenBuf.length = nodes.length;
  }

  // 邻居连线在建球时算一次，逐帧只做投影，避免 O(n²) 拖慢动画
  var links = [];
  var screenBuf = [];
  var cloudFrame = 0;
  function buildLinks() {
    links = [];
    var n = nodes.length;
    if (n < 2) return;

    var deg = n > 200 ? 2 : (n > 100 ? 3 : 4);
    var maxD2 = 0.45;
    var seen = {};

    for (var i = 0; i < n; i++) {
      var bi = [], bd = [];

      for (var j = 0; j < n; j++) {
        if (j === i) continue;

        var dx = nodes[i].x - nodes[j].x;
        var dy = nodes[i].y - nodes[j].y;
        var dz = nodes[i].z - nodes[j].z;
        var d2 = dx * dx + dy * dy + dz * dz;
        if (d2 > maxD2) continue;

        if (bi.length < deg) {
          bi.push(j);
          bd.push(d2);
        } else {
          var m = 0;
          for (var t = 1; t < deg; t++) if (bd[t] > bd[m]) m = t;
          if (d2 < bd[m]) { bi[m] = j; bd[m] = d2; }
        }
      }

      for (var k = 0; k < bi.length; k++) {
        var a = i < bi[k] ? i : bi[k];
        var b = i < bi[k] ? bi[k] : i;
        var key = a + '_' + b;
        if (seen[key]) continue;
        seen[key] = 1;
        links.push(a, b, 1 - bd[k] / maxD2);
      }
    }
  }

  function radiusTween(to, dur) {
    anim.from = anim.radius;
    anim.to = to;
    anim.t0 = performance.now();
    anim.dur = dur;
  }

  function easeInOut(p) {
    return p < 0.5 ? 2 * p * p : 1 - Math.pow(-2 * p + 2, 2) / 2;
  }

  // 与姓名星云共用同一套投影，供全息网格与连线使用
  function project3(x, y, z, cy, sy, ct, st) {
    var rx = x * cy - z * sy;
    var rz = x * sy + z * cy;
    var ry = y * ct - rz * st;
    var rz2 = y * st + rz * ct;
    var f = 2.9 / (3.4 - rz2);
    return {
      x: rx * view.rx * f * anim.radius,
      y: ry * view.ry * f * anim.radius,
      z: rz2,
      f: f
    };
  }

  // 就地写入投影结果，避免逐帧产生大量临时对象
  function project3Into(o, x, y, z, cy, sy, ct, st) {
    var rx = x * cy - z * sy;
    var rz = x * sy + z * cy;
    var ry = y * ct - rz * st;
    var rz2 = y * st + rz * ct;
    var f = 2.9 / (3.4 - rz2);
    o.x = rx * view.rx * f * anim.radius;
    o.y = ry * view.ry * f * anim.radius;
    o.z = rz2;
    o.f = f;
    return o;
  }

  function drawNet(screen, cy, sy, ct, st) {
    if (!netCtx || !view.W) return;

    var ox = view.W / 2, oy = view.H / 2;
    netCtx.clearRect(0, 0, view.W, view.H);
    netCtx.lineWidth = 1;

    var tone = drawing ? '227, 189, 118' : '99, 200, 255';
    var vis = 0.35 + 0.65 * Math.min(1, anim.radius);

    // 全息经纬网
    netCtx.strokeStyle = 'rgba(' + tone + ',' + (0.07 * vis) + ')';
    var SEG = 32;
    for (var li = -2; li <= 2; li++) {
      var yy = li / 3.4;
      var rr = Math.sqrt(1 - yy * yy);
      netCtx.beginPath();
      for (var s = 0; s <= SEG; s++) {
        var a = (s / SEG) * Math.PI * 2;
        var p = project3(Math.cos(a) * rr, yy, Math.sin(a) * rr, cy, sy, ct, st);
        if (s === 0) netCtx.moveTo(ox + p.x, oy + p.y);
        else netCtx.lineTo(ox + p.x, oy + p.y);
      }
      netCtx.stroke();
    }
    for (var mi = 0; mi < 4; mi++) {
      var ang = (mi / 4) * Math.PI;
      netCtx.beginPath();
      for (var s2 = 0; s2 <= SEG; s2++) {
        var ph = (s2 / SEG) * Math.PI * 2;
        var cp = Math.cos(ph);
        var p2 = project3(cp * Math.cos(ang), Math.sin(ph), cp * Math.sin(ang), cy, sy, ct, st);
        if (s2 === 0) netCtx.moveTo(ox + p2.x, oy + p2.y);
        else netCtx.lineTo(ox + p2.x, oy + p2.y);
      }
      netCtx.stroke();
    }

    // 邻近节点连线：按亮度分 4 档批量描边，避免逐条设置样式
    if (anim.radius > 0.06 && links.length) {
      var buckets = [new Path2D(), new Path2D(), new Path2D(), new Path2D()];

      for (var li2 = 0; li2 < links.length; li2 += 3) {
        var PA = screen[links[li2]];
        var PB = screen[links[li2 + 1]];
        if (!PA || !PB) continue;

        var a2 = (0.05 + links[li2 + 2] * 0.17) * Math.min(1, (PA.f + PB.f) / 2);
        if (a2 < 0.024) continue;

        var bi2 = a2 > 0.16 ? 3 : (a2 > 0.1 ? 2 : (a2 > 0.06 ? 1 : 0));

        buckets[bi2].moveTo(ox + PA.x, oy + PA.y);
        buckets[bi2].lineTo(ox + PB.x, oy + PB.y);
      }

      var levels = [0.035, 0.08, 0.13, 0.2];
      for (var q = 0; q < 4; q++) {
        netCtx.strokeStyle = 'rgba(' + tone + ',' + (levels[q] * vis) + ')';
        netCtx.stroke(buckets[q]);
      }
    }

    // 节点光点：颜色只设两次，亮度交给 globalAlpha
    if (anim.radius > 0.06) {
      for (var pass = 0; pass < 2; pass++) {
        netCtx.fillStyle = pass ? 'rgb(227, 189, 118)' : 'rgb(150, 228, 255)';

        for (var k = 0; k < nodes.length; k++) {
          var S = screen[k];
          var person = state.people[nodes[k].index];
          if (!!(person && person.w) !== !!pass) continue;

          netCtx.globalAlpha = Math.min(1, (0.18 + 0.42 * Math.min(1, S.f)) * vis);
          netCtx.beginPath();
          netCtx.arc(ox + S.x, oy + S.y, 1.4 + S.f * 1.3, 0, Math.PI * 2);
          netCtx.fill();
        }
      }
      netCtx.globalAlpha = 1;
    }
  }

  function drawWave(ts) {
    if (!waveCtx) return;
    var w = 120, h = 24;
    waveCtx.clearRect(0, 0, w, h);
    waveCtx.strokeStyle = drawing ? 'rgba(227, 189, 118, .65)' : 'rgba(99, 221, 255, .5)';
    waveCtx.lineWidth = 1;
    waveCtx.beginPath();
    var amp = drawing ? 7.5 : 4.5;
    for (var x = 0; x <= w; x += 2) {
      var y = h / 2 + Math.sin(x * 0.17 + ts / 260) * amp * 0.55 + Math.sin(x * 0.44 - ts / 190) * amp * 0.28;
      if (x === 0) waveCtx.moveTo(x, y); else waveCtx.lineTo(x, y);
    }
    waveCtx.stroke();
  }

  /* ── 数据侧栏与仪表 ─────────────────────── */

  function setText(sel, val) {
    var el = $(sel);
    if (el) el.textContent = val;
  }

  // 数字滚动：从当前值缓动到目标值，形成实时数据跳动感
  function tweenText(el, to, dec, suffix) {
    if (!el) return;
    var from = el._tv == null ? (parseFloat(el.textContent) || 0) : el._tv;
    if (from === to && el._tv != null) return;

    var t0 = performance.now();
    var dur = 620;
    if (el._raf) cancelAnimationFrame(el._raf);
    el._tv = from;

    function step(now) {
      var p = Math.min(1, (now - t0) / dur);
      var e = 1 - Math.pow(1 - p, 3);
      var v = from + (to - from) * e;

      if (p < 1) {
        el.textContent = (dec ? v.toFixed(dec) : Math.round(v)) + (suffix || '');
        el._tv = v;
        el._raf = requestAnimationFrame(step);
      } else {
        el.textContent = (dec ? to.toFixed(dec) : Math.round(to)) + (suffix || '');
        el._tv = to;
      }
    }
    step(t0);
  }

  function pad2(n) {
    return ('0' + n).slice(-2);
  }

  // 中央刻度盘：120 根刻度，每 30° 一根主刻度
  function initDial() {
    var dial = $('#dial');
    if (!dial) return;
    var html = '';
    for (var i = 0; i < 120; i++) {
      var cls = 'tick';
      if (i % 10 === 0) cls += ' major';
      if (i % 30 === 0) cls += ' accent';
      html += '<i class="' + cls + '" style="transform:rotate(' + (i * 3) + 'deg)"></i>';
    }
    dial.innerHTML = html;
  }

  // 左侧节点矩阵：每个候选人一个数据点，列数随人数自适应
  function renderMatrix() {
    if (!matrixEl) return;

    var total = state.people.length;
    // 控制行数不超过 8 行，保证整份名单都能显示且不撑破侧栏
    var cols = Math.max(10, Math.min(40, Math.ceil(total / 8)));
    matrixEl.style.gridTemplateColumns = 'repeat(' + cols + ', 1fr)';
    matrixEl.style.gap = total > 150 ? '2px' : '4px';

    matrixEl.innerHTML = state.people.map(function (p) {
      return '<div class="dot' + (p.w ? ' used' : '') + '"></div>';
    }).join('');
  }

  // 左侧轮次序列：最近 14 轮的抽样规模
  function renderRounds() {
    if (!roundsEl) return;
    var hs = state.history.slice(-14);
    if (!hs.length) {
      roundsEl.innerHTML = '<span class="seq-empty">NO SEQUENCE DATA</span>';
      return;
    }
    roundsEl.innerHTML = hs.map(function (h) {
      var hgt = 16 + Math.min(5, h.names.length) * 4;
      return '<i class="seq-bar" style="height:' + hgt + 'px"></i>';
    }).join('');
  }

  // 右侧最近抽取：最近 6 轮结果
  function renderRecent() {
    var el = $('#rl-recent');
    if (!el) return;

    if (!state.history.length) {
      el.innerHTML = '<div class="recent-empty">NO RESULT YET</div>';
      return;
    }

    var total = state.history.length;
    el.innerHTML = state.history.slice(-6).reverse().map(function (h, i) {
      var idx = total - i;
      var d = new Date(h.t);
      var hm = pad2(d.getHours()) + ':' + pad2(d.getMinutes());
      return '<div class="recent-row">' +
        '<span class="rc-idx">' + pad2(idx) + '</span>' +
        '<span class="rc-name">' + h.names.join(' / ') + '</span>' +
        '<span class="rc-time">' + hm + '</span>' +
      '</div>';
    }).join('');
  }

  // 右侧抽样强度曲线：滚动缓冲
  var yieldBuf = [];
  var yieldPush = 0;
  (function seedYield() {
    for (var i = 0; i < 44; i++) yieldBuf.push(0.06 + Math.random() * 0.08);
  })();

  function drawYield(ts) {
    if (!yieldCtx) return;
    var w = yieldCv.clientWidth;
    if (!w) return;

    if (ts - yieldPush > 110) {
      yieldPush = ts;
      yieldBuf.push(drawing ? 0.42 + Math.random() * 0.5 : 0.05 + Math.random() * 0.1);
      yieldBuf.shift();
    }

    var h = 96;
    yieldCtx.clearRect(0, 0, w, h);

    // 网格
    yieldCtx.strokeStyle = 'rgba(146,186,232,.07)';
    yieldCtx.lineWidth = 1;
    for (var g = 1; g < 4; g++) {
      var gx = (w / 4) * g;
      yieldCtx.beginPath();
      yieldCtx.moveTo(gx, 0);
      yieldCtx.lineTo(gx, h);
      yieldCtx.stroke();
    }

    var n = yieldBuf.length;
    var step = w / (n - 1);
    var color = drawing ? '227, 189, 118' : '99, 221, 255';

    var grad = yieldCtx.createLinearGradient(0, 0, 0, h);
    grad.addColorStop(0, 'rgba(' + color + ',.2)');
    grad.addColorStop(1, 'rgba(' + color + ',0)');

    yieldCtx.beginPath();
    yieldCtx.moveTo(0, h - 3);
    for (var i = 0; i < n; i++) {
      yieldCtx.lineTo(i * step, h - 5 - yieldBuf[i] * (h - 14));
    }
    yieldCtx.lineTo(w, h - 3);
    yieldCtx.closePath();
    yieldCtx.fillStyle = grad;
    yieldCtx.fill();

    yieldCtx.beginPath();
    for (var j = 0; j < n; j++) {
      var xx = j * step, yy = h - 5 - yieldBuf[j] * (h - 14);
      if (j === 0) yieldCtx.moveTo(xx, yy); else yieldCtx.lineTo(xx, yy);
    }
    yieldCtx.strokeStyle = 'rgba(' + color + ',.7)';
    yieldCtx.lineWidth = 1;
    yieldCtx.stroke();

    yieldCtx.fillStyle = 'rgba(' + color + ',.9)';
    yieldCtx.beginPath();
    yieldCtx.arc(w - 1.5, h - 5 - yieldBuf[n - 1] * (h - 14), 1.9, 0, Math.PI * 2);
    yieldCtx.fill();
  }

  /* ── 环绕星云的数据粒子流 ───────────────── */

  var flow = [];
  (function seedFlow() {
    for (var i = 0; i < 54; i++) {
      flow.push({
        lon: Math.random() * Math.PI * 2,
        lat: (Math.random() * 2 - 1) * 0.9,
        rad: 1.01 + Math.random() * 0.18,
        spd: 0.45 + Math.random() * 1.1,
        vlat: (Math.random() * 2 - 1) * 0.06,
        px: 0, py: 0, has: false
      });
    }
  })();

  function drawFlow(ts, cy, sy, ct, st) {
    if (!netCtx || !view.W) return;
    var dt = Math.min(64, ts - (drawFlow.last || ts)) / 1000;
    drawFlow.last = ts;

    var ox = view.W / 2, oy = view.H / 2;
    var boost = drawing ? 2.8 : 1;
    var tone = drawing ? '227, 189, 118' : '130, 222, 255';

    // 半径压缩时粒子也收向中心，会在 Π 周围留下白点，这里随半径淡出
    var fade = Math.min(1, Math.max(0, (anim.radius - 0.1) / 0.22));
    if (fade <= 0.01) return;

    netCtx.lineWidth = 1;
    for (var i = 0; i < flow.length; i++) {
      var f = flow[i];
      f.lon += f.spd * dt * boost * 0.6;
      f.lat += f.vlat * dt * boost;
      if (f.lat > 0.94) f.vlat = -Math.abs(f.vlat);
      if (f.lat < -0.94) f.vlat = Math.abs(f.vlat);
      if (f.lon > Math.PI * 2) f.lon -= Math.PI * 2;

      var cl = Math.cos(f.lat);
      var x = Math.cos(f.lon) * cl;
      var y = Math.sin(f.lat);
      var z = Math.sin(f.lon) * cl;
      var p = project3(x * f.rad, y * f.rad, z * f.rad, cy, sy, ct, st);
      var dx = ox + p.x, dy = oy + p.y;
      var depth = Math.min(1, (p.z + 1) / 2);
      var alpha = (0.06 + depth * 0.36) * Math.min(1, p.f) * fade;

      if (f.has) {
        netCtx.strokeStyle = 'rgba(' + tone + ',' + (alpha * 0.5) + ')';
        netCtx.beginPath();
        netCtx.moveTo(f.px, f.py);
        netCtx.lineTo(dx, dy);
        netCtx.stroke();
      }

      netCtx.fillStyle = 'rgba(' + tone + ',' + alpha + ')';
      netCtx.beginPath();
      netCtx.arc(dx, dy, 0.8 + depth * 1.1, 0, Math.PI * 2);
      netCtx.fill();

      f.px = dx;
      f.py = dy;
      f.has = true;
    }
  }

  function tickClock() {
    var d = new Date();
    if (clockEl) {
      clockEl.textContent = pad2(d.getHours()) + ':' + pad2(d.getMinutes()) + ':' + pad2(d.getSeconds());
    }
  }

  function renderCloud(ts) {
    // 先排队下一帧：即使单帧出现异常，动画也不会永久停住
    requestAnimationFrame(renderCloud);

    var raw = ts - (renderCloud.last || ts);
    var dt = Math.min(64, raw);
    renderCloud.last = ts;
    cloudFrame++;

    if (ts - anim.t0 < anim.dur) {
      var p = (ts - anim.t0) / anim.dur;
      anim.radius = anim.from + (anim.to - anim.from) * easeInOut(p);
    } else {
      anim.radius = anim.to;
    }

    anim.yaw += dt * 0.00016 * anim.spin;
    var tilt = anim.tilt + pointer.y * 0.22;
    var cosY = Math.cos(anim.yaw), sinY = Math.sin(anim.yaw);
    var cosT = Math.cos(tilt), sinT = Math.sin(tilt);

    // 复用投影缓冲，减少每帧的对象分配
    while (screenBuf.length < nodes.length) screenBuf.push({ x: 0, y: 0, z: 0, f: 1 });
    var screen = screenBuf;
    var count = nodes.length;

    // 半径极小时名字会缩成白色质点，直接隐去
    var shrink = anim.radius < 0.05 ? 0 : Math.pow(Math.min(1, anim.radius / 0.35), 1.6);
    // 人数多时压低背面名字，减少整体浑浊感
    var base = count > 150 ? 0.1 : 0.2;
    var px = pointer.x * 18;
    var py = pointer.y * 10;

    for (var i = 0; i < count; i++) {
      var n = nodes[i];
      var s = project3Into(screen[i], n.x, n.y, n.z, cosY, sinY, cosT, sinT);

      // 背面名字只有 10% 透明度，隔帧更新即可，省下约一半样式写入
      if (count > 100 && s.z < 0 && (cloudFrame & 3)) continue;

      // 坐标保留一位小数，减少样式字符串解析开销
      var tx = Math.round((s.x + px) * 10) / 10;
      var ty = Math.round((s.y + py) * 10) / 10;
      var sc = Math.round(s.f * 1000) / 1000;

      n.el.style.transform = 'translate(-50%,-50%) translate3d(' + tx + 'px,' + ty + 'px,0) scale(' + sc + ')';

      var op = Math.round((base + (1 - base) * Math.pow((s.z + 1) / 2, 1.5)) * shrink * 100) / 100;
      if (op !== n.op) { n.el.style.opacity = op; n.op = op; }

      var zi = Math.round((s.z + 1) * 6);
      if (zi !== n.zi) { n.el.style.zIndex = zi + 1; n.zi = zi; }
    }

    drawNet(screen, cosY, sinY, cosT, sinT);
    drawFlow(ts, cosY, sinY, cosT, sinT);
    drawWave(ts);
    drawYield(ts);

    // 帧耗时作为链路延迟指标：忽略切页导致的长间隔，避免读数失真
    if (raw > 0 && raw < 200) {
      latAcc += Math.min(80, raw);
      latN++;
    }
    if (ts - latLast > 800) {
      latLast = ts;
      if (latEl && latN) latEl.textContent = Math.round(latAcc / latN) + ' ms';
      // I/O 吞吐实时跳动（抽取时更高）
      setText('#tel-io', (drawing ? 3.2 + Math.random() * 1.2 : 0.5 + Math.random() * 0.7).toFixed(1));
      latAcc = 0;
      latN = 0;
    }

    // 星云视角角标
    if (ts - yawLast > 400) {
      yawLast = ts;
      var deg = (anim.yaw * 180 / Math.PI) % 360;
      if (deg < 0) deg += 360;
      setText('#cm-view', 'YAW ' + deg.toFixed(1) + '°');
    }
  }

  /* ── 数据展示 ───────────────────────────── */

  function updateStats() {
    var total = state.people.length;
    var won = state.people.filter(function (p) { return p.w; }).length;
    var rate = total ? (won / total) * 100 : 0;

    tweenText($('#stat-total'), total, 0, '');
    tweenText($('#stat-won'), won, 0, '');
    tweenText($('#stat-left'), total - won, 0, '');
    tweenText($('#stat-rate'), rate, 0, '%');

    var fill = $('#prog-fill');
    if (fill) fill.style.width = rate.toFixed(1) + '%';

    $('#tel-node').textContent = total;
    $('#tel-won').textContent = won;
    $('#tel-rate').textContent = rate.toFixed(1) + '%';
    $('#tel-round').textContent = ('0' + state.history.length).slice(-2);

    // 左侧仪表
    tweenText($('#rl-total'), total, 0, '');
    tweenText($('#rl-won'), won, 0, '');
    tweenText($('#rl-remain'), total - won, 0, '');
    tweenText($('#rl-cov'), rate, 1, '%');
    var railBar = $('#rl-bar');
    if (railBar) railBar.style.width = rate.toFixed(1) + '%';

    renderMatrix();
    renderRounds();
    renderRecent();

    // 星云角标：有效节点 / 总节点
    setText('#cm-nodes', ('0' + (total - won)).slice(-2) + ' / ' + ('0' + total).slice(-2));
  }

  function renderHistory() {
    if (!state.history.length) {
      historyList.innerHTML = '<div class="drawer-empty">暂无获奖记录</div>';
      return;
    }
    var total = state.history.length;
    historyList.innerHTML = state.history.slice().reverse().map(function (h, i) {
      var d = new Date(h.t);
      var hm = ('0' + d.getHours()).slice(-2) + ':' + ('0' + d.getMinutes()).slice(-2);
      return '<div class="his-item">' +
        '<div class="his-meta">' +
          '<span>ROUND ' + ('0' + (total - i)).slice(-2) + '</span>' +
          '<span class="his-right">' +
            '<span>' + hm + '</span>' +
            '<button class="his-del" type="button" data-idx="' + (total - 1 - i) + '">删除</button>' +
          '</span>' +
        '</div>' +
        '<div class="his-names">' + h.names.join('　') + '</div>' +
        '</div>';
    }).join('');
  }

  // 删除记录：二次点击确认，避免误操作
  var delArmed = null;
  var delTimer = null;

  function resetDelArm() {
    clearTimeout(delTimer);
    delTimer = null;
    if (delArmed) {
      delArmed.textContent = '删除';
      delArmed.classList.remove('armed');
      delArmed = null;
    }
  }

  function removeHistory(idx) {
    var item = state.history[idx];
    if (!item) return;

    // 中奖者回到候选池，保证统计与星云状态一致
    item.names.forEach(function (name) {
      for (var i = 0; i < state.people.length; i++) {
        if (state.people[i].n === name) { state.people[i].w = false; break; }
      }
    });

    state.history.splice(idx, 1);
    saveState();
    renderHistory();
    updateStats();
    syncWonClasses();

    if (btnText.textContent === '名单已抽完') btnText.textContent = '开始抽取';
    toast('已删除该条记录，中奖者已回到候选池');
  }

  function syncWonClasses() {
    for (var i = 0; i < nodes.length; i++) {
      var person = state.people[nodes[i].index];
      nodes[i].el.classList.toggle('won', !!(person && person.w));
    }
  }

  historyList.addEventListener('click', function (e) {
    var btn = e.target.closest('.his-del');
    if (!btn) return;

    var idx = parseInt(btn.getAttribute('data-idx'), 10);
    if (isNaN(idx)) return;

    if (delArmed !== btn) {
      resetDelArm();
      delArmed = btn;
      btn.textContent = '确认删除';
      btn.classList.add('armed');
      delTimer = setTimeout(resetDelArm, 2600);
      return;
    }

    resetDelArm();
    removeHistory(idx);
  });

  function toast(msg) {
    toastEl.textContent = msg;
    toastEl.classList.add('on');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { toastEl.classList.remove('on'); }, 2200);
  }

  /* ── 抽奖流程 ───────────────────────────── */

  function fireShock() {
    shockEl.classList.remove('on');
    void shockEl.offsetWidth;
    shockEl.classList.add('on');
  }

  function startDraw() {
    if (drawing) return;
    if (winnerLayer.classList.contains('on')) return;

    var pool = state.people.filter(function (p) { return !p.w; });
    if (!pool.length) {
      btnText.textContent = '名单已抽完';
      toast('名单已全部中奖，请在「名单管理」中重置');
      return;
    }

    drawing = true;
    picked = [];
    document.body.classList.add('drawing');
    btnDraw.classList.add('is-drawing');
    btnDraw.disabled = true;
    btnText.textContent = '抽取中…';
    captionEl.textContent = 'π 正在计算幸运坐标…';
    if (phaseEl) phaseEl.textContent = 'SAMPLING';
    if (modeEl) modeEl.textContent = 'SAMPLING';
    PiScene.attract(true);
    PiScene.boost(2.2);
    anim.spin = 3.2;
    PiAudio.unlock();
    PiAudio.charge(4.5);
    PiAudio.startTicks(4300);

    // 阶段一：星云开始收拢
    setTimeout(function () {
      radiusTween(0.52, 1800);
      captionEl.textContent = '星云收敛 · 正在归一';
    }, 900);

    // 阶段二：收紧并加速点名
    setTimeout(function () {
      radiusTween(0.13, 1150);
      captionEl.textContent = '数据压缩中 · 0.618';
      if (phaseEl) phaseEl.textContent = 'COMPRESSING';
      flickerNames(1200);
    }, 2700);

    // 阶段三：全部汇入核心
    setTimeout(function () {
      radiusTween(0.008, 800);
      captionEl.textContent = '全部数据汇入核心…';
      if (phaseEl) phaseEl.textContent = 'CONVERGING';
      document.body.classList.add('locking');
    }, 3900);

    // 阶段四：信息流绘制 Π
    setTimeout(function () {
      stopFlicker();
      if (corePi) corePi.classList.add('sketch');
      PiAudio.trace(0.95);
      captionEl.textContent = '信息流注入 · 正在绘制核心';
      if (phaseEl) phaseEl.textContent = 'DRAWING';
    }, 4500);

    // 阶段五：点亮
    setTimeout(function () {
      if (corePi) corePi.classList.add('on');
      document.body.classList.add('igniting');
      PiAudio.lock();
      PiAudio.power(1.35);
      captionEl.textContent = 'Π · 数据核心已点亮';
      if (phaseEl) phaseEl.textContent = 'IGNITED';
    }, 5450);

    // 阶段六：公布结果
    setTimeout(function () {
      picked = sample(pool, 1);
      flashEl.classList.add('on');
      PiScene.burst(110);
      fireShock();
      PiAudio.stopTicks();
      PiAudio.impact();

      picked.forEach(function (person) {
        var idx = state.people.indexOf(person);
        var node = nodes[idx];
        if (node) node.el.classList.add('picked');
      });
    }, 6650);

    setTimeout(function () { revealWinners(picked); }, 7050);
  }

  /* ── 点名闪烁 ───────────────────────────── */

  var flickTimer = null;

  function clearFlickerMarks() {
    for (var i = 0; i < nodes.length; i++) nodes[i].el.classList.remove('picked');
  }

  function stopFlicker() {
    clearTimeout(flickTimer);
    flickTimer = null;
    clearFlickerMarks();
  }

  // 抽取末段随机点名高亮，制造「正在挑选」的紧张感
  function flickerNames(ms) {
    stopFlicker();
    var t0 = performance.now();
    var count = 2;

    (function step() {
      var elapsed = performance.now() - t0;
      if (elapsed > ms || !drawing) {
        flickTimer = null;
        clearFlickerMarks();
        return;
      }
      clearFlickerMarks();
      for (var k = 0; k < count; k++) {
        var n = nodes[Math.floor(Math.random() * nodes.length)];
        if (n) n.el.classList.add('picked');
      }
      count = elapsed > ms * 0.6 ? 3 : 2;
      flickTimer = setTimeout(step, 68);
    })();
  }

  function sample(list, n) {
    var copy = list.slice();
    for (var i = copy.length - 1; i > 0; i--) {
      var j = Math.floor(Math.random() * (i + 1));
      var tmp = copy[i]; copy[i] = copy[j]; copy[j] = tmp;
    }
    return copy.slice(0, n);
  }

  function revealWinners(winners) {
    namesEl.innerHTML = winners.map(function (p) {
      return '<div class="w-name">' + p.n + '</div>';
    }).join('');

    winnerLayer.classList.add('on');
    flashEl.classList.remove('on');
    PiAudio.win();
    if (corePi) { corePi.classList.remove('on'); corePi.classList.add('off'); }
    document.body.classList.remove('drawing');
    document.body.classList.remove('locking');
    document.body.classList.remove('igniting');
    btnDraw.classList.remove('is-drawing');
    PiScene.attract(false);
    PiScene.boost(1);
    anim.spin = 1;

    winners.forEach(function (p) { p.w = true; });

    state.history.push({
      t: Date.now(),
      names: winners.map(function (p) { return p.n; })
    });
    if (state.history.length > 60) state.history.shift();

    saveState();
    updateStats();
    renderHistory();

    // 全息信息卡：节点编号、轮次、时间戳
    var nodeIdx = state.people.indexOf(winners[0]) + 1;
    var code = ('0' + nodeIdx.toString(16).toUpperCase()).slice(-2);
    var round = ('0' + state.history.length).slice(-2);
    var now = new Date();
    var hms = pad2(now.getHours()) + ':' + pad2(now.getMinutes()) + ':' + pad2(now.getSeconds());

    var grid = $('#w-grid');
    if (grid) {
      grid.innerHTML =
        '<div class="w-cell"><span>NODE ID</span><b>0x' + code + '</b></div>' +
        '<div class="w-cell"><span>ROUND</span><b>' + round + '</b></div>' +
        '<div class="w-cell"><span>TIMESTAMP</span><b>' + hms + '</b></div>';
    }

    var ticket = $('#w-ticket');
    if (ticket) {
      var stamp = String(now.getFullYear()).slice(-2) + pad2(now.getMonth() + 1) + pad2(now.getDate());
      ticket.textContent = 'No. ' + stamp + round + code;
    }

    if (phaseEl) phaseEl.textContent = 'RESULT';
    if (modeEl) modeEl.textContent = 'LOCKED';

    // 让中奖姓名在星云里保持金色
    nodes.forEach(function (node) {
      var person = state.people[node.index];
      if (person && person.w) node.el.classList.add('won');
    });

    captionEl.textContent = '幸运星云 · 幸运已降临';
  }

  function closeWinner() {
    winnerLayer.classList.remove('on');
    picked.forEach(function (person) {
      var node = nodes[state.people.indexOf(person)];
      if (node) node.el.classList.remove('picked');
    });
    picked = [];
    drawing = false;
    btnDraw.disabled = false;
    btnText.textContent = '再抽一次';
    if (phaseEl) phaseEl.textContent = 'STANDBY';
    if (modeEl) modeEl.textContent = 'IDLE';
    if (corePi) corePi.classList.remove('on', 'off', 'sketch');
    document.body.classList.remove('locking');
    document.body.classList.remove('igniting');
    anim.spin = 1;
    radiusTween(1, 760);
    setTimeout(function () {
      captionEl.textContent = '幸运星云 · 等待抽取';
    }, 600);
  }

  /* ── 交互绑定 ───────────────────────────── */

  btnDraw.addEventListener('click', startDraw);

  /* ── 全屏展示 ───────────────────────────── */

  var fsBtn = $('#btn-fullscreen');
  var fsText = $('#fs-text');

  function syncFullscreen() {
    var on = !!document.fullscreenElement;
    fsText.textContent = on ? '退出全屏' : '全屏';
    fsBtn.classList.toggle('on', on);
    setTimeout(syncLayout, 140);
  }

  function toggleFullscreen() {
    if (document.fullscreenElement) {
      document.exitFullscreen();
    } else if (document.documentElement.requestFullscreen) {
      document.documentElement.requestFullscreen().catch(function () {
        toast('当前环境不支持自动全屏，可按 F11 全屏');
      });
    } else {
      toast('当前环境不支持自动全屏，可按 F11 全屏');
    }
  }

  fsBtn.addEventListener('click', toggleFullscreen);
  document.addEventListener('fullscreenchange', syncFullscreen);

  /* ── 科技感声效 ─────────────────────────── */

  function syncSound() {
    var m = PiAudio.isMuted();
    soundText.textContent = m ? '已静音' : '声效';
    soundBtn.classList.toggle('off', m);
    soundBtn.title = m ? '点击开启科技感声效' : '点击静音';
  }

  soundBtn.addEventListener('click', function () {
    PiAudio.unlock();
    PiAudio.toggle();
    syncSound();
  });

  // 浏览器要求首次交互后才能播放声音
  document.addEventListener('pointerdown', function () { PiAudio.unlock(); }, { once: true });

  document.addEventListener('click', function (e) {
    if (e.target.closest('button')) PiAudio.click();
  });

  syncSound();

  $('#btn-again').addEventListener('click', function () {
    closeWinner();
    setTimeout(startDraw, 380);
  });

  $('#btn-close-winner').addEventListener('click', closeWinner);

  $('#btn-names').addEventListener('click', function () {
    namesInput.value = state.people.map(function (p) { return p.n; }).join('\n');
    modalNames.classList.add('on');
    setTimeout(function () { namesInput.focus(); }, 260);
  });

  $('#btn-names-cancel').addEventListener('click', function () {
    modalNames.classList.remove('on');
  });

  $('#btn-names-save').addEventListener('click', function () {
    var list = namesInput.value.split(/[\n,，、;；]+/).map(function (s) {
      return s.trim().replace(/（已中奖）|\(已中奖\)/g, '');
    }).filter(Boolean);

    var seen = {};
    list = list.filter(function (n) {
      if (seen[n]) return false;
      seen[n] = true;
      return true;
    });

    if (!list.length) { toast('名单不能为空'); return; }

    state.people = list.map(function (n) { return { n: n, w: false }; });
    saveState();
    buildCloud();
    updateStats();
    modalNames.classList.remove('on');
    btnText.textContent = '开始抽取';
    toast('名单已更新：共 ' + list.length + ' 条');
  });

  /* ── 名单文件导入 ───────────────────────── */

  function normalizeCell(v) {
    return String(v == null ? '' : v)
      .replace(/^\ufeff/, '')
      .replace(/^["'“”‘’\s]+|["'“”‘’\s]+$/g, '');
  }

  var BAD_CELL = /^(姓名|名字|学生姓名|学生名称|选手姓名|学生|名单|序号|编号|学号|班级|专业|年级|备注|幸运数字|幸运号|幸运号码|抽奖号|抽奖号码|号码|数字|no|number|num|name|id)$/i;

  // allowNumber：号码模式下保留数字，并清洗「No.12」这类写法
  function cleanTokens(tokens, allowNumber) {
    var seen = {};
    var out = [];

    tokens.forEach(function (raw) {
      var t = normalizeCell(raw);
      if (!t || BAD_CELL.test(t)) return;

      if (allowNumber) {
        var m = t.match(/\d{1,6}/);
        if (!m) return;
        t = m[0];
      } else if (/^\d+(\.\d+)?$/.test(t)) {
        return;
      }

      if (seen[t]) return;
      seen[t] = true;
      out.push(t);
    });

    return out;
  }

  function looksNumeric(tokens) {
    var hit = 0, total = 0;
    tokens.forEach(function (raw) {
      var t = normalizeCell(raw);
      if (!t || BAD_CELL.test(t)) return;
      total++;
      if (/^\d{1,6}$/.test(t)) hit++;
    });
    return total > 0 && hit / total >= 0.6;
  }

  // 多列表格：先找「幸运数字」列，再找「姓名」列，都没有则全表提取
  function parseRows(rows) {
    var HEAD_LUCKY = /^(幸运数字|幸运号|幸运号码|幸运编号|抽奖号|抽奖号码|号码|数字|lucky ?number|lucky ?num|number|num)$/i;
    var HEAD_NAME = /^(姓名|名字|学生姓名|学生名称|选手姓名|name)$/i;

    var col = -1, headerRow = -1, numeric = false;
    var scan = Math.min(rows.length, 3);

    for (var pass = 0; pass < 2 && col < 0; pass++) {
      var re = pass === 0 ? HEAD_LUCKY : HEAD_NAME;

      for (var i = 0; i < scan && col < 0; i++) {
        for (var j = 0; j < rows[i].length; j++) {
          if (re.test(normalizeCell(rows[i][j]))) {
            col = j;
            headerRow = i;
            numeric = pass === 0;
            break;
          }
        }
      }
    }

    var tokens = [];

    if (col >= 0) {
      for (var r = headerRow + 1; r < rows.length; r++) {
        if (rows[r] && rows[r][col] != null) tokens.push(rows[r][col]);
      }
      return cleanTokens(tokens, numeric);
    }

    rows.forEach(function (row) {
      row.forEach(function (c) { if (c != null) tokens.push(c); });
    });
    return cleanTokens(tokens, looksNumeric(tokens));
  }

  function rowsFromText(text) {
    return text.split(/\r?\n/).map(function (line) {
      return line.split(/[\t,，、;；]+/);
    }).filter(function (row) {
      return row.some(function (c) { return c.trim(); });
    });
  }

  function applyImport(list) {
    var seen = {};
    list = list.filter(function (n) {
      if (seen[n]) return false;
      seen[n] = true;
      return true;
    });

    if (!list.length) {
      toast('未识别到有效姓名，请检查文件内容');
      return;
    }
    namesInput.value = list.join('\n');
    modalNames.classList.add('on');
    toast('已导入 ' + list.length + ' 条，确认后点击「保存名单」');
  }

  function readTextFile(file, encoding, ok, fail) {
    var reader = new FileReader();
    reader.onload = function () { ok(String(reader.result || '')); };
    reader.onerror = fail;
    reader.readAsText(file, encoding);
  }

  function importText(file) {
    readTextFile(file, 'UTF-8', function (text) {
      if (/\uFFFD/.test(text)) {
        // 可能是 Excel 导出的 GBK 编码 CSV，重试一次
        readTextFile(file, 'GBK', function (t2) {
          applyImport(parseRows(rowsFromText(t2)));
        }, function () { toast('文件读取失败'); });
        return;
      }
      applyImport(parseRows(rowsFromText(text)));
    }, function () { toast('文件读取失败'); });
  }

  // Excel 解析库：优先用内置副本（离线可用），失败再回退 CDN
  var XLSX_LOCAL = 'js/vendor/xlsx.full.min.js';
  var XLSX_CDN = 'https://cdn.sheetjs.com/xlsx-0.20.3/package/dist/xlsx.full.min.js';
  var xlsxLoading = null;

  function loadScript(src) {
    return new Promise(function (resolve, reject) {
      var s = document.createElement('script');
      s.src = src;
      s.onload = function () { resolve(); };
      s.onerror = function () { reject(); };
      document.head.appendChild(s);
    });
  }

  function loadXlsx() {
    if (window.XLSX) return Promise.resolve();
    if (xlsxLoading) return xlsxLoading;

    xlsxLoading = loadScript(XLSX_LOCAL).catch(function () {
      return loadScript(XLSX_CDN);
    });
    return xlsxLoading;
  }

  function importExcel(file) {
    toast('正在解析表格…');

    loadXlsx().then(function () {
      var reader = new FileReader();

      reader.onload = function () {
        var names = [];

        try {
          var wb = window.XLSX.read(new Uint8Array(reader.result), { type: 'array' });

          wb.SheetNames.forEach(function (sn) {
            var rows = window.XLSX.utils.sheet_to_json(wb.Sheets[sn], {
              header: 1,
              raw: false,
              blankrows: false,
              defval: ''
            });
            names = names.concat(parseRows(rows));
          });
        } catch (err) {
          toast('表格解析失败，请确认文件未损坏或加密');
          return;
        }

        applyImport(names);
      };

      reader.onerror = function () { toast('文件读取失败'); };
      reader.readAsArrayBuffer(file);
    }).catch(function () {
      toast('Excel 解析组件加载失败，请将表格另存为 CSV 后导入');
    });
  }

  fileInput.addEventListener('change', function () {
    var file = fileInput.files && fileInput.files[0];
    if (!file) return;

    var ext = (file.name.split('.').pop() || '').toLowerCase();
    if (ext === 'xlsx' || ext === 'xls' || ext === 'xlsm') importExcel(file);
    else importText(file);

    fileInput.value = '';
  });

  $('#btn-reset').addEventListener('click', function () {
    state.people.forEach(function (p) { p.w = false; });
    saveState();
    buildCloud();
    updateStats();
    btnText.textContent = '开始抽取';
    modalNames.classList.remove('on');
    toast('已重置全部中奖状态');
  });

  $('#btn-history').addEventListener('click', function () {
    renderHistory();
    drawerHistory.classList.add('on');
  });

  $('#btn-history-close').addEventListener('click', function () {
    drawerHistory.classList.remove('on');
  });

  // 清空全部记录：二次确认，同时把中奖者放回候选池
  var clearBtn = $('#btn-history-clear');
  var clearArmed = false;
  var clearTimer = null;

  function resetClear() {
    clearTimeout(clearTimer);
    clearTimer = null;
    clearArmed = false;
    if (clearBtn) {
      clearBtn.textContent = '清空记录';
      clearBtn.classList.remove('armed');
    }
  }

  function clearHistory() {
    if (!state.history.length) { toast('暂无获奖记录'); return; }

    state.history = [];
    state.people.forEach(function (p) { p.w = false; });
    saveState();
    renderHistory();
    updateStats();
    syncWonClasses();

    if (btnText.textContent === '名单已抽完') btnText.textContent = '开始抽取';
    toast('已清空获奖记录，全部人员回到候选池');
  }

  if (clearBtn) {
    clearBtn.addEventListener('click', function () {
      if (!clearArmed) {
        clearArmed = true;
        clearBtn.textContent = '确认清空';
        clearBtn.classList.add('armed');
        clearTimer = setTimeout(resetClear, 2600);
        return;
      }
      resetClear();
      clearHistory();
    });
  }

  document.addEventListener('keydown', function (e) {
    var typing = /^(INPUT|TEXTAREA)$/.test(document.activeElement.tagName);
    if (typing) return;

    if (e.code === 'Space') {
      e.preventDefault();
      if (!modalNames.classList.contains('on') && !drawerHistory.classList.contains('on')) startDraw();
    } else if (e.key === 'f' || e.key === 'F') {
      toggleFullscreen();
    }
  });

  window.addEventListener('mousemove', function (e) {
    pointer.x = e.clientX / window.innerWidth - 0.5;
    pointer.y = e.clientY / window.innerHeight - 0.5;
  });

  window.addEventListener('resize', syncLayout);

  if (window.ResizeObserver) {
    var ro = new ResizeObserver(function () { syncLayout(); });
    ro.observe($('.hud'));
    ro.observe($('.dock'));
  }

  /* ── 启动 ───────────────────────────────── */

  syncLayout();
  initDial();
  buildCloud();
  updateStats();
  renderHistory();
  tickClock();
  setInterval(tickClock, 1000);
  requestAnimationFrame(renderCloud);
  setTimeout(syncLayout, 250);

  if (state.people.length && state.people.every(function (p) { return p.w; })) {
    btnText.textContent = '名单已抽完';
  }
})();
