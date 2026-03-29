# Spacehacker

A 2D gravity-assist strategy game. Pilot a spacecraft through procedurally generated solar systems, use the gravity wells of planets to slingshot yourself toward your objective, and try not to become debris.

Each run generates a fresh map. Difficulty tiers unlock as you complete runs. No install required.

---

## Getting Started

Open `index.html` in any modern browser. That's it.

---

## Controls

### Flight

| Key | Action |
|-----|--------|
| `W` / `↑` | Main thrust (forward) |
| `S` / `↓` | Retro burn (backward) |
| `A` / `←` / `D` / `→` | Rotate ship |
| `Shift` | Boost — 2× thrust, burns fuel faster |
| `Space` | Fire laser (destroys asteroids and comets; costs fuel) |

### Navigation & UI

| Key | Action |
|-----|--------|
| `-` / `=` | Zoom out / Zoom in |
| `M` | Toggle minimap |
| `` ` `` (backtick) | Toggle cheat mode |
| `R` | Restart run |
| `Enter` | Start / new mission |
| `ESC` | Pause / back to menu |

---

## Objectives

Objectives unlock by tier as you complete more runs.

| Objective | What you do |
|-----------|-------------|
| **Reach Station** | Fly to the marked location |
| **Collect Resource Pod** | Same, but the target is smaller |
| **Mine Asteroid** | Hover near a moving asteroid for 3 seconds |
| **Slingshot** | Pass close to 1–2 planets for a gravity assist |
| **Establish Orbit** | Maintain orbital speed around a planet for 5 seconds |

Completing an objective rewards bonus fuel.

---

## Hazards

**Collision** — Flying into a planet, moon, or the star ends the run immediately.

**Comets** — Fast-moving projectiles. Roughly 70% are aimed in your general direction; the remaining 30% follow fixed crossing paths. The laser handles both.

**Fuel** — When fuel hits zero, you have 30 seconds of unpowered drift to reach your objective. After that, the run ends.

---

## Tips

Gravity is the point of the game, not just an obstacle. Learn to read it and use it intentionally — a well-timed gravity assist can save more fuel than a direct burn.

**Cheat mode** (backtick) is your best learning tool. It overlays a trajectory preview and sphere-of-influence circles so you can see exactly how gravity will bend your path before you commit. Fixed-path comets also display a faint dotted line in this mode.

---

## About

Spacehacker is a pure HTML5 game. No frameworks, no server, no install. Just open `index.html` and fly.
