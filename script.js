/*
 * Convex lens ray diagram.
 *
 * Distances are held as a ratio to the focal length rather than in pixels,
 * so the construction means the same thing at any window size and the
 * drawing geometry can be derived from the canvas instead of fixed.
 */
(function () {
  "use strict";

  var $ = function (id) { return document.getElementById(id); };

  var COLOR = {
    axis: "#475569",
    lensStroke: "#0f6f93",
    lensFill: "rgba(80, 205, 243, 0.35)",
    mark: "#334155",
    guide: "#94a3b8",
    single: "#111827",
    upper: "#ab1e00",
    lower: "#0014b8",
    note: "#64748b",
    halo: "rgba(251,252,254,0.92)"
  };

  var UI_FONT =
    '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif';

  // Object distance as a multiple of the focal length.
  var CASES = {
    infinity: { r: null, hint: "Rays from a distant object arrive parallel to the axis and meet at F₂. The image is a point at the focus." },
    beyond2F: { r: 3, hint: "Beyond 2F₁: the image is real, inverted and diminished, formed between F₂ and 2F₂." },
    at2F: { r: 2, hint: "At 2F₁: the image is real, inverted and the same size, formed at 2F₂." },
    betweenF2F: { r: 1.6, hint: "Between F₁ and 2F₁: the image is real, inverted and magnified, formed beyond 2F₂." },
    atF: { r: 1, hint: "At F₁: the refracted rays emerge parallel, so the image is formed at infinity." },
    insideF: { r: 0.5, hint: "Between F₁ and the lens: the image is virtual, erect and magnified, on the same side as the object." }
  };

  var HINT_OFF = "The light is off. Switch it on to build the ray diagram step by step.";
  var HINT_ON = "Drag the object, use the slider, or pick a standard case.";

  var TIMELINE = {
    object: [0, 380],
    rayIn: [360, 900],
    rayOut: [880, 1520],
    back: [1500, 1920],
    image: [1900, 2400],
    end: 2400
  };

  var reduceMotion = window.matchMedia
    ? window.matchMedia("(prefers-reduced-motion: reduce)")
    : null;

  var state = {
    r: 3,               // object distance as a multiple of f
    atInfinity: false,
    full: false,        // half object or the whole arrow
    lightOn: false,
    playing: false,
    t0: 0,
    preset: "beyond2F"
  };

  /* ------------------------------------------------------------------
     Optics
     ------------------------------------------------------------------ */

  // Everything below is in units of the focal length.
  //   v/f = r / (r - 1),  magnification = v/u = 1 / (r - 1)
  // r = 1 puts the image at infinity, which is a real case and has to be
  // drawn rather than divided by.
  function imageOf(r) {
    var d = r - 1;
    if (Math.abs(d) < 1e-9) return { atInfinity: true };
    return { atInfinity: false, vf: r / d, m: 1 / d };
  }

  /* ------------------------------------------------------------------
     Geometry, derived from the canvas so the diagram always fits
     ------------------------------------------------------------------ */

  function geometry(W, H) {
    var margin = 46;
    var half = W / 2 - margin;

    // 3.3 focal lengths of room on each side, so an object at 3f and an
    // image at 3f both stay on the canvas along with the 2F marks.
    var f = half / 3.3;
    var h = Math.min(H * 0.14, f * 0.45);   // object height
    var a = h * 1.55;                        // lens semi-aperture
    var t = a * 0.2;                         // lens half-thickness

    // Surface radius and centre for a biconvex lens through (0, +-a)
    // with its vertex at +-t.
    var R = (a * a + t * t) / (2 * t);

    return {
      W: W, H: H, margin: margin,
      xo: W / 2, yo: H / 2,
      f: f, h: h, a: a, t: t,
      R: R, d: R - t,
      theta: Math.atan2(a, R - t)
    };
  }

  /* ------------------------------------------------------------------
     Canvas plumbing
     ------------------------------------------------------------------ */

  var canvas = $("canvas");
  var ctx = canvas.getContext("2d");
  var host = canvas.parentNode;

  function fit() {
    var dpr = window.devicePixelRatio || 1;
    var w = host.clientWidth;
    var h = host.clientHeight;
    canvas.style.width = w + "px";
    canvas.style.height = h + "px";
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  function needsFit() {
    var dpr = window.devicePixelRatio || 1;
    return canvas.width !== Math.round(host.clientWidth * dpr) ||
      canvas.height !== Math.round(host.clientHeight * dpr);
  }

  /* ------------------------------------------------------------------
     Drawing helpers
     ------------------------------------------------------------------ */

  function line(x1, y1, x2, y2, color, width, dashed) {
    ctx.beginPath();
    ctx.setLineDash(dashed ? [6, 4] : []);
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
    ctx.strokeStyle = color;
    ctx.lineWidth = width;
    ctx.stroke();
    ctx.setLineDash([]);
  }

  // A line that grows from its first point as p goes 0 to 1.
  function grow(x1, y1, x2, y2, color, width, dashed, p) {
    if (p <= 0) return;
    line(x1, y1, x1 + (x2 - x1) * p, y1 + (y2 - y1) * p, color, width, dashed);
  }

  function arrow(x1, y1, x2, y2, color, width, dashed, p) {
    if (p === undefined) p = 1;
    if (p <= 0) return;
    var tx = x1 + (x2 - x1) * p;
    var ty = y1 + (y2 - y1) * p;
    line(x1, y1, tx, ty, color, width, dashed);

    var head = 10;
    var ang = Math.atan2(ty - y1, tx - x1);
    ctx.beginPath();
    ctx.setLineDash([]);
    ctx.moveTo(tx, ty);
    ctx.lineTo(tx - head * Math.cos(ang - Math.PI / 7),
      ty - head * Math.sin(ang - Math.PI / 7));
    ctx.lineTo(tx - head * Math.cos(ang + Math.PI / 7),
      ty - head * Math.sin(ang + Math.PI / 7));
    ctx.closePath();
    ctx.fillStyle = color;
    ctx.fill();
  }

  function label(text, x, y, color, align, baseline) {
    ctx.font = "600 13px " + UI_FONT;
    ctx.textAlign = align || "center";
    ctx.textBaseline = baseline || "middle";
    ctx.lineJoin = "round";
    ctx.lineWidth = 4;
    ctx.strokeStyle = COLOR.halo;
    ctx.strokeText(text, x, y);
    ctx.fillStyle = color;
    ctx.fillText(text, x, y);
  }

  function dot(x, y, color, r) {
    ctx.beginPath();
    ctx.setLineDash([]);
    ctx.arc(x, y, r || 3.5, 0, Math.PI * 2);
    ctx.fillStyle = color;
    ctx.fill();
  }

  // How far a ray can run before it leaves the canvas.
  function toEdge(g, x, y, dx, dy) {
    var m = 6;
    var t = Infinity;
    if (dx > 1e-9) t = Math.min(t, (g.W - m - x) / dx);
    else if (dx < -1e-9) t = Math.min(t, (m - x) / dx);
    if (dy > 1e-9) t = Math.min(t, (g.H - m - y) / dy);
    else if (dy < -1e-9) t = Math.min(t, (m - y) / dy);
    if (!isFinite(t)) t = 0;
    t = Math.max(0, t);
    return { x: x + dx * t, y: y + dy * t };
  }

  /* ------------------------------------------------------------------
     The scene
     ------------------------------------------------------------------ */

  function drawLens(g) {
    ctx.beginPath();
    ctx.setLineDash([]);
    ctx.arc(g.xo - g.d, g.yo, g.R, -g.theta, g.theta, false);
    ctx.arc(g.xo + g.d, g.yo, g.R, Math.PI - g.theta, Math.PI + g.theta, false);
    ctx.closePath();
    ctx.fillStyle = COLOR.lensFill;
    ctx.fill();
    ctx.strokeStyle = COLOR.lensStroke;
    ctx.lineWidth = 2;
    ctx.stroke();
  }

  function drawMarks(g) {
    line(0, g.yo, g.W, g.yo, COLOR.axis, 1.2, false);
    line(g.xo, g.yo - g.a - 26, g.xo, g.yo + g.a + 26, COLOR.guide, 1, true);

    // Each mark gets its own path; sharing one leaves stray joins between
    // the arcs.
    var marks = [
      { x: g.xo - 2 * g.f, text: "2F₁" },
      { x: g.xo - g.f, text: "F₁" },
      { x: g.xo, text: "O" },
      { x: g.xo + g.f, text: "F₂" },
      { x: g.xo + 2 * g.f, text: "2F₂" }
    ];
    for (var i = 0; i < marks.length; i++) {
      if (marks[i].x < 4 || marks[i].x > g.W - 4) continue;
      dot(marks[i].x, g.yo, COLOR.mark, 3);
      label(marks[i].text, marks[i].x, g.yo + 20, COLOR.mark);
    }
  }

  // The tips of the object that get rays drawn from them.
  function tipsOf(g) {
    if (state.full) {
      return [
        { hy: -g.h, color: COLOR.upper },
        { hy: g.h, color: COLOR.lower }
      ];
    }
    return [{ hy: -g.h, color: COLOR.single }];
  }

  function drawObject(g, u, ph) {
    var x = g.xo - u;
    var c = state.full ? COLOR.mark : COLOR.single;
    if (state.full) arrow(x, g.yo + g.h, x, g.yo - g.h, c, 3, false, ph);
    else arrow(x, g.yo, x, g.yo - g.h, c, 3, false, ph);
  }

  // Object at infinity: parallel rays that meet at the second focus.
  function drawInfinity(g, ph) {
    var heights = [-g.h, 0, g.h];
    var F2x = g.xo + g.f;
    for (var i = 0; i < heights.length; i++) {
      var hy = heights[i];
      var col = !state.full ? COLOR.single
        : hy < 0 ? COLOR.upper : hy > 0 ? COLOR.lower : COLOR.mark;
      grow(6, g.yo + hy, g.xo, g.yo + hy, col, 2, false, ph.rayIn);
      if (ph.rayOut <= 0) continue;
      var end = toEdge(g, g.xo, g.yo + hy, g.f, -hy);
      grow(g.xo, g.yo + hy, end.x, end.y, col, 2, false, ph.rayOut);
    }
    if (ph.image > 0) {
      ctx.save();
      ctx.globalAlpha = ph.image;
      dot(F2x, g.yo, "#b91c1c", 5);
      label("image (a point at F₂)", F2x, g.yo - 22, "#b91c1c");
      ctx.restore();
    }
  }

  function draw() {
    if (needsFit()) fit();

    var W = canvas.clientWidth;
    var H = canvas.clientHeight;
    if (!W || !H) return;

    ctx.clearRect(0, 0, W, H);
    var g = geometry(W, H);

    drawMarks(g);
    drawLens(g);

    var ph = phases();
    if (!ph) return;

    if (state.atInfinity) { drawInfinity(g, ph); return; }

    var r = state.r;
    var u = r * g.f;
    var img = imageOf(r);
    var tips = tipsOf(g);

    drawObject(g, u, ph.object);

    var xi = img.atInfinity ? null : g.xo + img.vf * g.f;
    var onCanvas = xi !== null && xi > 4 && xi < W - 4;

    for (var i = 0; i < tips.length; i++) {
      var hy = tips[i].hy;
      var col = tips[i].color;

      // Incident rays: one parallel to the axis, one through the centre.
      grow(g.xo - u, g.yo + hy, g.xo, g.yo + hy, col, 2, false, ph.rayIn);
      grow(g.xo - u, g.yo + hy, g.xo, g.yo, col, 2, false, ph.rayIn);
      if (ph.rayOut <= 0) continue;

      // Refracted rays. The first leaves the lens heading through F₂, the
      // second carries straight on through the centre. Both directions are
      // computed, never assumed, so they always meet at the image point.
      var dirs = [
        { x: g.xo, y: g.yo + hy, dx: g.f, dy: -hy },
        { x: g.xo, y: g.yo, dx: u, dy: -hy }
      ];

      for (var k = 0; k < dirs.length; k++) {
        var d = dirs[k];
        var stop;
        if (img.atInfinity || !onCanvas || img.vf < 0) {
          stop = toEdge(g, d.x, d.y, d.dx, d.dy);
        } else {
          stop = { x: xi, y: g.yo - hy * img.m };
        }
        grow(d.x, d.y, stop.x, stop.y, col, 2, false, ph.rayOut);

        // A virtual image sits where the refracted rays appear to come
        // from, so trace them backwards to it.
        if (!img.atInfinity && img.vf < 0 && ph.back > 0) {
          grow(d.x, d.y, xi, g.yo - hy * img.m, COLOR.guide, 1.5, true, ph.back);
        }
      }
    }

    // The image itself.
    if (!img.atInfinity && ph.image > 0) {
      ctx.save();
      ctx.globalAlpha = ph.image;
      var virtual = img.vf < 0;
      var topY = g.yo + g.h * img.m;
      var botY = g.yo - g.h * img.m;
      if (onCanvas) {
        var c = state.full ? COLOR.mark : COLOR.single;
        if (state.full) arrow(xi, botY, xi, topY, c, 3, virtual, 1);
        else arrow(xi, g.yo, xi, topY, c, 3, virtual, 1);
      } else {
        // Just past the focus the image runs thousands of pixels away.
        // Say so at the edge rather than drawing off into nowhere.
        var right = img.vf > 0;
        var ex = right ? W - 14 : 14;
        label(right ? "image forms far off to the right →"
          : "← image forms far off to the left",
          ex, g.yo - g.a - 40, COLOR.note, right ? "right" : "left");
      }
      ctx.restore();
    }

    if (img.atInfinity && ph.rayOut > 0) {
      ctx.save();
      ctx.globalAlpha = ph.rayOut;
      label("refracted rays are parallel — image at infinity",
        W - 14, g.yo - g.a - 40, COLOR.note, "right");
      ctx.restore();
    }
  }

  /* ------------------------------------------------------------------
     The staged trace
     ------------------------------------------------------------------ */

  function easeOut(x) { return 1 - Math.pow(1 - x, 3); }

  function seg(t, a, b) {
    if (t >= b) return 1;
    if (t <= a) return 0;
    return (t - a) / (b - a);
  }

  function phases() {
    if (!state.lightOn) return null;
    var t = state.playing ? performance.now() - state.t0 : Infinity;
    var out = {};
    for (var k in TIMELINE) {
      if (k === "end") continue;
      out[k] = easeOut(seg(t, TIMELINE[k][0], TIMELINE[k][1]));
    }
    return out;
  }

  function play() {
    // Someone who has asked for less motion gets the finished diagram.
    if (reduceMotion && reduceMotion.matches) {
      state.playing = false;
      syncLock();
      draw();
      return;
    }
    state.playing = true;
    state.t0 = performance.now();
    syncLock();
    requestAnimationFrame(function step() {
      if (!state.playing) return;
      if (performance.now() - state.t0 >= TIMELINE.end) {
        state.playing = false;
        syncLock();
        draw();
        return;
      }
      draw();
      requestAnimationFrame(step);
    });
  }

  /* ------------------------------------------------------------------
     Controls
     ------------------------------------------------------------------ */

  var slider = $("distance");
  var LO = parseFloat(slider.min);
  var HI = parseFloat(slider.max);

  function interactive() { return state.lightOn && !state.playing; }

  function syncLock() {
    var on = interactive();
    slider.disabled = !on;
    var buttons = $("presets").querySelectorAll("button");
    for (var i = 0; i < buttons.length; i++) buttons[i].disabled = !on;
    $("panel").classList.toggle("locked", !on);
  }

  function syncPresets() {
    var buttons = $("presets").querySelectorAll("button");
    for (var i = 0; i < buttons.length; i++) {
      buttons[i].setAttribute("aria-pressed",
        String(buttons[i].dataset.case === state.preset));
    }
  }

  function updateHint() {
    if (!state.lightOn) { $("hint").textContent = HINT_OFF; return; }
    $("hint").textContent = state.preset && CASES[state.preset]
      ? CASES[state.preset].hint : HINT_ON;
  }

  // The slider and the drag both come through here, so the number stays a
  // number and the preset highlight never goes stale.
  function setDistance(r, fromSlider) {
    state.atInfinity = false;
    state.r = Math.min(HI, Math.max(LO, r));
    if (!fromSlider) slider.value = state.r;

    state.preset = null;
    for (var key in CASES) {
      var c = CASES[key];
      if (c.r !== null && Math.abs(c.r - state.r) < 0.005) { state.preset = key; break; }
    }
    syncPresets();
    updateHint();
    draw();
  }

  slider.addEventListener("input", function () {
    setDistance(parseFloat(slider.value), true);
  });

  $("presets").addEventListener("click", function (ev) {
    var btn = ev.target.closest("button");
    if (!btn || !interactive()) return;
    var key = btn.dataset.case;
    state.preset = key;
    if (key === "infinity") {
      state.atInfinity = true;
    } else {
      state.atInfinity = false;
      state.r = CASES[key].r;
      slider.value = state.r;
    }
    syncPresets();
    updateHint();
    play();
  });

  function setLight(on) {
    if (on === state.lightOn) return;
    state.lightOn = on;
    $("lightOn").setAttribute("aria-pressed", String(on));
    $("lightOff").setAttribute("aria-pressed", String(!on));
    updateHint();
    if (on) play();
    else { state.playing = false; syncLock(); draw(); }
  }

  $("lightOn").addEventListener("click", function () { setLight(true); });
  $("lightOff").addEventListener("click", function () { setLight(false); });

  function setMode(full) {
    if (full === state.full) return;
    state.full = full;
    $("modeFull").setAttribute("aria-pressed", String(full));
    $("modeHalf").setAttribute("aria-pressed", String(!full));
    if (state.lightOn) play(); else draw();
  }

  $("modeHalf").addEventListener("click", function () { setMode(false); });
  $("modeFull").addEventListener("click", function () { setMode(true); });

  /* ------------------------------------------------------------------
     Dragging the object
     ------------------------------------------------------------------ */

  var dragging = false;
  var hovering = false;

  function localPoint(ev) {
    var box = canvas.getBoundingClientRect();
    return { x: ev.clientX - box.left, y: ev.clientY - box.top };
  }

  function overObject(pt) {
    if (state.atInfinity) return false;
    var g = geometry(canvas.clientWidth, canvas.clientHeight);
    var x = g.xo - state.r * g.f;
    var top = state.full ? g.yo - g.h : g.yo - g.h;
    var bot = state.full ? g.yo + g.h : g.yo;
    return Math.abs(pt.x - x) < 14 && pt.y > top - 12 && pt.y < bot + 12;
  }

  canvas.addEventListener("pointerdown", function (ev) {
    if (!interactive() || !overObject(localPoint(ev))) return;
    dragging = true;
    canvas.setPointerCapture(ev.pointerId);
    canvas.style.cursor = "grabbing";
    ev.preventDefault();
  });

  canvas.addEventListener("pointermove", function (ev) {
    if (!interactive()) { canvas.style.cursor = ""; return; }
    var pt = localPoint(ev);
    if (dragging) {
      var g = geometry(canvas.clientWidth, canvas.clientHeight);
      setDistance((g.xo - pt.x) / g.f);
      ev.preventDefault();
      return;
    }
    var over = overObject(pt);
    if (over !== hovering) {
      hovering = over;
      canvas.style.cursor = over ? "grab" : "default";
    }
  });

  function endDrag(ev) {
    if (!dragging) return;
    dragging = false;
    canvas.style.cursor = hovering ? "grab" : "default";
    if (ev && ev.pointerId !== undefined && canvas.hasPointerCapture(ev.pointerId)) {
      canvas.releasePointerCapture(ev.pointerId);
    }
  }

  canvas.addEventListener("pointerup", endDrag);
  canvas.addEventListener("pointercancel", endDrag);

  /* ------------------------------------------------------------------
     Sizing. Redraw on demand, never on a timer.
     ------------------------------------------------------------------ */

  function fitAll() { fit(); draw(); }

  window.addEventListener("resize", fitAll);
  window.addEventListener("pageshow", fitAll);
  document.addEventListener("visibilitychange", fitAll);

  // Held in a variable on purpose: an unreferenced ResizeObserver can be
  // garbage collected, after which it silently stops firing.
  var sizeObserver = null;
  if (window.ResizeObserver) {
    sizeObserver = new ResizeObserver(fitAll);
    sizeObserver.observe(host);
  }

  slider.value = state.r;
  syncPresets();
  updateHint();
  syncLock();
  fitAll();

  // A page opened in a background tab gets no observer callbacks at all,
  // so keep checking until the canvas has a real size.
  var frames = 0;
  (function settle() {
    if (frames++ > 300) return;
    if (host.clientWidth > 0 && !needsFit()) return;
    fitAll();
    requestAnimationFrame(settle);
  })();
})();
