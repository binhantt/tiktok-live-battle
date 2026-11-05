import Phaser from 'phaser';

function shape(graphics: Phaser.GameObjects.Graphics, color: number, points: number[][]) {
  graphics.fillStyle(color);
  graphics.fillPoints(points.map(([x, y]) => ({ x, y })), true);
}

export function createBuilderSheet(scene: Phaser.Scene, key: string, cool: boolean) {
  if (scene.textures.exists(key)) return;
  const texture = scene.textures.createCanvas(key, 264, 55);
  if (!texture) return;
  const context = texture.getContext();
  const uniform = cool ? '#5185a5' : '#ae6050';
  const poses = [
    { step: 0, lift: 0, arm: 0 },
    { step: 3, lift: 1, arm: 2 },
    { step: -3, lift: 1, arm: -1 },
    { step: 0, lift: 2, arm: -11 },
    { step: 2, lift: -2, arm: 9 },
    { step: -2, lift: -6, arm: 4 },
  ];
  for (const [frame, pose] of poses.entries()) {
    const offset = frame * 44;
    const paint = (color: string, x: number, y: number, width: number, height: number) => {
      context.fillStyle = color;
      context.fillRect(offset + x, y, width, height);
    };
    if (frame === 5) {
      paint('#263142', 6, 43, 29, 6);
      paint(uniform, 14, 41, 13, 6);
      paint('#bd8253', 28, 42, 7, 5);
      paint('#e5b753', 29, 39, 8, 4);
    } else {
      const y = -pose.lift;
      paint('#283044', 13 - pose.step, 39, 7, 8);
      paint('#283044', 22 + pose.step, 39, 7, 8);
      paint('#1c2431', 12 - pose.step, 46, 10, 4);
      paint('#1c2431', 22 + pose.step, 46, 10, 4);
      paint('#2c3746', 11, 24 + y, 18, 18);
      paint(uniform, 12, 25 + y, 16, 12);
      paint('#d5a06a', 16, 17 + y, 13, 9);
      paint('#73513f', 15, 18 + y, 4, 7);
      paint('#241f28', 25, 19 + y, 2, 2);
      paint('#b7823d', 14, 12 + y, 15, 6);
      paint('#e5b753', 17, 10 + y, 9, 5);
      paint('#f5d374', 12, 15 + y, 20, 3);
      paint('#514638', 12, 37 + y, 16, 4);
      paint('#e4bd71', 19, 37 + y, 4, 3);
      paint('#7c5435', 29, 26 + y + pose.arm, 4, 15);
      paint('#394552', 25, 22 + y + pose.arm, 13, 6);
      paint('#b5c5c9', 26, 22 + y + pose.arm, 11, 3);
      paint('#d5a06a', 25, 31 + y + Math.round(pose.arm / 2), 7, 5);
    }
    texture.add(frame, 0, offset, 0, 44, 55);
  }
  texture.refresh();
}

export function createMount(scene: Phaser.Scene, color: number) {
  const root = scene.add.container();
  const legs = [-17, 13, -13, 18].map((x, index) => {
    const leg = scene.add.graphics({ x, y: -15 });
    const dark = index < 2;
    shape(leg, dark ? 0x28232f : 0x46323a, [[-3, -2], [4, -2], [3, 6], [1, 13], [-4, 13], [-2, 6]]);
    leg.fillStyle(0x191e2c).fillRect(-4, 11, 6, 4);
    return leg;
  });

  const body = scene.add.graphics();
  shape(body, 0x342630, [[-19, -26], [-27, -25], [-33, -14], [-32, -7], [-26, -13], [-24, -20], [-18, -20]]);
  shape(body, 0x664649, [[-23, -26], [-18, -32], [9, -32], [16, -38], [19, -47], [27, -49], [30, -43], [34, -38], [33, -32], [24, -31], [20, -19], [12, -14], [-15, -14], [-22, -19]]);
  shape(body, 0x976654, [[-20, -27], [-16, -30], [9, -30], [16, -36], [21, -44], [27, -44], [27, -40], [20, -29], [12, -23], [-16, -22]]);
  shape(body, 0x292533, [[18, -42], [18, -49], [22, -54], [24, -47], [27, -52], [28, -45], [23, -42], [18, -33], [14, -31]]);
  shape(body, color, [[-13, -31], [10, -31], [7, -20], [-2, -17], [-12, -21]]);
  shape(body, 0x273345, [[-11, -32], [9, -32], [6, -24], [-11, -24]]);
  body.fillStyle(0xffe4b1).fillRect(26, -41, 2, 2);
  root.add([...legs, body]);
  return { root, legs };
}

export function createDragon(scene: Phaser.Scene, cool: boolean) {
  const root = scene.add.container(0, -111);
  const color = cool ? 0x4794ab : 0xb9554d;
  const shadow = cool ? 0x294a6b : 0x602c42;
  const light = cool ? 0x99d7cb : 0xf3a371;
  const farWing = scene.add.graphics({ x: -9, y: -4 });
  shape(farWing, shadow, [[0, 0], [-13, -26], [-34, -37], [-28, -23], [-37, -15], [-24, -14], [-24, -7], [-13, -7]]);
  const body = scene.add.graphics();
  shape(body, shadow, [[-9, -2], [-25, 0], [-39, 13], [-57, 10], [-64, 4], [-60, 14], [-42, 20], [-30, 15], [-16, 9], [4, 11], [17, 4], [22, -6], [37, -9], [42, -16], [34, -20], [23, -20], [15, -13], [8, -8]]);
  shape(body, color, [[-19, 3], [-6, -6], [9, -7], [17, -16], [25, -22], [34, -21], [36, -17], [44, -15], [40, -11], [24, -11], [17, 0], [10, 5], [-9, 6]]);
  shape(body, light, [[12, 4], [18, 1], [25, -10], [38, -10], [36, -7], [25, -5], [19, 6], [10, 9]]);
  shape(body, light, [[22, -21], [17, -31], [27, -24], [32, -23], [36, -29], [37, -21]]);
  shape(body, color, [[2, 6], [13, 5], [13, 12], [21, 15], [12, 16], [7, 13]]);
  body.fillStyle(0xffe99a).fillRect(30, -18, 3, 2);
  const nearWing = scene.add.graphics({ x: 1, y: -5 });
  shape(nearWing, shadow, [[3, 3], [-10, -30], [-37, -42], [-31, -26], [-45, -13], [-31, -14], [-31, -6], [-20, -9], [-14, -3]]);
  shape(nearWing, color, [[1, 0], [-14, -28], [-33, -37], [-27, -26], [-36, -16], [-27, -17], [-27, -10], [-19, -12], [-11, -6]]);
  nearWing.lineStyle(2, light, 0.8);
  nearWing.lineBetween(-14, -28, -27, -17);
  nearWing.lineBetween(-14, -28, -19, -12);
  root.add([farWing, body, nearWing]);
  return { root, farWing, nearWing };
}
