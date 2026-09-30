// 本地玩家的移动与碰撞（圆柱近似为方形，与地图中的轴对齐盒子碰撞）
import * as THREE from 'three';

export const R = 0.2, H = 1.15, CROUCH_H = 0.6, STEP = 0.52;
const GRAVITY = 22, JUMP = 6.4;

export class Controller {
  constructor() {
    this.pos = new THREE.Vector3();
    this.vel = new THREE.Vector3();
    this.yaw = 0;      // 相机朝向
    this.pitch = 0;
    this.bodyYaw = 0;  // 角色朝向
    this.grounded = false;
    this.moving = false;
    this.crouch = false;
    this.h = H;
  }

  // 蹲下时碰撞体变矮，可以钻到桌子底下；起身前检查头顶有没有东西
  setCrouch(want, world) {
    if (want) { this.crouch = true; this.h = CROUCH_H; return; }
    if (!this.crouch) return;
    const p = this.pos;
    const saved = this.h;
    this.h = H;
    if (world.colliders.some(b => this.overlaps(b, p.x, p.y + 0.01, p.z))) { this.h = saved; return; }
    this.crouch = false;
  }

  teleport(x, y, z, yaw = 0) {
    this.pos.set(x, y, z);
    this.vel.set(0, 0, 0);
    this.yaw = yaw; this.bodyYaw = yaw; this.pitch = 0;
  }

  overlaps(b, px, py, pz) {
    return px + R > b.min[0] && px - R < b.max[0] &&
      pz + R > b.min[2] && pz - R < b.max[2] &&
      py + this.h > b.min[1] && py < b.max[1];
  }

  // input: {f, b, l, r, jump, sprint, down}
  update(dt, input, world, opts) {
    const { speed = 5, fly = false, frozen = false } = opts;
    const fx = -Math.sin(this.yaw), fz = -Math.cos(this.yaw);
    const rx = Math.cos(this.yaw), rz = -Math.sin(this.yaw);
    let mx = 0, mz = 0;
    if (!frozen) {
      if (input.f) { mx += fx; mz += fz; }
      if (input.b) { mx -= fx; mz -= fz; }
      if (input.r) { mx += rx; mz += rz; }
      if (input.l) { mx -= rx; mz -= rz; }
    }
    const len = Math.hypot(mx, mz);
    this.moving = len > 0;
    const sp = speed * (this.crouch ? 0.5 : input.sprint ? 1.55 : 1);
    if (len > 0) { mx = mx / len * sp; mz = mz / len * sp; }

    if (fly) {
      let my = 0;
      if (!frozen) {
        if (input.jump) my += 1;
        if (input.down) my -= 1;
        // 沿视线方向飞行
        mx *= 1.6; mz *= 1.6;
        if (input.f || input.b) my += Math.sin(this.pitch) * (input.f ? 1 : -1) * 1.2;
      }
      this.pos.x += mx * dt; this.pos.z += mz * dt;
      this.pos.y = Math.max(0.2, Math.min(30, this.pos.y + my * sp * dt));
      this.vel.set(0, 0, 0);
      return;
    }

    // 水平加速度（有一点惯性）
    const k = 1 - Math.exp(-dt * (this.grounded ? 16 : 5));
    this.vel.x += (mx - this.vel.x) * k;
    this.vel.z += (mz - this.vel.z) * k;
    if (this.moving) {
      const target = Math.atan2(-mx, -mz);
      let d = target - this.bodyYaw;
      d = Math.atan2(Math.sin(d), Math.cos(d));
      this.bodyYaw += d * Math.min(1, dt * 12);
    }

    if (input.jump && this.grounded && !frozen) { this.vel.y = JUMP; this.grounded = false; }
    this.vel.y -= GRAVITY * dt;

    const cols = world.colliders;
    // 分轴移动，分步避免穿墙
    const steps = Math.max(1, Math.ceil(Math.max(Math.abs(this.vel.x), Math.abs(this.vel.z), Math.abs(this.vel.y)) * dt / 0.2));
    const sdt = dt / steps;
    for (let s = 0; s < steps; s++) {
      this.moveAxis(0, this.vel.x * sdt, cols);
      this.moveAxis(2, this.vel.z * sdt, cols);
      this.moveVertical(this.vel.y * sdt, cols);
    }
    // 地图边界
    const [x0, z0, x1, z1] = world.bounds;
    this.pos.x = Math.max(x0 + R, Math.min(x1 - R, this.pos.x));
    this.pos.z = Math.max(z0 + R, Math.min(z1 - R, this.pos.z));
  }

  moveAxis(axis, delta, cols) {
    if (!delta) return;
    const p = this.pos;
    if (axis === 0) p.x += delta; else p.z += delta;
    for (const b of cols) {
      if (!this.overlaps(b, p.x, p.y, p.z)) continue;
      if (b.max[1] - p.y <= STEP && b.max[1] - b.min[1] > 0.001) {
        // 可以直接走上去的矮台阶：检查头顶是否有空间
        const ny = b.max[1];
        if (!cols.some(c => c !== b && this.overlaps(c, p.x, ny + 0.01, p.z) && c.min[1] > p.y)) { p.y = ny; continue; }
      }
      if (axis === 0) p.x = delta > 0 ? b.min[0] - R - 1e-4 : b.max[0] + R + 1e-4;
      else p.z = delta > 0 ? b.min[2] - R - 1e-4 : b.max[2] + R + 1e-4;
    }
  }

  moveVertical(delta, cols) {
    const p = this.pos;
    const prevY = p.y;
    p.y += delta;
    this.grounded = false;
    for (const b of cols) {
      if (!this.overlaps(b, p.x, p.y, p.z)) continue;
      if (delta > 0 && prevY + this.h <= b.min[1] + 0.02) {
        p.y = b.min[1] - this.h - 1e-4; this.vel.y = 0;
      } else if (prevY >= b.max[1] - STEP) {
        p.y = b.max[1]; if (this.vel.y < 0) this.vel.y = 0; this.grounded = true;
      }
    }
    if (p.y <= 0) { p.y = 0; if (this.vel.y < 0) this.vel.y = 0; this.grounded = true; }
  }
}
