import Phaser from 'phaser';
import type { DynamicObstacleDto, FactionType, LandscapeSlowZoneDto } from '../types/game.types';

type Art = Phaser.GameObjects.Graphics;
type Point = [number, number];

const stone = { edge: 0x121c2d, dark: 0x222f44, face: 0x39485b, light: 0x526076 };
const wood = { dark: 0x251e24, face: 0x54403a, light: 0x77604c };
const banners = {
  police: { dark: 0x243a5d, cloth: 0x38638b, trim: 0x97bccb },
  smuggler: { dark: 0x512c40, cloth: 0x854550, trim: 0xe3a58d },
};

function polygon(g: Art, color: number, points: Point[], alpha = 1) {
  g.fillStyle(color, alpha).fillPoints(points.map(([x, y]) => ({ x, y })), true);
}

function rect(g: Art, color: number, x: number, y: number, w: number, h: number, alpha = 1) {
  g.fillStyle(color, alpha).fillRect(x, y, w, h);
}

function pine(g: Art, x: number, y: number, h: number, color: number) {
  const w = h * 0.25;
  rect(g, color, x - 2, y - h * 0.3, 4, h * 0.3);
  polygon(g, color, [
    [x, y - h], [x + w * 0.56, y - h * 0.59], [x + w * 0.31, y - h * 0.62],
    [x + w, y - h * 0.17], [x, y - h * 0.24], [x - w, y - h * 0.17],
    [x - w * 0.31, y - h * 0.62], [x - w * 0.56, y - h * 0.59],
  ]);
}

export const NIGHT_GROUND = 0x131d24;

export function drawNightArena(scene: Phaser.Scene, width: number, height: number) {
  const random = new Phaser.Math.RandomDataGenerator(['night-march']);
  const sky = scene.add.graphics().setDepth(-40);
  sky.fillStyle(0x172336).fillGradientStyle(0x0b1024, 0x0b1024, 0x475668, 0x475668);
  sky.fillRect(0, 0, width, 780);
  for (let x = 20; x < width; x += random.between(19, 65)) {
    const y = random.between(24, 520);
    const size = random.frac() > 0.9 ? 2 : 1;
    sky.fillStyle(0xd4d7e7, random.realInRange(0.27, 0.7)).fillCircle(x, y, size);
  }
  const moonX = width / 2 + 135;
  const moonY = 274;
  for (const radius of [136, 106, 82, 64]) {
    sky.fillStyle(0xc8c7db, 0.045).fillCircle(moonX, moonY, radius);
  }
  sky.fillStyle(0xdad8cf).fillCircle(moonX, moonY, 46);
  sky.fillStyle(0x8794aa, 0.2).fillEllipse(moonX - 15, moonY + 7, 28, 20);
  sky.fillEllipse(moonX + 14, moonY - 13, 22, 15);

  for (let x = -80; x < width; x += random.between(280, 640)) {
    const y = random.between(252, 514);
    const w = random.between(320, 820);
    polygon(sky, 0x252d47, [[x, y + 15], [x + w * 0.22, y + 1], [x + w * 0.48, y],
      [x + w * 0.64, y + 11], [x + w, y + 16], [x + w * 0.59, y + 24],
      [x + w * 0.29, y + 20]], 0.32);
  }

  const landscape = scene.add.graphics().setDepth(-31);
  const ridges = [
    { color: 0x353f57, height: 170, y: 590, gap: 340 },
    { color: 0x27364a, height: 124, y: 654, gap: 244 },
    { color: 0x1f303e, height: 88, y: 716, gap: 195 },
  ];
  for (const ridge of ridges) {
    const points: Point[] = [[0, 752], [0, ridge.y]];
    for (let x = 0; x < width; x += ridge.gap) {
      const crest = ridge.y - random.between(34, ridge.height);
      const gap = Math.min(ridge.gap, width - x);
      points.push([x + gap * 0.24, crest + 28], [x + gap * 0.44, crest],
        [x + gap * 0.62, crest + 17], [x + gap * 0.86, ridge.y - 14]);
    }
    points.push([width, ridge.y], [width, 752]);
    polygon(landscape, ridge.color, points);
  }

  const forest = scene.add.graphics().setDepth(-26);
  for (let x = 10; x < width; x += random.between(18, 47)) {
    pine(forest, x, random.between(706, 735), random.between(23, 67), 0x243944);
  }
  for (let x = 5; x < width; x += random.between(31, 96)) {
    pine(forest, x, random.between(730, 746), random.between(31, 87), 0x192b33);
  }

  const ground = scene.add.graphics().setDepth(-22);
  ground.fillStyle(NIGHT_GROUND).fillGradientStyle(0x30403e, 0x30403e, NIGHT_GROUND, NIGHT_GROUND);
  ground.fillRect(0, 741, width, height - 741);
  const road: Point[] = [[0, 760]];
  for (let x = 80; x <= width; x += 80) road.push([x, random.between(753, 764)]);
  for (let x = width; x >= 0; x -= 80) road.push([x, random.between(842, 859)]);
  polygon(ground, 0x484641, road);
  rect(ground, 0x55504a, 0, 782, width, 33, 0.5);
  for (let x = 12; x < width; x += random.between(13, 35)) {
    const y = random.between(766, 846);
    rect(ground, random.frac() < 0.42 ? 0x676057 : 0x353735, x, y, random.between(4, 23), random.between(1, 3), 0.5);
    const grassY = random.between(862, 1062);
    polygon(ground, 0x496058, [[x - 5, grassY - 10], [x, grassY - 4], [x + 5, grassY - 9],
      [x + 2, grassY], [x, grassY]], 0.55);
  }

  const mist = scene.add.graphics().setDepth(-23);
  for (let x = -100; x < width; x += random.between(220, 410)) {
    mist.fillStyle(0x9ba8b5, 0.055).fillEllipse(x, random.between(710, 745), random.between(390, 770), random.between(20, 44));
  }
}

function banner(g: Art, x: number, y: number, faction: FactionType, scale = 1) {
  const palette = banners[faction];
  const w = 12 * scale;
  rect(g, wood.light, x - w - 4, y - 4, w * 2 + 8, 4);
  polygon(g, palette.dark, [[x - w, y], [x + w, y], [x + w, y + 37 * scale],
    [x, y + 46 * scale], [x - w, y + 37 * scale]]);
  polygon(g, palette.cloth, [[x - w + 2, y + 2], [x + w - 3, y + 2], [x + w - 3, y + 34 * scale],
    [x, y + 41 * scale], [x - w + 2, y + 34 * scale]]);
  const cy = y + 17 * scale;
  polygon(g, palette.trim, [[x, cy - 6], [x + 5, cy], [x, cy + 8], [x - 5, cy]]);
}

function fire(scene: Phaser.Scene, root: Phaser.GameObjects.Container, x: number, y: number, scale: number) {
  const glow = scene.add.graphics({ x, y }).setScale(scale);
  for (const radius of [46, 32, 21, 13]) {
    glow.fillStyle(0xffaf59, 0.075).fillCircle(0, 0, radius);
  }
  const flame = scene.add.graphics({ x, y }).setScale(scale);
  polygon(flame, 0xca673a, [[-7, 6], [-7, 0], [-2, -10], [1, -7], [4, -14], [6, -5], [7, 4], [3, 9], [-3, 9]]);
  polygon(flame, 0xffbd66, [[-4, 5], [-2, -4], [0, 0], [3, -7], [4, 3], [2, 7], [-2, 8]]);
  rect(flame, 0xffe6aa, -1, 2, 3, 5);
  root.add([glow, flame]);
  scene.tweens.add({
    targets: glow, alpha: { from: 0.65, to: 1 }, duration: 390 + Math.abs(x * 7) % 330,
    yoyo: true, repeat: -1, ease: 'Sine.easeInOut',
  });
  scene.tweens.add({
    targets: flame, scaleY: scale * 0.74, duration: 170 + Math.abs(x * 3) % 90,
    yoyo: true, repeat: -1, ease: 'Sine.easeInOut',
  });
  flame.once(Phaser.GameObjects.Events.DESTROY, () => scene.tweens.killTweensOf([glow, flame]));
}

function palisade(g: Art, x: number, bottom: number, width: number, height: number, step: number) {
  for (let offset = 0; offset < width; offset += step) {
    const post = x + offset;
    const top = bottom - height - Math.round(Math.sin(post * 0.47) * 4);
    polygon(g, wood.dark, [[post, bottom], [post, top + 11], [post + step * 0.5, top], [post + step, top + 11], [post + step, bottom]]);
    polygon(g, wood.face, [[post + 2, bottom - 2], [post + 2, top + 12], [post + step * 0.5, top + 3],
      [post + step - 2, top + 11], [post + step - 2, bottom - 2]]);
    rect(g, wood.light, post + 3, top + 13, 2, bottom - top - 20, 0.72);
  }
  rect(g, wood.dark, x, bottom - height * 0.5, width, 6);
  rect(g, wood.dark, x, bottom - 11, width, 5);
}

function stakes(g: Art, x: number, y: number, size: number) {
  g.lineStyle(size * 0.15, wood.dark);
  g.lineBetween(x - size * 0.5, y, x + size * 0.31, y - size * 0.66);
  g.lineBetween(x + size * 0.51, y, x - size * 0.28, y - size * 0.71);
  g.lineStyle(size * 0.07, wood.light);
  g.lineBetween(x - size * 0.48, y - 2, x + size * 0.31, y - size * 0.66);
  g.lineBetween(x + size * 0.48, y - 2, x - size * 0.28, y - size * 0.71);
  polygon(g, 0x7e8a91, [[x + size * 0.16, y - size * 0.56], [x + size * 0.43, y - size * 0.79], [x + size * 0.32, y - size * 0.57]]);
}

export function drawTerrainHazards(art: Art, zones: LandscapeSlowZoneDto[]) {
  art.clear();
  for (const zone of zones) {
    const x = zone.x;
    const left = x - zone.width / 2;
    const right = x + zone.width / 2;
    const top = Math.max(755, zone.y - zone.height / 2);
    const bottom = Math.min(850, zone.y + zone.height / 2);
    const center = (top + bottom) / 2;
    const scale = zone.width / 240;

    if (zone.kind === 'mud') {
      const bank: Point[] = [[left, center], [left + 22 * scale, top + 19], [x - 50 * scale, top + 8],
        [x + 31 * scale, top + 14], [right - 18 * scale, top + 9], [right, center + 10],
        [right - 32 * scale, bottom - 13], [x + 21 * scale, bottom - 2],
        [x - 61 * scale, bottom - 9], [left + 12 * scale, bottom - 21]];
      polygon(art, 0x2a2b30, bank, 0.89);
      art.fillStyle(0x4f5357, 0.64).fillEllipse(x + 9 * scale, center - 7, 153 * scale, 38);
      art.fillStyle(0x62737c, 0.48).fillEllipse(x - 22 * scale, center - 11, 65 * scale, 8);
      art.fillStyle(0x798387, 0.5).fillEllipse(x + 47 * scale, center + 9, 43 * scale, 4);
      for (let dx = -92; dx <= 92; dx += 21) {
        rect(art, 0x8a7461, x + dx * scale, bottom - 21 + Math.sin(dx) * 6, 8, 2, 0.57);
      }
    } else if (zone.kind === 'spikes') {
      for (let sx = left + 22; sx < right - 13; sx += 42) {
        const y = Math.round((sx - left) / 42) % 2 ? top + 23 : bottom - 8;
        art.fillStyle(0x242427, 0.65).fillEllipse(sx, y - 2, 39, 12);
        stakes(art, sx, y, 27);
      }
    } else {
      for (const [offset, y, angle] of [[-64, top + 24, -0.13], [0, bottom - 13, 0.14], [64, top + 23, 0.1]]) {
        const bx = x + offset * scale;
        art.fillStyle(0x26262a, 0.65).fillEllipse(bx, y, 57 * scale, 13);
        polygon(art, wood.face, [[bx - 26 * scale, y - 7], [bx - 22 * scale, y - 12],
          [bx + 28 * scale, y - 12 + angle * 47], [bx + 23 * scale, y - 5 + angle * 47]]);
        art.lineStyle(2, wood.light).lineBetween(bx - 20 * scale, y - 10, bx + 25 * scale, y - 10 + angle * 47);
        stakes(art, bx - 17 * scale, y, 17);
        stakes(art, bx + 16 * scale, y + angle * 30, 15);
      }
    }
  }
}

export function playTerrainStep(scene: Phaser.Scene, kind: LandscapeSlowZoneDto['kind'], x: number, y: number, depth: number, direction: number) {
  const mud = kind === 'mud';
  const spikes = kind === 'spikes';
  if (mud) {
    const ripple = scene.add.ellipse(x, y + 1, 16, 5).setDepth(depth - 1);
    ripple.setStrokeStyle(1.5, 0xa3abb1, 0.72);
    scene.tweens.add({
      targets: ripple, scale: 2.1, alpha: 0, duration: 260, onComplete: () => ripple.destroy(),
    });
  }
  for (let i = 0; i < 3; i++) {
    const particle = scene.add.rectangle(x + i * 3, y - 2, 3, mud ? 3 : 2,
      mud ? 0x8b7463 : spikes ? 0xe9bd7c : 0xa8957a, 0.85).setDepth(depth + 1);
    scene.tweens.add({
      targets: particle, x: particle.x - direction * (9 + i * 5), y: y - 12 + i * 2,
      alpha: 0, angle: 55, duration: 170 + i * 25, ease: 'Quad.easeOut',
      onComplete: () => particle.destroy(),
    });
  }
}

function tent(g: Art, x: number, y: number, w: number, h: number, faction: FactionType) {
  const palette = banners[faction];
  g.fillStyle(0x121b24, 0.55).fillEllipse(x, y, w * 1.35, 14);
  polygon(g, palette.dark, [[x - w * 0.68, y], [x - w * 0.17, y - h], [x + w * 0.2, y - h + 7], [x + w * 0.69, y]]);
  polygon(g, palette.cloth, [[x - w * 0.64, y - 2], [x - w * 0.17, y - h + 3], [x + w * 0.12, y - 2]]);
  polygon(g, 0x2a2934, [[x - w * 0.35, y], [x - w * 0.16, y - h + 14], [x - w * 0.01, y]]);
  g.lineStyle(2, 0xa99176, 0.75);
  g.lineBetween(x - w * 0.17, y - h, x + w * 0.2, y - h + 7);
  g.lineBetween(x + w * 0.2, y - h + 7, x + w * 0.69, y);
  g.lineBetween(x - w * 0.47, y - h * 0.25, x - w * 0.8, y + 3);
}

export function createCamp(scene: Phaser.Scene, x: number, faction: FactionType) {
  const direction = faction === 'police' ? 1 : -1;
  const camp = scene.add.container(x, 747).setScale(direction, 1).setDepth(-12);
  const art = scene.add.graphics();
  camp.add(art);
  palisade(art, -319, 14, 122, 31, 12);
  palisade(art, 205, 12, 134, 27, 12);
  tent(art, -268, 6, 92, 56, faction);
  tent(art, 266, 2, 95, 59, faction);
  tent(art, 314, 17, 56, 37, faction);
  rect(art, wood.dark, -215, -2, 21, 17);
  rect(art, wood.light, -213, 0, 17, 3);
  art.fillStyle(0x1c2329).fillEllipse(224, 18, 42, 12);
  art.lineStyle(4, wood.light).lineBetween(213, 21, 234, 14);
  art.lineBetween(214, 14, 233, 21);
  fire(scene, camp, 224, 10, 1);
}

function masonry(g: Art, x: number, y: number, w: number, h: number, pitch = 20) {
  rect(g, stone.edge, x - 2, y - 2, w + 4, h + 4);
  rect(g, stone.face, x, y, w, h);
  rect(g, stone.dark, x + w * 0.78, y, w * 0.22, h);
  for (let row = 0; row * pitch < h; row++) {
    const top = y + row * pitch;
    const blockHeight = Math.min(h - row * pitch, pitch);
    rect(g, stone.dark, x, top, w, 2);
    for (let dx = row % 2 ? 0 : -pitch; dx < w; dx += pitch * 1.75) {
      const left = Math.max(0, dx);
      const right = Math.min(w, dx + pitch * 1.75);
      if (right - left < 4) continue;
      rect(g, stone.edge, x + left, top + 2, 1, blockHeight - 2, 0.53);
      if ((row + Math.round(dx / pitch)) % 3 !== 1) {
        rect(g, stone.light, x + left + 3, top + 3, right - left - 5, 2, 0.65);
      }
    }
  }
}

function battlement(g: Art, x: number, y: number, w: number) {
  rect(g, stone.edge, x - 3, y, w + 6, 16);
  rect(g, stone.light, x - 2, y, w + 4, 4);
  for (let dx = 0; dx < w; dx += 28) {
    const merlon = Math.min(17, w - dx);
    rect(g, stone.edge, x + dx - 1, y - 12, merlon + 2, 14);
    rect(g, stone.face, x + dx, y - 11, merlon, 12);
    rect(g, stone.light, x + dx, y - 11, merlon, 2);
  }
}

function tower(g: Art, x: number, top: number, bottom: number, w: number, roof: boolean) {
  masonry(g, x - w / 2, top, w, bottom - top, 17);
  if (roof) {
    polygon(g, stone.edge, [[x - w * 0.65, top + 4], [x - w * 0.18, top - 36],
      [x + w * 0.18, top - 36], [x + w * 0.65, top + 4]]);
    polygon(g, 0x3b485f, [[x - w * 0.58, top], [x - w * 0.18, top - 33],
      [x + w * 0.14, top - 33], [x + w * 0.53, top]]);
    polygon(g, 0x536079, [[x - w * 0.58, top], [x - w * 0.18, top - 33], [x, top - 33], [x - w * 0.14, top]]);
    rect(g, stone.dark, x - w * 0.56, top - 1, w * 1.12, 5);
  } else {
    battlement(g, x - w / 2 - 3, top, w + 6);
  }
  for (const y of [top + 28, bottom - 51]) {
    rect(g, stone.edge, x - 6, y, 12, 22);
    rect(g, 0xd69258, x - 2, y + 5, 4, 13, 0.82);
    rect(g, stone.light, x - 7, y + 21, 14, 2);
  }
}

function gate(g: Art, x: number, y: number, w: number, h: number) {
  const arch = (radius: number, top: number): Point[] => [
    [x - radius, y], [x - radius, top + 25], [x - radius * 0.63, top + 9], [x, top],
    [x + radius * 0.63, top + 9], [x + radius, top + 25], [x + radius, y],
  ];
  polygon(g, stone.light, arch(w / 2 + 9, y - h - 8));
  polygon(g, stone.edge, arch(w / 2 + 4, y - h - 3));
  polygon(g, wood.dark, arch(w / 2, y - h));
  const points = arch(w / 2 - 4, y - h + 5);
  polygon(g, wood.face, points);
  for (let dx = -w / 2 + 10; dx < w / 2 - 4; dx += 9) {
    const top = y - h + 13 + Math.abs(dx) * 0.48;
    rect(g, wood.dark, x + dx, top, 2, y - top);
  }
  rect(g, stone.edge, x - w / 2 + 3, y - h * 0.4, w - 6, 6);
  rect(g, 0xcb9c62, x - 7, y - h * 0.4 + 2, 3, 3);
  rect(g, 0xcb9c62, x + 5, y - h * 0.4 + 2, 3, 3);
}

export function createStructureArt(scene: Phaser.Scene, obstacle: DynamicObstacleDto) {
  const { width, height, faction = 'police', tierIndex, type } = obstacle;
  const cannon = obstacle.structureRole === 'citadel' || type === 'citadel' || obstacle.id.startsWith('fortress_');
  const outpost = tierIndex === 1 || type === 'gate';
  const stoneWall = tierIndex === 2 || obstacle.structureRole === 'wall' || type === 'tower' || type === 'wall';
  const hasFortification = cannon || outpost || stoneWall;
  const sx = width / 400;
  const sy = height / 240;
  const root = scene.add.container().setScale(sx, sy);
  const art = scene.add.graphics();
  root.add(art);
  const direction = faction === 'police' ? 1 : -1;
  let muzzle: Point = [0, -40];
  const lamps: Point[] = [];
  art.fillStyle(0x121a24, 0.55).fillEllipse(0, 118, 412, 22);

  if (cannon) {
    tower(art, -103, -83, 69, 66, true);
    tower(art, 102, -83, 69, 66, true);
    masonry(art, -70, -65, 140, 149, 20);
    battlement(art, -73, -72, 146);
    tower(art, -159, -45, 117, 72, false);
    tower(art, 159, -45, 117, 72, false);
    masonry(art, -128, -13, 256, 132, 19);
    battlement(art, -132, -20, 264);
    gate(art, 0, 119, 82, 93);
    banner(art, -84, 1, faction, 1.06);
    banner(art, 84, 1, faction, 1.06);
    muzzle = [direction * 39, -91];
    rect(art, stone.edge, -16, -88, 34, 12);
    polygon(art, 0x66738a, [[-13 * direction, -90], [36 * direction, -99], [40 * direction, -91], [-13 * direction, -82]]);
    art.fillStyle(0x171c2b).fillCircle(-7 * direction, -80, 9);
    lamps.push([-53, 63], [53, 63]);
  } else if (outpost) {
    const watchX = -direction * 124;
    palisade(art, -193, 117, 386, 103, 16);
    tower(art, watchX, -60, 76, 60, true);
    palisade(art, -193, 119, 386, 67, 16);
    gate(art, 0, 119, 100, 87);
    banner(art, watchX, -16, faction);
    muzzle = [watchX + direction * 26, -21];
    lamps.push([-67, 59], [67, 59]);
  } else if (stoneWall) {
    const watchX = -direction * 85;
    tower(art, watchX, -78, 117, 110, true);
    masonry(art, -192, 8, 384, 110, 22);
    battlement(art, -196, 2, 392);
    tower(art, direction * 148, -26, 118, 82, false);
    gate(art, direction * 34, 118, 87, 78);
    banner(art, watchX, 28, faction, 1.2);
    muzzle = [direction * 148, -39];
    lamps.push([direction * -22, 62], [direction * 92, 62]);
  } else if (type === 'sandbag') {
    for (let row = 0; row < 3; row++) {
      const count = 4 - row;
      for (let i = 0; i < count; i++) {
        const x = (i - count / 2) * 89;
        const y = 70 - row * 35 + i % 2 * 5;
        art.fillStyle(0x332a2a).fillRoundedRect(x, y, 89, 46, 17);
        art.fillStyle(0x7e6c53).fillRoundedRect(x + 3, y + 4, 83, 30, 12);
        art.lineStyle(4, 0xb5a07e, 0.78).lineBetween(x + 18, y + 9, x + 64, y + 9);
        rect(art, 0x5a4f42, x + 69, y + 10, 4, 23);
      }
    }
    rect(art, banners[faction].cloth, -41, 17, 82, 9);
    muzzle = [0, 0];
  } else if (type === 'barbwire') {
    for (let x = -125; x <= 125; x += 83) {
      stakes(art, x, 110, 118);
    }
    art.lineStyle(7, 0x84939b, 0.86);
    for (let x = -140; x <= 140; x += 34) art.strokeEllipse(x, 54, 77, 46);
    art.lineStyle(3, 0xbdc5c3, 0.9).lineBetween(-179, 49, 179, 49);
    muzzle = [0, 22];
  } else if (type === 'rock') {
    polygon(art, stone.dark, [[-185, 110], [-150, 43], [-65, 15], [60, 32], [145, 5], [193, 111]]);
    polygon(art, stone.light, [[-155, 47], [-65, 15], [60, 32], [143, 7], [144, 53], [-41, 67]], 0.72);
    muzzle = [0, 15];
  } else if (type === 'crate' || type === 'bunker') {
    rect(art, wood.dark, -172, 6, 344, 113);
    rect(art, wood.face, -159, 14, 318, 92);
    art.lineStyle(9, wood.light).lineBetween(-152, 97, 144, 20);
    muzzle = [0, 9];
  } else {
    palisade(art, -183, 119, 366, 132, 38);
    muzzle = [0, -13];
  }

  for (const [x, y] of lamps) {
    rect(art, wood.dark, x - 3, y + 5, 6, 17);
    rect(art, 0x796656, x - 6, y + 7, 12, 4);
    fire(scene, root, x, y, 1);
  }

  const damage = scene.add.graphics().setVisible(false);
  damage.lineStyle(3, 0x171c25, 0.85);
  damage.beginPath().moveTo(-104, 23).lineTo(-115, 38).lineTo(-99, 48).lineTo(-110, 70).strokePath();
  damage.beginPath().moveTo(121, 38).lineTo(105, 52).lineTo(121, 62).lineTo(114, 76).strokePath();
  root.add(damage);
  return {
    root, damage, cannon, hasFortification, muzzleX: muzzle[0] * sx, muzzleY: muzzle[1] * sy,
  };
}
