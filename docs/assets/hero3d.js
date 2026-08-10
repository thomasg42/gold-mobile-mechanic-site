/*
  Gold Mobile Mechanic — scroll-driven 3D before/after hero.

  Pattern: wiki/builds/scroll-driven-hero-video.md, but the play head drives a
  live WebGL scene instead of a video file, because this client has no hero
  footage. Scroll progress sweeps a diagnostic scan plane down the length of a
  vehicle. Everything the plane has passed renders in the AFTER material (gold,
  healthy); everything ahead of it stays in the BEFORE material (grey, faulted).
  The split is done with real clipping planes, so it is one continuous 3D wipe
  rather than a crossfade between two images.

  Identical on desktop and mobile by design — same scene, same scrub. The camera
  distance is solved from the viewport aspect so a tall phone frames the whole
  car instead of cropping it, and the look-at target sits below the car so the
  vehicle rides in the upper half where the headline is not.
*/

import * as THREE from '../vendor/three/three.module.min.js';

const COLOR = {
  faultEdge: 0xc9482a,
  faultBody: 0x2a2e33,
  goldEdge: 0xf1d783,
  goldBody: 0x8a6a24,
  scan: 0xf1d783,
  grid: 0xe1bd5b,
};

// Radius of the sphere that contains the car, used to solve the camera
// distance. Fitting the length alone is not enough: the near flank sits ~0.95
// closer to the lens than the centreline and perspective magnifies it, which is
// what pushes the nose and tail off a wide screen.
const CAR_RADIUS = 2.6;

// Hotspots ride along the body. Each flips from FAULT to FIXED the moment the
// scan plane passes its x position, so the copy and the geometry stay in sync.
const HOTSPOTS = [
  { x: -1.5, y: 1.0, z: 0.35, before: 'Misfire', after: 'Plugs + coils' },
  { x: -1.35, y: 0.46, z: 0.95, before: 'Grinding', after: 'Brakes' },
  { x: 0.15, y: 0.3, z: 0.6, before: 'Leaking', after: 'Oil + fluids' },
  { x: 1.35, y: 0.62, z: 0.95, before: 'Clunking', after: 'Suspension' },
];

export function initHero3D({ canvas, section, layer, onProgress }) {
  if (!canvas || !section) return null;

  const renderer = createRenderer(canvas);
  if (!renderer) return null;

  const scene = new THREE.Scene();
  scene.fog = new THREE.FogExp2(0x0b0c0d, 0.05);

  const camera = new THREE.PerspectiveCamera(38, 1, 0.1, 140);

  scene.add(new THREE.AmbientLight(0xffffff, 0.6));
  const keyLight = new THREE.DirectionalLight(0xfff2d0, 1.4);
  keyLight.position.set(-4, 6, 5);
  scene.add(keyLight);
  const rimLight = new THREE.DirectionalLight(0x7fa6ff, 0.45);
  rimLight.position.set(5, 3, -6);
  scene.add(rimLight);

  // AFTER survives where x < scanX. BEFORE survives where x > scanX.
  const afterClip = new THREE.Plane(new THREE.Vector3(-1, 0, 0), 0);
  const beforeClip = new THREE.Plane(new THREE.Vector3(1, 0, 0), 0);

  const beforeGroup = buildVehicle({
    edgeColor: COLOR.faultEdge,
    bodyColor: COLOR.faultBody,
    bodyOpacity: 0.13,
    emissive: 0x140a06,
    emissiveIntensity: 0.35,
    roughness: 0.95,
    metalness: 0.05,
    edgeOpacity: 0.85,
    clip: beforeClip,
  });
  const afterGroup = buildVehicle({
    edgeColor: COLOR.goldEdge,
    bodyColor: COLOR.goldBody,
    bodyOpacity: 0.2,
    emissive: 0x3a2c0a,
    emissiveIntensity: 0.7,
    roughness: 0.35,
    metalness: 0.75,
    edgeOpacity: 1,
    clip: afterClip,
  });

  const car = new THREE.Group();
  car.add(beforeGroup, afterGroup);
  scene.add(car);

  const scan = buildScanPlane();
  scene.add(scan);

  const grid = new THREE.GridHelper(70, 70, COLOR.grid, 0x24231f);
  grid.material.transparent = true;
  grid.material.opacity = 0.14;
  scene.add(grid);

  let dust = buildDust(700);
  scene.add(dust);

  const markers = HOTSPOTS.map((spot) => {
    const dot = new THREE.Mesh(
      new THREE.SphereGeometry(0.05, 14, 14),
      new THREE.MeshBasicMaterial({ color: COLOR.faultEdge })
    );
    dot.position.set(spot.x, spot.y, spot.z);
    scene.add(dot);

    const el = document.createElement('div');
    el.className = 'hot';
    el.innerHTML = '<span class="hot-state">Fault</span><span class="hot-name"></span>';
    el.querySelector('.hot-name').textContent = spot.before;
    layer.appendChild(el);

    return { spot, dot, el, fixed: false, vec: new THREE.Vector3() };
  });

  // --- viewport-dependent framing -----------------------------------------
  let width = 0;
  let height = 0;
  let baseRadius = 8;
  let focusY = 0.2;
  let small = false;

  const resize = () => {
    width = section.clientWidth;
    height = window.innerHeight;
    small = width < 760;

    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, small ? 2 : 1.75));
    renderer.setSize(width, height, false);
    camera.aspect = width / Math.max(height, 1);
    camera.updateProjectionMatrix();

    // Solve the distance at which the bounding sphere fits both axes, so a
    // 9:19.5 phone pulls back instead of slicing the nose and tail off.
    const halfV = THREE.MathUtils.degToRad(camera.fov) / 2;
    const halfH = Math.atan(Math.tan(halfV) * camera.aspect);
    // Fitting the whole sphere in a 9:19.5 frame leaves the car tiny, so phones
    // fit a smaller sphere and let the bumpers bleed past the edges instead.
    const fitRadius = CAR_RADIUS * (small ? 0.88 : 1);
    baseRadius = Math.max(
      fitRadius / Math.sin(halfH),
      fitRadius / Math.sin(halfV)
    ) * 1.05;

    // Look below the car so it rides above the headline block. Phones need a
    // much bigger push because the copy takes two thirds of the screen.
    focusY = small ? -1.9 : -0.25;

    const wanted = small ? 260 : 700;
    if (dust.geometry.attributes.position.count !== wanted) {
      scene.remove(dust);
      dust.geometry.dispose();
      dust = buildDust(wanted);
      scene.add(dust);
    }
  };
  resize();
  window.addEventListener('resize', resize, { passive: true });
  window.addEventListener('orientationchange', resize, { passive: true });

  let target = 0;
  let eased = 0;
  const readScroll = () => {
    const rect = section.getBoundingClientRect();
    const scrollable = section.offsetHeight - window.innerHeight;
    target = scrollable > 0 ? clamp(-rect.top / scrollable, 0, 1) : 0;
  };
  window.addEventListener('scroll', readScroll, { passive: true });
  readScroll();
  eased = target;

  const focus = new THREE.Vector3(0, 0, 0);
  const clock = new THREE.Clock();
  let running = true;

  const observer = new IntersectionObserver(
    (entries) => entries.forEach((entry) => { running = entry.isIntersecting; }),
    { rootMargin: '150px' }
  );
  observer.observe(section);

  const tick = () => {
    requestAnimationFrame(tick);
    if (!running) return;

    eased += (target - eased) * 0.12;
    const p = eased;
    const t = clock.getElapsedTime();

    // Scan sweeps nose to tail with overshoot at both ends, so the car reads as
    // fully BEFORE at 0 and fully AFTER at 1.
    const scanX = THREE.MathUtils.lerp(-2.8, 2.8, p);
    afterClip.constant = scanX;
    beforeClip.constant = -scanX;
    scan.position.x = scanX;
    scan.visible = p > 0.015 && p < 0.985;
    setScanGlow(scan, 0.72 + Math.sin(t * 6) * 0.18);

    // Narrow screens swing less, so the car never turns edge-on in a tall frame.
    const swing = small ? 16 : 34;
    const azimuth = THREE.MathUtils.degToRad(THREE.MathUtils.lerp(-swing - 8, swing - 8, p));
    const radius = baseRadius * THREE.MathUtils.lerp(1.06, 0.94, p);

    // Phones sit lower to the ground: a big downward tilt in a tall frame makes
    // the car read as a roof plan instead of a car.
    const rise = small
      ? THREE.MathUtils.lerp(0.17, 0.12, p)
      : THREE.MathUtils.lerp(0.3, 0.19, p);

    focus.set(0, focusY, 0);
    camera.position.set(
      Math.sin(azimuth) * radius,
      focusY + baseRadius * rise + Math.sin(t * 0.6) * 0.03,
      Math.cos(azimuth) * radius
    );
    camera.lookAt(focus);

    car.rotation.y = THREE.MathUtils.degToRad(THREE.MathUtils.lerp(-5, 3, p));
    // Until the scan reaches it, the car sits rough and shakes a little.
    car.position.y = (1 - p) * Math.sin(t * 22) * 0.006;

    dust.rotation.y = t * 0.02;

    updateMarkers(markers, camera, scanX, width, height, small);
    renderer.render(scene, camera);
    if (onProgress) onProgress(p);
  };
  tick();

  return { resize };
}

/* ---------------------------------------------------------------------- */

function createRenderer(canvas) {
  try {
    const renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: true,
      alpha: true,
      powerPreference: 'high-performance',
    });
    renderer.localClippingEnabled = true;
    renderer.setClearColor(0x000000, 0);
    return renderer;
  } catch (err) {
    return null;
  }
}

// Lower body and cabin are extruded separately at different widths so the shape
// reads as a car from any angle. A single extrusion just makes a slab.
function buildVehicle(style) {
  const group = new THREE.Group();
  const clippingPlanes = [style.clip];

  const lower = extrude(
    [
      [-2.24, 0.32], [-2.26, 0.62], [-2.02, 0.78], [-1.1, 0.86],
      [1.98, 0.86], [2.2, 0.7], [2.18, 0.32],
    ],
    1.84
  );
  const cabin = extrude(
    [
      [-1.1, 0.86], [-0.64, 1.4], [0.52, 1.46], [1.08, 0.92], [1.08, 0.86],
    ],
    1.58
  );

  for (const geometry of [lower, cabin]) {
    group.add(new THREE.Mesh(geometry, bodyMaterial(style, clippingPlanes)));
    group.add(edgesOf(geometry, style.edgeColor, clippingPlanes, style.edgeOpacity));
  }

  for (const x of [-1.4, 1.4]) {
    for (const z of [-0.94, 0.94]) {
      const tyre = disc(0.46, 0.26, 20, x, 0.46, z);
      group.add(new THREE.Mesh(tyre, new THREE.MeshStandardMaterial({
        color: 0x101215,
        roughness: 0.92,
        metalness: 0.15,
        transparent: true,
        opacity: 0.55,
        clippingPlanes,
      })));
      group.add(edgesOf(tyre, style.edgeColor, clippingPlanes, style.edgeOpacity));
      group.add(edgesOf(disc(0.21, 0.3, 12, x, 0.46, z), style.edgeColor, clippingPlanes, style.edgeOpacity * 0.75));
    }
  }

  return group;
}

function extrude(points, depth) {
  const shape = new THREE.Shape();
  shape.moveTo(points[0][0], points[0][1]);
  for (let i = 1; i < points.length; i += 1) shape.lineTo(points[i][0], points[i][1]);
  shape.lineTo(points[0][0], points[0][1]);

  const geometry = new THREE.ExtrudeGeometry(shape, {
    depth,
    bevelEnabled: false,
    curveSegments: 1,
  });
  geometry.translate(0, 0, -depth / 2);
  return geometry;
}

function disc(radius, thickness, segments, x, y, z) {
  const geometry = new THREE.CylinderGeometry(radius, radius, thickness, segments, 1);
  geometry.rotateX(Math.PI / 2);
  geometry.translate(x, y, z);
  return geometry;
}

function bodyMaterial(style, clippingPlanes) {
  return new THREE.MeshStandardMaterial({
    color: style.bodyColor,
    emissive: style.emissive,
    emissiveIntensity: style.emissiveIntensity,
    roughness: style.roughness,
    metalness: style.metalness,
    transparent: true,
    opacity: style.bodyOpacity,
    depthWrite: false,
    clippingPlanes,
    side: THREE.DoubleSide,
  });
}

function edgesOf(geometry, color, clippingPlanes, opacity) {
  return new THREE.LineSegments(
    new THREE.EdgesGeometry(geometry, 18),
    new THREE.LineBasicMaterial({ color, transparent: true, opacity, clippingPlanes })
  );
}

// A barely-there sheet with a bright outline. A solid additive quad at this
// size reads as a gold wall across the frame, not as a scan.
function buildScanPlane() {
  const group = new THREE.Group();

  const plane = new THREE.PlaneGeometry(2.9, 2.3);
  plane.rotateY(Math.PI / 2);
  plane.translate(0, 0.95, 0);

  const sheet = new THREE.Mesh(plane, new THREE.MeshBasicMaterial({
    color: COLOR.scan,
    transparent: true,
    opacity: 0.06,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    side: THREE.DoubleSide,
  }));

  const outline = new THREE.LineSegments(
    new THREE.EdgesGeometry(plane),
    new THREE.LineBasicMaterial({
      color: COLOR.scan,
      transparent: true,
      opacity: 0.8,
      depthWrite: false,
    })
  );

  group.add(sheet, outline);
  group.renderOrder = 5;
  group.userData.sheet = sheet;
  group.userData.outline = outline;
  return group;
}

function setScanGlow(scan, value) {
  scan.userData.outline.material.opacity = clamp(value, 0, 1);
  scan.userData.sheet.material.opacity = clamp(value * 0.09, 0, 1);
}

function buildDust(count) {
  const positions = new Float32Array(count * 3);
  for (let i = 0; i < count; i += 1) {
    positions[i * 3] = (Math.random() - 0.5) * 30;
    positions[i * 3 + 1] = Math.random() * 8;
    positions[i * 3 + 2] = (Math.random() - 0.5) * 30;
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  return new THREE.Points(geometry, new THREE.PointsMaterial({
    color: COLOR.grid,
    size: 0.035,
    transparent: true,
    opacity: 0.4,
    depthWrite: false,
  }));
}

// Only the hotspot the scan is currently passing gets a label. Four pills at
// once overlap each other and the headline on a phone, and reading one callout
// per moment tells the before/after story better anyway.
function updateMarkers(markers, camera, scanX, width, height, small) {
  // Below this line the headline and buttons live. A label that drifts into it
  // fades out rather than sitting on top of the copy.
  const copyTop = small ? 0.34 : 0.6;
  const reach = 1.7;

  let active = null;
  let best = Infinity;
  for (const marker of markers) {
    const distance = Math.abs(marker.spot.x - scanX);
    if (distance < best && distance < reach) {
      best = distance;
      active = marker;
    }
  }

  for (const marker of markers) {
    const { spot, dot, el, vec } = marker;
    const fixed = spot.x <= scanX;
    if (fixed !== marker.fixed) {
      marker.fixed = fixed;
      dot.material.color.setHex(fixed ? COLOR.goldEdge : COLOR.faultEdge);
      el.classList.toggle('is-fixed', fixed);
      el.querySelector('.hot-state').textContent = fixed ? 'Fixed' : 'Fault';
      el.querySelector('.hot-name').textContent = fixed ? spot.after : spot.before;
    }

    vec.set(spot.x, spot.y, spot.z).project(camera);
    const nx = vec.x * 0.5 + 0.5;
    const ny = -vec.y * 0.5 + 0.5;
    const onScreen = vec.z <= 1 && ny < copyTop && nx > 0.06 && nx < 0.94;

    el.style.opacity = marker === active && onScreen ? '1' : '0';
    el.style.transform =
      'translate(-50%, -50%) translate(' +
      (nx * width).toFixed(1) + 'px,' + (ny * height).toFixed(1) + 'px)';
  }
}

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}
