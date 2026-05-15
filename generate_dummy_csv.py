"""
Generate a 20-minute dummy EdgeTX telemetry CSV for testing MT12TelemetryAPP.

Format matches real MT12 logs:
  - timestamp: tick in units of 10 ms (10 ticks = 100 ms = 10 Hz)
  - ch1: steering   -100..+100 %
  - ch2: throttle   -100..+100 %  (negative = brake/reverse)
  - ch3: aux1 (e.g. gear / mode switch)  -100 | 0 | +100
  - ch4: aux2 (e.g. brake bias)  continuous -100..+100

Usage:
  python generate_dummy_csv.py [output_path]

Default output: dummy_telemetry_20min.csv
"""

import math
import os
import random
import sys

SAMPLE_HZ = 10          # samples per second
DURATION_S = 20 * 60   # 20 minutes
N_SAMPLES  = DURATION_S * SAMPLE_HZ   # 12 000 samples

TICK_START = 10000      # arbitrary starting tick (matches real log style)
TICK_STEP  = 10         # 10 units × 10 ms/unit = 100 ms per sample

OUT_FILE = sys.argv[1] if len(sys.argv) > 1 else "dummy_telemetry_20min.csv"


def clamp(v: float, lo: float = -100.0, hi: float = 100.0) -> float:
    return max(lo, min(hi, v))


def snap(v: float) -> int:
    """Round to integer, matching real log output."""
    return int(round(v))


# ── Behavioural model ──────────────────────────────────────────────────────────
# The session is split into laps.  Each lap has phases:
#   STRAIGHT → BRAKE_CORNER → CORNER → POWER_EXIT → STRAIGHT ...
# ch1 (steering) drives the corner shape.
# ch2 (throttle) follows: full throttle on straights, trail-brakes, applies power.
# ch3 flips at predetermined moments (gear / mode switch).
# ch4 drifts slowly (brake bias knob).

random.seed(42)

LAP_S_MIN, LAP_S_MAX = 60, 90  # lap length in seconds


def make_laps(total_s: int) -> list[dict]:
    """Return a list of lap descriptors covering total_s seconds."""
    laps = []
    elapsed = 0
    while elapsed < total_s:
        lap_s = random.randint(LAP_S_MIN, LAP_S_MAX)
        laps.append({
            "start": elapsed,
            "duration": lap_s,
            "direction": random.choice([-1, 1]),   # first corner direction
            "corner_sharpness": random.uniform(0.5, 1.0),
        })
        elapsed += lap_s
    return laps


def phase_for_t(t_s: float, laps: list[dict]) -> tuple[str, dict]:
    """Return the lap phase and lap descriptor at time t_s."""
    for lap in reversed(laps):
        if t_s >= lap["start"]:
            rel = (t_s - lap["start"]) / lap["duration"]
            if rel < 0.30:
                return "straight", lap
            elif rel < 0.42:
                return "braking", lap
            elif rel < 0.60:
                return "corner", lap
            elif rel < 0.70:
                return "exit", lap
            else:
                return "straight", lap
    return "straight", laps[0]


def steering_target(phase: str, lap: dict, t_s: float) -> float:
    direction = lap["direction"]
    sharpness  = lap["corner_sharpness"]
    if phase == "straight":
        # small wobble on the straight
        return random.gauss(0, 3)
    elif phase == "braking":
        # slight steering while braking
        return direction * 15 * sharpness
    elif phase == "corner":
        return direction * 80 * sharpness + random.gauss(0, 4)
    elif phase == "exit":
        # unwinding
        return direction * 30 * sharpness
    return 0.0


def throttle_target(phase: str) -> float:
    if phase == "straight":
        return random.gauss(95, 4)
    elif phase == "braking":
        return random.gauss(-70, 8)   # negative = brake
    elif phase == "corner":
        return random.gauss(20, 10)
    elif phase == "exit":
        return random.gauss(70, 8)
    return 0.0


def ch3_value(t_s: float) -> int:
    """Mode switch: changes every ~2 minutes."""
    slot = int(t_s // 120) % 3
    return [-100, 0, 100][slot]


def ch4_value(t_s: float) -> float:
    """Brake bias: slow sinusoidal drift."""
    return 40 * math.sin(2 * math.pi * t_s / 480) + random.gauss(0, 2)


# ── Generate samples ───────────────────────────────────────────────────────────

laps = make_laps(DURATION_S)

rows: list[str] = []
rows.append("timestamp,ch1,ch2,ch3,ch4")

steer  = 0.0
throttle = 90.0
STEER_SLEW    = 0.35   # max change per sample (% per sample at 10 Hz)
THROTTLE_SLEW = 0.55

for i in range(N_SAMPLES):
    t_s    = i / SAMPLE_HZ
    tick   = TICK_START + i * TICK_STEP
    phase, lap = phase_for_t(t_s, laps)

    # Slew-rate-limited channels (realistic servo speed)
    steer_tgt    = clamp(steering_target(phase, lap, t_s))
    throttle_tgt = clamp(throttle_target(phase))

    steer_delta    = clamp(steer_tgt    - steer,    -STEER_SLEW    * 100, STEER_SLEW    * 100)
    throttle_delta = clamp(throttle_tgt - throttle, -THROTTLE_SLEW * 100, THROTTLE_SLEW * 100)

    steer    = clamp(steer    + steer_delta)
    throttle = clamp(throttle + throttle_delta)

    rows.append(
        f"{tick},{snap(steer)},{snap(throttle)},{ch3_value(t_s)},{snap(ch4_value(t_s))}"
    )

# ── Write file ─────────────────────────────────────────────────────────────────

out_path = os.path.abspath(OUT_FILE)
with open(out_path, "w", newline="\n", encoding="utf-8") as f:
    f.write("\n".join(rows) + "\n")

size_kb = os.path.getsize(out_path) / 1024
print(f"Written {N_SAMPLES:,} samples ({DURATION_S // 60} min) -> {out_path}")
print(f"File size: {size_kb:.1f} KB")
