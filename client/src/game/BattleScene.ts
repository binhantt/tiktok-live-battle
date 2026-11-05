import Phaser from 'phaser';
import { createBuilderSheet, createDragon, createMount } from './fighter-art';
import { MotionTimeline } from './motion-timeline';
import { createCamp, createStructureArt, drawNightArena, drawTerrainHazards, NIGHT_GROUND, playTerrainStep } from './night-arena';
import { CAPTURE_ZONES_CONFIG, CaptureZone } from './arena-obstacles';
import {
  BattleSnapshot,
  CharacterAttackPayload,
  CharacterDamagePayload,
  CharacterDeathPayload,
  CharacterMovePayload,
  CharacterSpawnPayload,
  CharacterStateDto,
  FactionType,
  HostageState,
  LandscapeSlowZoneDto,
  RoundResultPayload,
  BombDto,
  DynamicObstacleDto,
  BombExplodedPayload,
} from '../types/game.types';

interface ObstacleVisual {
  container: Phaser.GameObjects.Container;
  art: ReturnType<typeof createStructureArt>;
  shield: Phaser.GameObjects.Graphics;
  shieldText: Phaser.GameObjects.Text;
  hpBar: Phaser.GameObjects.Graphics;
  currentHp: number;
  width: number;
  height: number;
}

const MINIMAP_Y = 115;
const MINIMAP_WIDTH = 460;
const MINIMAP_HEIGHT = 24;

interface VisualFighter {
  container: Phaser.GameObjects.Container;
  bodyContainer: Phaser.GameObjects.Container;
  bodySprite: Phaser.GameObjects.Sprite;
  gear?: Phaser.GameObjects.Graphics;
  mount?: ReturnType<typeof createMount>;
  dragon?: ReturnType<typeof createDragon>;
  gait: number;
  hpBarBg: Phaser.GameObjects.Rectangle;
  hpBarFill: Phaser.GameObjects.Rectangle;
  nameText: Phaser.GameObjects.Text;
  motion: MotionTimeline;
  maxHp: number;
  hp: number;
  faction: FactionType;
  tier: CharacterStateDto['type'];
  textureKey: string;
  attackStyle: 'blade' | 'arrow' | 'spell' | 'heavy' | 'lance' | 'repair';
  facing: CharacterStateDto['facing'];
  animState: CharacterStateDto['animState'];
  lastAttackAt: number;
  lastHitAt: number;
  flashUntil: number;
  stride: number;
  terrainId?: string;
}

export class BattleScene extends Phaser.Scene {
  private readonly fighters = new Map<string, VisualFighter>();
  private readonly floatingTexts: Phaser.GameObjects.Text[] = [];
  private readonly hostageContainers = new Map<number, {
    container: Phaser.GameObjects.Container;
    body: Phaser.GameObjects.Image;
    statusText: Phaser.GameObjects.Text;
    title: Phaser.GameObjects.Text;
    glowRing: Phaser.GameObjects.Arc;
    panicBubble: Phaser.GameObjects.Text;
    walkCycle: number;
    vx: number;
    facing: 'left' | 'right';
    carrierFaction: 'police' | 'smuggler' | null;
    state: 'captured' | 'rescued' | 'eliminated';
    policeNearby: number;
    smugglerNearby: number;
    dustTimer: number;
  }>();
  private currentHostageState: HostageState = 'captured';
  private readonly objectiveGraphics = new Map<string, { ring: Phaser.GameObjects.Arc; label: Phaser.GameObjects.Text; progressText: Phaser.GameObjects.Text }>();
  private readonly bombVisuals = new Map<string, {
    container: Phaser.GameObjects.Container;
    bombBody: Phaser.GameObjects.Arc;
    led: Phaser.GameObjects.Arc;
    timerText: Phaser.GameObjects.Text;
    pulseRing: Phaser.GameObjects.Arc;
    timerMs: number;
    pulseTime: number;
  }>();
  private readonly dynamicObstacleVisuals = new Map<string, ObstacleVisual>();
  private terrainZones: LandscapeSlowZoneDto[] = [];
  private terrainKey = '';
  private terrainArt?: Phaser.GameObjects.Graphics;
  private serverTimestamp = 0;
  private receivedAt = 0;
  private interpolationDelay = 100;
  private sessionId = '';
  private roundNumber = 0;
  private readonly worldWidth = 6400;
  private readonly worldHeight = 1080;
  private minimapGraphics?: Phaser.GameObjects.Graphics;
  private minimapContainer?: Phaser.GameObjects.Container;
  private isUserDragging = false;
  private dragStartX = 0;
  private cameraStartScrollX = 0;
  private lastUserInteractTime = 0;
  private targetZoom = 1.0;

  private readonly onReady?: (scene: BattleScene) => void;

  private syncClock(timestamp: number, tickRate: number) {
    this.serverTimestamp = timestamp;
    this.receivedAt = performance.now();
    this.interpolationDelay = Math.max(40, Math.min(250, 2000 / Math.max(1, tickRate)));
  }

  constructor(onReady?: (scene: BattleScene) => void) {
    super({ key: 'BattleScene' });
    this.onReady = onReady;
  }

  preload() {
    this.load.spritesheet('knight_red', '/assets/sprites/knight_red_sheet.png', { frameWidth: 64, frameHeight: 64 });
    this.load.spritesheet('knight_blue', '/assets/sprites/knight_blue_sheet.png', { frameWidth: 64, frameHeight: 64 });

    this.load.image('projectile_arrow', '/assets/sprites/projectile_arrow.png');
    this.load.image('projectile_cannonball', '/assets/sprites/projectile_cannonball.png');
    this.load.image('hit_spark', '/assets/sprites/hit_spark.png');
    this.load.image('dust_cloud', '/assets/sprites/dust_cloud.png');
  }

  create() {
    createBuilderSheet(this, 'builder_blue', true);
    createBuilderSheet(this, 'builder_red', false);
    this.initFighterAnimations();
    this.drawArenaZones();
    this.onReady?.(this);
  }

  private initFighterAnimations() {
    const clips = [
      { action: 'idle', frames: [0, 1, 2, 1], frameRate: 5, repeat: -1 },
      { action: 'walk', frames: [3, 4, 5, 4], frameRate: 10, repeat: -1 },
      { action: 'attack', frames: [6, 7, 8, 9], frameRate: 15, repeat: 0 },
      { action: 'cast', frames: [6, 10, 11], frameRate: 12, repeat: 0 },
      { action: 'hit', frames: [12, 11], frameRate: 12, repeat: 0 },
      { action: 'die', frames: [13, 14, 15], frameRate: 10, repeat: 0 },
    ];
    for (const texture of ['knight_blue', 'knight_red']) {
      for (const clip of clips) {
        this.anims.create({
          key: texture + '_' + clip.action,
          frames: clip.frames.map((frame) => ({ key: texture, frame })),
          frameRate: clip.frameRate,
          repeat: clip.repeat,
        });
      }
    }

    const builderClips = [
      { action: 'idle', frames: [0], frameRate: 1, repeat: -1 },
      { action: 'walk', frames: [0, 1, 2, 1], frameRate: 8, repeat: -1 },
      { action: 'attack', frames: [3, 4, 3], frameRate: 10, repeat: 0 },
      { action: 'cast', frames: [3, 4], frameRate: 8, repeat: 0 },
      { action: 'hit', frames: [5], frameRate: 8, repeat: 0 },
      { action: 'die', frames: [5], frameRate: 6, repeat: 0 },
    ];
    for (const texture of ['builder_blue', 'builder_red']) {
      for (const clip of builderClips) {
        this.anims.create({
          key: texture + '_' + clip.action,
          frames: clip.frames.map((frame) => ({ key: texture, frame })),
          frameRate: clip.frameRate,
          repeat: clip.repeat,
        });
      }
    }
  }

  private drawArenaZones() {
    this.cameras.main.setBounds(0, 0, this.worldWidth, this.worldHeight);
    this.cameras.main.centerOn(this.worldWidth / 2, this.worldHeight / 2);
    this.cameras.main.setBackgroundColor(NIGHT_GROUND);
    drawNightArena(this, this.worldWidth, this.worldHeight);
    createCamp(this, 400, 'police');
    createCamp(this, this.worldWidth - 400, 'smuggler');
    this.minimapContainer = this.add.container(960, MINIMAP_Y).setScrollFactor(0).setDepth(999);
    this.minimapGraphics = this.add.graphics();
    this.minimapContainer.add(this.minimapGraphics);
    this.initCameraControls();
    this.createAmbientEmbers();
  }

  private initCameraControls() {
    this.input.on('pointerdown', (pointer: Phaser.Input.Pointer) => {
      const mapLeft = 960 - MINIMAP_WIDTH / 2;
      if (Math.abs(pointer.y - MINIMAP_Y) <= MINIMAP_HEIGHT / 2 + 3 &&
          pointer.x >= mapLeft && pointer.x <= mapLeft + MINIMAP_WIDTH) {
        const clickRatio = (pointer.x - mapLeft) / MINIMAP_WIDTH;
        const targetWorldX = clickRatio * this.worldWidth;
        this.cameras.main.scrollX = Phaser.Math.Clamp(targetWorldX - 960, 0, this.worldWidth - 1920);
        this.lastUserInteractTime = performance.now();
        return;
      }
      this.isUserDragging = true;
      this.dragStartX = pointer.x;
      this.cameraStartScrollX = this.cameras.main.scrollX;
      this.lastUserInteractTime = performance.now();
    });

    this.input.on('pointermove', (pointer: Phaser.Input.Pointer) => {
      if (this.isUserDragging) {
        const dx = pointer.x - this.dragStartX;
        this.cameras.main.scrollX = Phaser.Math.Clamp(this.cameraStartScrollX - dx, 0, this.worldWidth - 1920);
        this.lastUserInteractTime = performance.now();
      }
    });

    this.input.on('pointerup', () => {
      this.isUserDragging = false;
    });

    // Cuộn chuột (Mouse Wheel) để phóng to / thu nhỏ góc nhìn lính
    this.input.on('wheel', (_pointer: Phaser.Input.Pointer, _gameObjects: any, _deltaX: number, deltaY: number) => {
      const newZoom = Phaser.Math.Clamp(this.cameras.main.zoom - deltaY * 0.001, 0.65, 1.25);
      this.cameras.main.setZoom(newZoom);
      this.lastUserInteractTime = performance.now();
    });
  }

  private drawMinimap(fighters: VisualFighter[]) {
    if (!this.minimapGraphics || !this.minimapContainer) return;
    const camera = this.cameras.main;
    const inverseZoom = 1 / camera.zoom;
    this.minimapContainer.setScale(inverseZoom);
    this.minimapContainer.y = camera.centerY + (MINIMAP_Y - camera.centerY) * inverseZoom;
    const g = this.minimapGraphics;
    g.clear();

    const mapW = MINIMAP_WIDTH;
    const mapH = MINIMAP_HEIGHT;
    const halfW = mapW / 2;
    const halfH = mapH / 2;

    // Khung nền Minimap
    g.fillStyle(0x0f172a, 0.88);
    g.fillRoundedRect(-halfW, -halfH, mapW, mapH, 6);
    g.lineStyle(1.5, 0x334155, 0.95);
    g.strokeRoundedRect(-halfW, -halfH, mapW, mapH, 6);

    // Vạch chia trung tâm
    g.lineStyle(1, 0x64748b, 0.4);
    g.lineBetween(0, -halfH + 2, 0, halfH - 2);

    const scale = mapW / this.worldWidth;

    // Vị trí các pháo đài trên Minimap
    const forts = [
      { x: 400, color: 0x0284c7, r: 4.5 },
      { x: 1200, color: 0x38bdf8, r: 3.5 },
      { x: 2000, color: 0x7dd3fc, r: 3 },
      { x: 4400, color: 0xfca5a5, r: 3 },
      { x: 5200, color: 0xf87171, r: 3.5 },
      { x: 6000, color: 0xdc2626, r: 4.5 },
    ];
    for (const f of forts) {
      g.fillStyle(f.color, 0.95);
      g.fillCircle(-halfW + f.x * scale, 0, f.r);
    }

    // Các chấm quân lính đang di chuyển
    for (const f of fighters) {
      const fx = -halfW + f.container.x * scale;
      g.fillStyle(f.faction === 'police' ? 0x38bdf8 : 0xf87171, 0.85);
      g.fillCircle(fx, 0, 1.8);
    }

    // Khung chữ nhật hiển thị tầm nhìn Camera hiện tại (Màu vàng kim)
    const left = Math.max(0, camera.worldView.left);
    const right = Math.min(this.worldWidth, camera.worldView.right);
    const boxW = (right - left) * scale;
    const boxX = -halfW + left * scale;
    g.lineStyle(2, 0xfacc15, 1);
    g.strokeRoundedRect(boxX, -halfH + 1, boxW, mapH - 2, 4);
  }

  private createAmbientEmbers() {
    for (let i = 0; i < 32; i++) {
      const x = Phaser.Math.Between(100, 1820);
      const y = Phaser.Math.Between(100, 980);
      const radius = Phaser.Math.FloatBetween(1.5, 3.5);
      const isBlue = x < 960;
      const color = isBlue ? 0x38bdf8 : 0xf87171;
      const ember = this.add.circle(x, y, radius, color, Phaser.Math.FloatBetween(0.2, 0.6));
      this.tweens.add({
        targets: ember,
        y: y - Phaser.Math.Between(40, 90),
        x: x + Phaser.Math.Between(-30, 30),
        alpha: 0.1,
        duration: Phaser.Math.Between(2500, 5000),
        yoyo: true,
        repeat: -1,
        ease: 'Sine.easeInOut',
      });
    }
  }

  private createHostageObject() {
    // Phân vùng con tin đã được loại bỏ hoàn toàn
  }

  public updateHostagesVisual(_hostages?: import('../types/game.types').HostageUnitDto[]) {
    // Không còn phân vùng con tin
  }

  public updateCaptureZonesVisual(_zones?: import('../types/game.types').ObjectiveZoneDto[]) {
    // Không còn phân vùng cứ điểm
  }

  public updateBombsVisual(bombs?: BombDto[]) {
    if (!bombs) return;
    const currentIds = new Set(bombs.map((b) => b.id));
    for (const [id, visual] of this.bombVisuals) {
      if (!currentIds.has(id)) {
        visual.container.destroy();
        this.bombVisuals.delete(id);
      }
    }

    for (const b of bombs) {
      if (b.state === 'exploded') continue;
      let visual = this.bombVisuals.get(b.id);
      if (!visual) {
        const container = this.add.container(b.x, b.y);
        const pulseRing = this.add.circle(0, 0, 24, b.faction === 'police' ? 0x0284c7 : 0xdc2626, 0.3);
        const bombBody = this.add.circle(0, 0, 16, 0x0f172a);
        bombBody.setStrokeStyle(2, b.faction === 'police' ? 0x38bdf8 : 0xef4444);

        const led = this.add.circle(0, -6, 4, 0xef4444);
        const title = this.add
          .text(0, -28, `💣 ${b.placedBy}`, {
            fontFamily: 'Inter, system-ui, sans-serif',
            fontSize: '11px',
            fontStyle: 'bold',
            color: b.faction === 'police' ? '#7dd3fc' : '#fca5a5',
            stroke: '#000000',
            strokeThickness: 3,
          })
          .setOrigin(0.5);

        const timerText = this.add
          .text(0, 18, `${(b.timerMs / 1000).toFixed(1)}s`, {
            fontFamily: 'Inter, system-ui, sans-serif',
            fontSize: '12px',
            fontStyle: 'bold',
            color: '#facc15',
            stroke: '#000000',
            strokeThickness: 3,
          })
          .setOrigin(0.5);

        container.add([pulseRing, bombBody, led, title, timerText]);
        visual = { container, bombBody, led, timerText, pulseRing, timerMs: b.timerMs, pulseTime: 0 };
        this.bombVisuals.set(b.id, visual);
      } else {
        visual.timerMs = b.timerMs;
        visual.container.setPosition(b.x, b.y);
      }
    }
  }

  public updateDynamicObstaclesVisual(obstacles?: DynamicObstacleDto[], serverTime?: number) {
    if (!obstacles) return;
    const currentIds = new Set(obstacles.map((o) => o.id));
    for (const [id, visual] of this.dynamicObstacleVisuals) {
      if (!currentIds.has(id)) {
        this.dynamicObstacleVisuals.delete(id);
        this.playObstacleDestroyedVfx(visual);
      }
    }

    for (const o of obstacles) {
      let visual = this.dynamicObstacleVisuals.get(o.id);
      const isPolice = o.faction === 'police';
      const halfW = o.width / 2;
      const halfH = o.height / 2;

      if (!visual) {
        const container = this.add.container(o.x, o.y);
        const shield = this.add.graphics();
        const hpBar = this.add.graphics();
        const shieldText = this.add
          .text(0, -halfH - 25, '', {
            fontFamily: 'Inter, system-ui, sans-serif',
            fontSize: '13px',
            fontStyle: 'bold',
            color: '#facc15',
            stroke: '#000000',
            strokeThickness: 4,
          })
          .setOrigin(0.5).setVisible(false);

        const art = createStructureArt(this, o);
        container.add([art.root, shield, shieldText, hpBar]);
        visual = {
          container,
          art,
          shield,
          shieldText,
          hpBar,
          currentHp: o.hp,
          width: o.width,
          height: o.height,
        };
        this.dynamicObstacleVisuals.set(o.id, visual);
        if (!art.hasFortification) {
          container.setDepth(30 + Math.round(o.y + halfH));
          const age = serverTime === undefined ? Infinity : serverTime - o.createdAt;
          if (age >= 0 && age <= 1000) {
            this.playObstacleDeploy(visual);
          }
        }
      }

      // Phát hiện công trình ĐƯỢC CÔNG BINH SỬA CHỮA (+HP)
      if (visual.currentHp < o.hp) {
        const glow = this.add.ellipse(o.x, o.y + halfH * 0.72, o.width * 0.65, 24);
        glow.setStrokeStyle(3, 0x77f4ba, 0.8).setDepth(2);
        this.tweens.add({
          targets: glow, scale: 1.4, alpha: 0, duration: 340, onComplete: () => glow.destroy(),
        });
        for (let i = 0; i < 4; i++) {
          const healSpark = this.add.circle(
            o.x + Phaser.Math.Between(-halfW * 0.5, halfW * 0.5),
            o.y + Phaser.Math.Between(-halfH * 0.5, halfH * 0.5),
            4,
            0x22c55e,
            1,
          );
          this.tweens.add({
            targets: healSpark,
            y: healSpark.y - 28,
            alpha: 0,
            scale: 0.2,
            duration: 380,
            onComplete: () => healSpark.destroy(),
          });
        }
      }

      // Detect hit/damage to trigger flash & shake
      if (visual.currentHp > o.hp) {
        this.tweens.killTweensOf(visual.container);
        visual.container.setPosition(o.x, o.y);
        this.tweens.add({
          targets: visual.container,
          x: isPolice ? o.x - 5 : o.x + 5,
          yoyo: true,
          duration: 40,
          repeat: 1,
          onComplete: () => visual?.container.setPosition(o.x, o.y),
        });

        for (let i = 0; i < 4; i++) {
          const spark = this.add.circle(
            o.x + Phaser.Math.Between(-15, 15),
            o.y + Phaser.Math.Between(-halfH * 0.7, halfH * 0.7),
            3,
            isPolice ? 0x67e8f9 : 0xfca5a5,
            1,
          );
          this.tweens.add({
            targets: spark,
            x: spark.x + (isPolice ? -25 : 25) + Phaser.Math.Between(-10, 10),
            y: spark.y + Phaser.Math.Between(-20, 20),
            alpha: 0,
            scale: 0.2,
            duration: 250,
            onComplete: () => spark.destroy(),
          });
        }
      }

      visual.currentHp = o.hp;

      const hpRatio = Phaser.Math.Clamp(o.hp / Math.max(1, o.maxHp), 0, 1);
      visual.art.damage.setVisible(hpRatio <= 0.5);
      visual.hpBar.setVisible(visual.art.hasFortification || hpRatio < 1);
      visual.hpBar.clear();
      const barW = Math.min(138, o.width * 0.52);
      const barH = 5;
      const barY = visual.art.hasFortification ? -halfH - 12 : -halfH * 0.35 - 6;

      visual.hpBar.fillStyle(0x0f172a, 0.9);
      visual.hpBar.fillRoundedRect(-barW / 2, barY, barW, barH, 3);
      const healthyColor = o.faction ? (isPolice ? 0x82b7ce : 0xcf827c) : 0x8eae8e;
      visual.hpBar.fillStyle(hpRatio > 0.5 ? healthyColor : hpRatio > 0.25 ? 0xcda667 : 0xc46f67);
      visual.hpBar.fillRect(-barW / 2, barY, barW * hpRatio, barH);

      // Xử lý hiển thị Lá chắn 30s (Invulnerable Shield)
      const now = Date.now();
      const isShielded = o.isShielded || (o.shieldUntil ? now < o.shieldUntil : false);
      visual.shield.clear();

      if (isShielded && o.shieldUntil) {
        const secsLeft = Math.ceil(Math.max(0, o.shieldUntil - now) / 1000);
        visual.shieldText.setText(`🛡 ${secsLeft}s`).setVisible(true);
        visual.shield.fillStyle(0xc7b475, 0.12);
        visual.shield.fillEllipse(0, halfH, o.width * 1.08, 32);
        visual.shield.lineStyle(2, 0xe6c98a, 0.58);
        visual.shield.strokeEllipse(0, halfH, o.width * 1.08, 32);
      } else {
        visual.shieldText.setVisible(false);
      }
    }
  }

  private playObstacleDeploy(visual: ObstacleVisual) {
    const { art, container, height, width } = visual;
    const root = art.root;
    const { x, y } = container;
    root.setY(-30).setAlpha(0);
    this.tweens.add({
      targets: root, y: 0, alpha: 1, duration: 225, ease: 'Back.easeOut',
      onComplete: () => {
        const dust = this.add.ellipse(x, y + height / 2, width * 0.9, 11, 0x9a8870, 0.53)
          .setDepth(container.depth - 1);
        this.tweens.add({
          targets: dust, scaleX: 1.6, scaleY: 1.3, alpha: 0, duration: 380, ease: 'Quad.easeOut',
          onComplete: () => dust.destroy(),
        });
      },
    });
    root.once(Phaser.GameObjects.Events.DESTROY, () => this.tweens.killTweensOf(root));
  }

  private playObstacleDestroyedVfx(visual: ObstacleVisual) {
    const { container, art, shieldText, hpBar, height, width } = visual;
    shieldText.setVisible(false);
    hpBar.setVisible(false);

    const { x, y } = container;
    const groundY = y + height / 2;
    const inView = Phaser.Geom.Intersects.RectangleToRectangle(
      this.cameras.main.worldView,
      new Phaser.Geom.Rectangle(x - width / 2, y - height / 2, width, height),
    );
    if (!inView) {
      container.destroy();
      return;
    }
    this.tweens.killTweensOf(container);
    if (art.hasFortification) this.cameras.main.shake(230, 0.005);
    this.tweens.add({
      targets: container, y: y + height * 0.19, alpha: 0, duration: 430,
      ease: 'Quad.easeIn', onComplete: () => container.destroy(),
    });

    for (let index = 0; index < (art.hasFortification ? 13 : 6); index++) {
      const originX = x + Phaser.Math.Between(-width * 0.45, width * 0.45);
      const size = Phaser.Math.Between(7, 15);
      const shard = this.add.rectangle(originX, y + Phaser.Math.Between(-height * 0.3, height * 0.32),
        size, size * 0.58, index % 2 ? 0x65707a : 0x443937).setDepth(3);
      this.tweens.add({
        targets: shard, x: originX + Phaser.Math.Between(-54, 54), y: groundY,
        angle: Phaser.Math.Between(-110, 110), alpha: 0, duration: 290 + index * 16,
        ease: 'Quad.easeIn', onComplete: () => shard.destroy(),
      });
    }

    const dust = this.add.ellipse(x, groundY - 5, width * 0.88, 26, 0x8d8277, 0.44).setDepth(2);
    this.tweens.add({
      targets: dust, y: groundY - 18, scaleX: 1.4, scaleY: 2.6, alpha: 0,
      duration: 630, ease: 'Quad.easeOut', onComplete: () => dust.destroy(),
    });
  }

  public handleBombExploded(payload: BombExplodedPayload) {
    this.cameras.main.shake(350, 0.015);

    const wave = this.add.circle(payload.x, payload.y, 15, payload.faction === 'police' ? 0x38bdf8 : 0xef4444, 0.7);
    this.tweens.add({
      targets: wave,
      radius: payload.radius,
      alpha: 0,
      duration: 380,
      ease: 'Cubic.easeOut',
      onComplete: () => wave.destroy(),
    });

    const blast = this.add.circle(payload.x, payload.y, 25, 0xf97316, 0.85);
    this.tweens.add({
      targets: blast,
      radius: payload.radius * 0.75,
      alpha: 0,
      duration: 300,
      ease: 'Quad.easeOut',
      onComplete: () => blast.destroy(),
    });

    for (let i = 0; i < 8; i++) {
      const ang = (i * Math.PI) / 4;
      const spark = this.add.circle(payload.x, payload.y, 4, 0xfde047, 1);
      this.tweens.add({
        targets: spark,
        x: payload.x + Math.cos(ang) * (payload.radius * 0.85),
        y: payload.y + Math.sin(ang) * (payload.radius * 0.85),
        alpha: 0,
        scale: 0.2,
        duration: 360,
        onComplete: () => spark.destroy(),
      });
    }

    this.showFloatingText(payload.x, payload.y - 36, `−${payload.damage}`, '#f87171');
  }

  public applySnapshot(snapshot: BattleSnapshot) {
    if (snapshot.sessionId !== this.sessionId || snapshot.roundNumber !== this.roundNumber) {
      for (const fighter of this.fighters.values()) fighter.container.destroy();
      this.fighters.clear();
      for (const obs of this.dynamicObstacleVisuals.values()) obs.container.destroy();
      this.dynamicObstacleVisuals.clear();
      this.sessionId = snapshot.sessionId;
      this.roundNumber = snapshot.roundNumber;
    }
    this.syncClock(snapshot.timestamp, snapshot.tickRate);
    this.updateHostagesVisual(snapshot.hostages);
    this.updateCaptureZonesVisual(snapshot.captureZones);
    this.updateBombsVisual(snapshot.bombs);
    this.updateDynamicObstaclesVisual(snapshot.dynamicObstacles, snapshot.timestamp);
    this.terrainZones = snapshot.landscapeSlowZones ?? [];
    const terrainKey = JSON.stringify(this.terrainZones);
    if (terrainKey !== this.terrainKey) {
      this.terrainKey = terrainKey;
      this.terrainArt ??= this.add.graphics().setDepth(-11);
      drawTerrainHazards(this.terrainArt, this.terrainZones);
    }

    const incomingIds = new Set(snapshot.characters.filter((c) => c.status === 'alive').map((c) => c.id));
    for (const [id, fighter] of this.fighters.entries()) {
      if (!incomingIds.has(id)) {
        fighter.container.destroy();
        this.fighters.delete(id);
      }
    }

    for (const char of snapshot.characters) {
      if (char.status === 'alive') {
        this.upsertFighter(char, false, snapshot.timestamp);
      }
    }


  }

  public handleRoundResult(_payload: RoundResultPayload) {
    // Round ended
  }

  public handleCharacterSpawn(payload: CharacterSpawnPayload) {
    const isNew = !this.fighters.has(payload.character.id);
    const fighter = this.upsertFighter(payload.character, true, payload.timestamp);
    if (!isNew) return;

    if (payload.reason === 'join_faction' && !fighter.nameText.visible) {
      fighter.nameText.setVisible(true);
      this.tweens.add({
        targets: fighter.nameText, alpha: 0, delay: 1150, duration: 260,
        onComplete: () => fighter.nameText.setVisible(false),
      });
    }

    const color = fighter.faction === 'police' ? 0x6ee7ff : 0xff8695;
    const ring = this.add.ellipse(fighter.container.x, fighter.container.y + 3, 25, 12);
    ring.setStrokeStyle(2, color, 0.95).setDepth(fighter.container.depth - 1);
    this.tweens.add({
      targets: ring, scale: fighter.tier === 'mythic' ? 4 : 2.8, alpha: 0,
      duration: 450, ease: 'Cubic.easeOut', onComplete: () => ring.destroy(),
    });
  }

  public handleCharacterMove(payload: CharacterMovePayload) {
    this.syncClock(payload.timestamp, payload.tickRate);
    this.updateHostagesVisual(payload.hostages);
    this.updateCaptureZonesVisual(payload.captureZones);
    this.updateBombsVisual(payload.bombs);
    this.updateDynamicObstaclesVisual(payload.dynamicObstacles, payload.timestamp);
    const ids = new Set(payload.characters.map((item) => item.id));
    for (const [id, fighter] of this.fighters) {
      if (!ids.has(id)) {
        fighter.container.destroy();
        this.fighters.delete(id);
      }
    }
    for (const item of payload.characters) {
      const f = this.fighters.get(item.id);
      if (!f) continue;
      f.motion.push({ timestamp: payload.timestamp, x: item.x, y: item.y });
      f.facing = item.facing;
      f.animState = item.animState;
      f.hp = item.hp;
      this.updateHpBar(f);
    }


  }

  public handleCharacterAttack(payload: CharacterAttackPayload) {
    const fighter = this.fighters.get(payload.attackerId);
    if (!fighter || fighter.hp <= 0 || payload.timestamp <= fighter.lastAttackAt) return;
    fighter.lastAttackAt = payload.timestamp;

    const body = fighter.bodySprite;
    const style = fighter.attackStyle;
    const isRanged = style === 'arrow' || style === 'spell';
    const repairing = payload.action === 'repair';
    body.anims.timeScale = 1;
    body.play(fighter.textureKey + (isRanged ? '_cast' : '_attack'));

    const target = this.fighters.get(payload.targetId)?.container
      ?? this.dynamicObstacleVisuals.get(payload.targetId)?.container;
    const direction = target ? Math.sign(target.x - fighter.container.x) || 1 : fighter.facing === 'right' ? 1 : -1;
    this.tweens.killTweensOf(fighter.bodyContainer);
    fighter.bodyContainer.setScale(direction, 1);
    const recoil = repairing ? 2 : isRanged ? -5 : style === 'lance' ? 26 : style === 'heavy' ? 15 : 11;
    fighter.bodyContainer.setPosition(direction * recoil, 0).setAlpha(1);
    this.tweens.add({ targets: fighter.bodyContainer, x: 0, duration: 235, ease: 'Cubic.easeOut' });

    const x = fighter.container.x;
    const y = fighter.container.y - 24;

    if (repairing) {
      const hammerX = x + direction * 26;
      for (let index = 0; index < 5; index++) {
        const spark = this.add.rectangle(hammerX, y, 4, 4, index % 2 ? 0xffdb86 : 0x8dffd2)
          .setDepth(fighter.container.depth + 4).setAngle(45);
        this.tweens.add({
          targets: spark, x: hammerX + direction * (5 + index * 5), y: y - 22 + index * 8,
          alpha: 0, duration: 260, onComplete: () => spark.destroy(),
        });
      }
      return;
    }

    if (fighter.dragon && target) this.playDragonBreath(fighter, target, direction);

    const color = style === 'spell' ? 0xceabff : fighter.faction === 'police' ? 0x73eaff : 0xff9b9e;
    const effect = this.add.graphics({ x, y }).setDepth(fighter.container.depth + 3);
    if (isRanged && target) {
      const targetY = target.y - 20;
      const endX = target.x - x;
      const endY = targetY - y;
      effect.lineStyle(style === 'spell' ? 9 : 5, color, 0.24);
      effect.lineBetween(0, 0, endX, endY);
      effect.lineStyle(style === 'spell' ? 3 : 2, 0xfff1d6, 0.95);
      effect.lineBetween(0, 0, endX, endY);
      effect.fillStyle(color, 0.82);
      effect.fillCircle(endX, endY, style === 'spell' ? 10 : 4);
    } else if (style === 'heavy') {
      effect.y += 22;
      effect.lineStyle(3, color, 0.9);
      effect.strokeEllipse(direction * 16, 0, 76, 24);
      effect.lineStyle(1.5, 0xffedb8, 0.8);
      effect.strokeEllipse(direction * 16, 0, 51, 14);
    } else if (style === 'lance') {
      effect.setScale(direction, 1);
      effect.fillStyle(color, 0.56);
      effect.fillTriangle(14, 5, 77, -4, 28, 11);
      effect.lineStyle(3, 0xfff1d6, 0.95);
      effect.lineBetween(19, 5, 77, -4);
    } else {
      effect.setScale(direction, 1);
      effect.lineStyle(6, color, 0.85);
      effect.beginPath();
      effect.arc(16, 0, 28, -1.25, 1.1);
      effect.strokePath();
      effect.lineStyle(2, 0xfff1d6, 0.95);
      effect.beginPath();
      effect.arc(16, 0, 30, -0.96, 0.84);
      effect.strokePath();
    }
    this.tweens.add({ targets: effect, alpha: 0, duration: 190, ease: 'Quad.easeOut', onComplete: () => effect.destroy() });
  }

  private playDragonBreath(fighter: VisualFighter, target: Phaser.GameObjects.Container, direction: number) {
    const dragon = fighter.dragon;
    if (!dragon) return;
    dragon.root.setScale(direction, 1);
    const x = fighter.container.x + 41 * direction;
    const y = fighter.container.y + dragon.root.y - 14;
    const endX = Phaser.Math.Clamp(target.x - x, -210, 210);
    const endY = target.y - 18 - y;
    const color = fighter.faction === 'police' ? 0x6de6f8 : 0xff9054;
    for (let index = 0; index < 9; index++) {
      const spread = (index - 4) * 2.3;
      const flame = this.add.circle(x, y, 4 + index % 3, index % 3 ? color : 0xffebac, 0.82)
        .setDepth(fighter.container.depth + 2);
      this.tweens.add({
        targets: flame, x: x + endX + spread, y: y + endY - spread,
        delay: index * 12, duration: 260, scale: 1.7, alpha: 0,
        ease: 'Quad.easeOut', onComplete: () => flame.destroy(),
      });
    }
  }

  public handleCharacterDamage(payload: CharacterDamagePayload) {
    const fighter = this.fighters.get(payload.characterId);
    if (!fighter) return;
    fighter.hp = payload.remainingHp;
    fighter.maxHp = payload.maxHp;
    this.updateHpBar(fighter);

    // Kích hoạt đường đạn lính bắn tỉa / pháo thủ pháo đài bắn xuống gây sát thương
    const struct = this.dynamicObstacleVisuals.get(payload.attackerId);
    if (struct) {
      const startX = struct.container.x + struct.art.muzzleX;
      const startY = struct.container.y + struct.art.muzzleY;
      const targetX = fighter.container.x;
      const targetY = fighter.container.y - 18;
      this.fireSniperProjectile(startX, startY, targetX, targetY, struct.art.cannon ? 'cannon' : 'arrow', payload.damage);
    }

    // Several strikes can land in one server tick. Combine their visual flash
    // while keeping every HP update and leaving the attacker's pose intact.
    if (payload.timestamp - fighter.lastHitAt < 90) return;
    fighter.lastHitAt = payload.timestamp;
    const sprite = fighter.bodySprite;
    if (fighter.hp > 0 && !(sprite.anims.isPlaying && this.isFighterAction(sprite))) {
      sprite.anims.timeScale = 1;
      sprite.play(fighter.textureKey + '_hit');
    }
    fighter.flashUntil = this.time.now + 90;
    sprite.setTintFill(0xffd0be);

    const x = fighter.container.x;
    const y = fighter.container.y - 25;
    const spark = this.add.image(x, y, 'hit_spark').setDepth(fighter.container.depth + 4).setScale(0.45);
    this.tweens.add({ targets: spark, scale: 0.95, alpha: 0, duration: 165, ease: 'Quad.easeOut', onComplete: () => spark.destroy() });
    for (let index = 0; index < 3; index++) {
      const angle = index * Math.PI * 2 / 3 + payload.timestamp % 10;
      const ember = this.add.circle(x, y, 2, 0xffce80).setDepth(fighter.container.depth + 4);
      this.tweens.add({
        targets: ember, x: x + Math.cos(angle) * 25, y: y + Math.sin(angle) * 19,
        alpha: 0, duration: 175, onComplete: () => ember.destroy(),
      });
    }
  }

  private fireSniperProjectile(fromX: number, fromY: number, toX: number, toY: number, type: 'arrow' | 'cannon', damage: number) {
    const tex = type === 'cannon' ? 'projectile_cannonball' : 'projectile_arrow';
    const proj = this.add.image(fromX, fromY, tex).setDepth(200);
    const angle = Phaser.Math.Angle.Between(fromX, fromY, toX, toY);
    proj.setRotation(angle);
    if (type === 'cannon') {
      proj.setScale(1.25);
    } else {
      proj.setScale(1.15);
    }

    const dist = Phaser.Math.Distance.Between(fromX, fromY, toX, toY);
    const duration = Math.min(320, Math.max(140, dist * 0.45));

    this.tweens.add({
      targets: proj,
      x: toX,
      y: toY,
      duration,
      ease: 'Linear',
      onComplete: () => {
        proj.destroy();
        const spark = this.add.circle(toX, toY, 9, type === 'cannon' ? 0xf97316 : 0xfacc15, 0.9).setDepth(201);
        this.tweens.add({
          targets: spark,
          scale: 2.2,
          alpha: 0,
          duration: 180,
          onComplete: () => spark.destroy(),
        });
        this.showFloatingText(toX, toY - 18, `-${damage} ${type === 'cannon' ? '💣' : '🎯'}`, '#f97316');
      },
    });
  }

  public handleCharacterDeath(payload: CharacterDeathPayload) {
    const fighter = this.fighters.get(payload.characterId);
    if (!fighter) return;
    this.fighters.delete(payload.characterId);
    this.tweens.killTweensOf(fighter.bodyContainer);
    fighter.bodyContainer.x = 0;
    fighter.bodyContainer.y = 0;
    fighter.bodyContainer.setAlpha(1);
    fighter.bodySprite.anims.timeScale = 1;
    fighter.bodySprite.setY(0).clearTint().play(fighter.textureKey + '_die');
    fighter.gear?.setVisible(false);
    fighter.mount?.root.setVisible(false);
    if (fighter.dragon) {
      const dragon = fighter.dragon.root;
      this.tweens.add({ targets: dragon, y: dragon.y - 50, alpha: 0, duration: 330 });
    }
    fighter.nameText.setVisible(false);
    fighter.hpBarBg.setVisible(false);
    fighter.hpBarFill.setVisible(false);
    this.tweens.add({
      targets: fighter.container, alpha: 0, delay: 240, duration: 240,
      onComplete: () => fighter.container.destroy(),
    });
  }

  private isFighterAction(sprite: Phaser.GameObjects.Sprite) {
    return /_(attack|cast|hit|die)$/.test(sprite.anims.currentAnim?.key ?? '');
  }

  private upsertFighter(char: CharacterStateDto, animateSpawn: boolean, timestamp: number): VisualFighter {
    const existing = this.fighters.get(char.id);
    if (existing) {
      existing.motion.push({ timestamp, x: char.x, y: char.y });
      existing.facing = char.facing;
      existing.animState = char.animState;
      existing.hp = char.hp;
      existing.maxHp = char.maxHp;
      this.updateHpBar(existing);
      return existing;
    }


    const faction = char.faction;
    const tier = char.type;
    const unit = char.characterClass ?? 'warrior';
    const isBuilder = unit === 'builder';
    const textureKey = isBuilder
      ? (faction === 'police' ? 'builder_blue' : 'builder_red')
      : (faction === 'police' ? 'knight_blue' : 'knight_red');
    const color = faction === 'police' ? 0x69dcff : 0xff8d97;
    const heavy = unit === 'boss' || unit === 'giant' || unit === 'tank' || unit === 'defender';
    const attackStyle: VisualFighter['attackStyle'] = isBuilder ? 'repair'
      : unit === 'mage' ? 'spell'
      : unit === 'archer' || unit === 'gunner' ? 'arrow'
      : unit === 'cavalry' ? 'lance' : heavy ? 'heavy' : 'blade';
    const scale = tier === 'mythic' ? 1.55 : heavy ? 1.25 : tier === 'epic' ? 1.12 : 1;
    const container = this.add.container(char.x, char.y).setDepth(30 + Math.round(char.y));
    const shadow = this.add.ellipse(0, 3, 39 * scale, 12 * scale, 0x101e29, 0.64);
    shadow.setStrokeStyle(tier === 'mythic' ? 2 : 1, color, 0.62);
    const bodyContainer = this.add.container(0, 0).setScale(char.facing === 'right' ? 1 : -1, 1);
    const mount = unit === 'cavalry' ? createMount(this, color) : undefined;
    const dragon = unit === 'boss' ? createDragon(this, faction === 'police') : undefined;
    if (mount) bodyContainer.add(mount.root);
    const bodySprite = this.add.sprite(0, mount ? -22 : 0, textureKey).setOrigin(0.5, 0.92).setScale(scale);
    bodySprite.play({ key: textureKey + '_idle', startFrame: isBuilder ? 0 : char.id.length % 3 });
    bodyContainer.add(bodySprite);
    let gear: Phaser.GameObjects.Graphics | undefined;
    if ((!isBuilder && attackStyle !== 'blade') || tier === 'mythic') {
      gear = this.add.graphics({ y: mount ? -22 : 0 }).setScale(scale);
      if (attackStyle === 'arrow') {
        gear.lineStyle(2, 0xe5ad65);
        gear.beginPath();
        gear.arc(13, -21, 12, -1.25, 1.25);
        gear.strokePath();
        gear.lineStyle(1, 0xffedcd, 0.9);
        gear.lineBetween(17, -32, 17, -10);
      } else if (attackStyle === 'spell') {
        gear.lineStyle(3, 0xaa90bf);
        gear.lineBetween(18, -10, 24, -39);
        gear.fillStyle(0xd9b0ff);
        gear.fillCircle(24, -41, 5);
        gear.fillStyle(0xfff0ff);
        gear.fillCircle(23, -42, 2);
      } else if (attackStyle === 'lance') {
        gear.lineStyle(3, 0xeee3c2);
        gear.lineBetween(0, -14, 34, -26);
        gear.fillStyle(color);
        gear.fillTriangle(32, -30, 43, -30, 34, -22);
      } else if (heavy) {
        gear.fillStyle(0x1b2a3b);
        gear.fillRoundedRect(10, -30, 14, 22, 4);
        gear.lineStyle(2, color);
        gear.strokeRoundedRect(10, -30, 14, 22, 4);
        gear.lineBetween(17, -25, 17, -13);
      }
      if (tier === 'mythic') {
        gear.fillStyle(0xffd681);
        gear.fillTriangle(-12, -43, -13, -53, -5, -44);
        gear.fillTriangle(8, -44, 15, -53, 14, -43);
      }
      bodyContainer.add(gear);
    }
    container.add(shadow);
    if (dragon) container.add(dragon.root);
    container.add(bodyContainer);

    const barWidth = tier === 'mythic' ? 52 : 34;
    const barY = -53 * scale - (mount ? 22 : 0);
    const hpBarBg = this.add.rectangle(0, barY, barWidth + 2, 5, 0x101823, 0.9);
    const hpBarFill = this.add.rectangle(-barWidth / 2, barY, barWidth, 3, color).setOrigin(0, 0.5);
    const name = Array.from(char.username.replace(/^@/, ''));
    const badge = isBuilder ? '🔨 ' : unit === 'boss' ? '👑 ' : unit === 'giant' ? '🗿 ' : '';
    const nameText = this.add.text(0, barY - 11, badge + (name.length > 17 ? name.slice(0, 16).join('') + '…' : name.join('')), {
      fontFamily: 'system-ui, sans-serif', fontSize: '12px', color: '#edf5ff',
      stroke: '#101923', strokeThickness: 3,
    }).setOrigin(0.5);
    nameText.setVisible(tier !== 'normal' || isBuilder);
    container.add([hpBarBg, hpBarFill, nameText]);

    if (animateSpawn) {
      bodyContainer.y = -15;
      bodyContainer.alpha = 0.35;
      this.tweens.add({
        targets: bodyContainer, y: 0, alpha: 1, duration: 250, ease: 'Cubic.easeOut',
      });
    }

    const motion = new MotionTimeline();
    motion.push({ timestamp, x: char.x, y: char.y });
    const fighter: VisualFighter = {
      container, bodyContainer, bodySprite, gear, mount, dragon, hpBarBg, hpBarFill, nameText,
      motion, maxHp: char.maxHp, hp: char.hp, faction, tier, textureKey, attackStyle,
      facing: char.facing, animState: char.animState,
      lastAttackAt: -Infinity, lastHitAt: -Infinity, flashUntil: 0, stride: 0, gait: 0,
    };

    this.updateHpBar(fighter);
    this.fighters.set(char.id, fighter);
    return fighter;
  }

  private updateHpBar(f: VisualFighter) {
    const ratio = Phaser.Math.Clamp(f.hp / Math.max(1, f.maxHp), 0, 1);
    f.hpBarBg.setVisible(ratio < 1 || f.tier !== 'normal');
    f.hpBarFill.setVisible(f.hpBarBg.visible).setScale(ratio, 1);
    f.hpBarFill.fillColor =
      f.faction === 'police'
        ? ratio > 0.35
          ? 0x38bdf8
          : 0xef4444
        : ratio > 0.35
          ? 0xf87171
          : 0xfacc15;
  }

  private showFloatingText(x: number, y: number, message: string, color: string) {
    let txt = this.floatingTexts.pop();
    if (!txt) {
      txt = this.add
        .text(x, y, message, {
          fontFamily: 'Inter, system-ui, sans-serif',
          fontSize: '15px',
          fontStyle: 'bold',
          color,
          stroke: '#000000',
          strokeThickness: 4,
        })
        .setOrigin(0.5);
    } else {
      txt.setPosition(x, y);
      txt.setText(message);
      txt.setColor(color);
      txt.setAlpha(1);
      txt.setVisible(true);
    }

    this.tweens.add({
      targets: txt,
      y: y - 38,
      alpha: 0,
      duration: 800,
      onComplete: () => {
        if (txt) {
          txt.setVisible(false);
          this.floatingTexts.push(txt);
        }
      },
    });
  }

  update(_time: number, delta: number) {
    const renderTime = this.serverTimestamp + performance.now() - this.receivedAt - this.interpolationDelay;

    for (const fighter of this.fighters.values()) {
      const position = fighter.motion.at(renderTime);
      let distance = 0;
      if (position) {
        distance = Phaser.Math.Distance.Between(fighter.container.x, fighter.container.y, position.x, position.y);
        fighter.container.setPosition(position.x, position.y);
        const depth = 30 + Math.round(position.y);
        if (fighter.container.depth !== depth) fighter.container.setDepth(depth);
      }

      const sprite = fighter.bodySprite;
      if (fighter.flashUntil && this.time.now >= fighter.flashUntil) {
        sprite.clearTint();
        fighter.flashUntil = 0;
      }
      const moving = fighter.animState === 'run' && distance > 0.035;
      if (moving) fighter.gait = (fighter.gait + distance * 0.17) % (Math.PI * 2);
      const stride = moving ? Math.sin(fighter.gait) : 0;
      if (fighter.mount) {
        fighter.mount.legs.forEach((leg, index) => leg.setAngle(stride * (index % 2 ? -29 : 29)));
      }
      const bodyY = fighter.mount ? -22 - Math.abs(stride) * 4 : -Math.abs(stride) * 2;
      fighter.bodySprite.y = bodyY;
      if (fighter.gear) fighter.gear.y = bodyY;
      if (fighter.dragon) {
        const { root, nearWing, farWing } = fighter.dragon;
        const flap = Math.sin(_time / 96 + fighter.container.x / 120);
        root.y = -111 + flap * 6;
        root.scaleX = fighter.facing === 'right' ? 1 : -1;
        nearWing.setAngle(flap * 32);
        farWing.setAngle(-flap * 25);
      }
      if (fighter.hp <= 0 || (sprite.anims.isPlaying && this.isFighterAction(sprite))) continue;
      fighter.bodyContainer.setScale(fighter.facing === 'right' ? 1 : -1, 1);
      const { x, y, depth } = fighter.container;
      const zone = moving ? this.terrainZones.find((candidate) =>
        Math.abs(x - candidate.x) <= candidate.width / 2 && Math.abs(y - candidate.y) <= candidate.height / 2,
      ) : undefined;
      sprite.anims.timeScale = zone ? Math.max(0.55, zone.slowFactor) : 1;
      sprite.play(fighter.textureKey + (moving ? '_walk' : '_idle'), true);

      if (moving) {
        const enteredZone = zone && zone.id !== fighter.terrainId;
        fighter.terrainId = zone?.id;
        const stepLength = zone ? 34 : 56;
        fighter.stride += distance;
        if (enteredZone || fighter.stride >= stepLength) {
          fighter.stride = enteredZone ? 0 : fighter.stride % stepLength;
          if (!this.cameras.main.worldView.contains(x, y)) continue;
          if (zone) {
            playTerrainStep(this, zone.kind, x, y, depth, fighter.facing === 'right' ? 1 : -1);
            continue;
          }
          const dust = this.add.image(x, y + 2, 'dust_cloud');
          dust.setDepth(depth - 1).setScale(0.32).setAlpha(0.5);
          this.tweens.add({ targets: dust, scale: 0.55, alpha: 0, duration: 240, onComplete: () => dust.destroy() });
        }
      }
    }

    // -------------------------------------------------------------
    // CAMERA CUỘN NGANG THEO QUÂN LÍNH VÀ ZOOM ĐỘNG (HORIZONTAL & ZOOM)
    // -------------------------------------------------------------
    const aliveFighters = Array.from(this.fighters.values()).filter((f) => f.hp > 0);
    const now = performance.now();

    // Nếu người dùng không tự kéo camera trong 3s, tự động kích hoạt tracking & dynamic zoom
    if (now - this.lastUserInteractTime > 3000) {
      let focalX = 3200;
      let minX = 6400;
      let maxX = 0;

      if (aliveFighters.length > 0) {
        let sumX = 0;
        for (const f of aliveFighters) {
          sumX += f.container.x;
          if (f.container.x < minX) minX = f.container.x;
          if (f.container.x > maxX) maxX = f.container.x;
        }
        focalX = sumX / aliveFighters.length;

        // Dynamic Zoom: Khi lính 2 bên ở xa nhau (>1400px), thu nhỏ góc nhìn để theo dõi được cả 2 bên lính
        // Khi lính áp sát chém nhau gần (<600px), phóng to góc nhìn cận cảnh
        const spread = maxX - minX;
        if (spread > 1500) {
          this.targetZoom = 0.72;
        } else if (spread > 900) {
          this.targetZoom = 0.85;
        } else {
          this.targetZoom = 1.05;
        }
      } else {
        this.targetZoom = 0.95;
      }

      const targetScrollX = Phaser.Math.Clamp(focalX - 960, 0, this.worldWidth - 1920);
      this.cameras.main.scrollX = Phaser.Math.Linear(this.cameras.main.scrollX, targetScrollX, 0.04);
      this.cameras.main.zoom = Phaser.Math.Linear(this.cameras.main.zoom, this.targetZoom, 0.025);
    }

    // Cập nhật Minimap
    this.drawMinimap(aliveFighters);
  }
}
