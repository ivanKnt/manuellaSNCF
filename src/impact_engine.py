"""
Phase 2 - Journey impact engine.

Turns a predicted resolution range into what the PASSENGER cares about:
    - new arrival time range
    - probability of making a connection
    - cascade delays for trains queued behind the incident

Simplification (documented): we treat the incident's resolution time as the
delay added to the passenger's arrival.
"""
from __future__ import annotations

from datetime import datetime, timedelta


def _knots(r: dict) -> list[tuple[float, float]]:
    """Points of the delay curve: (minutes, share of outcomes below it).
    10% fall below `low`, 50% below `median`, 90% below `high`, plus short
    tails to 0% and 100%. Straight lines connect the points."""
    lo, md, hi = r["low"], r["median"], r["high"]
    return [
        (max(0.0, lo - 0.25 * (md - lo)), 0.0),
        (lo, 0.1),
        (md, 0.5),
        (hi, 0.9),
        (hi + 0.25 * (hi - md), 1.0),
    ]


def prob_delay_at_most(minutes: float, r: dict) -> float:
    """P(delay <= minutes): read the delay curve at `minutes`."""
    knots = _knots(r)
    if minutes <= knots[0][0]:
        return 0.0
    if minutes >= knots[-1][0]:
        return 1.0
    for (x0, y0), (x1, y1) in zip(knots, knots[1:]):
        if x0 <= minutes <= x1:
            return y1 if x1 == x0 else y0 + (y1 - y0) * (minutes - x0) / (x1 - x0)
    return 1.0


def delay_quantile(p: float, r: dict) -> float:
    """The reverse question: how many minutes until a share `p` of outcomes is done?"""
    p = min(max(p, 0.0), 1.0)
    knots = _knots(r)
    for (x0, y0), (x1, y1) in zip(knots, knots[1:]):
        if y0 <= p <= y1:
            return x1 if y1 == y0 else x0 + (x1 - x0) * (p - y0) / (y1 - y0)
    return knots[-1][0]


def remaining_range(r: dict, elapsed: float) -> dict:
    """Updated estimate of the minutes LEFT, once `elapsed` minutes have passed.

    If the incident is still not cleared after `elapsed` minutes, every outcome
    shorter than that is ruled out. We keep only the rest of the curve and
    re-read its 10% / 50% / 90% points. `overrun` means the incident has outlasted
    almost everything the model considered plausible.
    """
    done = prob_delay_at_most(elapsed, r)
    still_possible = 1.0 - done
    if still_possible < 0.02:
        return {"low": 10, "median": 20, "high": 45, "overrun": True}
    out = {}
    for key, p in (("low", 0.1), ("median", 0.5), ("high", 0.9)):
        total = delay_quantile(done + p * still_possible, r)
        out[key] = max(1, round(total - elapsed))
    out["overrun"] = False
    return out


def new_arrival_range(scheduled_arrival: datetime, r: dict) -> dict:
    """Shift the scheduled arrival by the predicted delay range."""
    return {
        "earliest": scheduled_arrival + timedelta(minutes=r["low"]),
        "expected": scheduled_arrival + timedelta(minutes=r["median"]),
        "latest": scheduled_arrival + timedelta(minutes=r["high"]),
    }


def connection_probability(scheduled_arrival: datetime, r: dict,
                           connection_departure: datetime, walk_minutes: int) -> float:
    """P(passenger reaches the connecting train in time)."""
    slack = (connection_departure - scheduled_arrival).total_seconds() / 60 - walk_minutes
    return prob_delay_at_most(slack, r)


def cascade_delays(primary_delay: int, tracks_blocked: str, time_of_day: str) -> list[int]:
    """Expected delays for trains queued behind the incident (deterministic
    version of the decay logic used in generate_data.cascade_rows)."""
    followers = {"rush_am": 4, "rush_pm": 5, "midday": 2, "evening": 1, "night": 0}[time_of_day]
    blocked_hard = tracks_blocked in ("both", "sector")
    if blocked_hard:
        followers += 2
    decay = 0.55 if blocked_hard else 0.45
    delays, delay = [], primary_delay
    for _ in range(followers):
        delay = round(delay * decay)
        if delay < 5:
            break
        delays.append(delay)
    return delays


if __name__ == "__main__":
    r = {"low": 57, "median": 84, "high": 149}       # animal, single track, storm
    arrival = datetime(2026, 3, 2, 14, 0)
    rng = new_arrival_range(arrival, r)
    print("New arrival:", rng["earliest"].strftime("%H:%M"), "-", rng["latest"].strftime("%H:%M"),
          f"(likely {rng['expected'].strftime('%H:%M')})")
    for dep in ("15:10", "15:45", "16:45"):
        h, m = map(int, dep.split(":"))
        p = connection_probability(arrival, r, datetime(2026, 3, 2, h, m), walk_minutes=5)
        print(f"Connection at {dep}: {p:.0%} chance")
    print("Cascade behind it:", cascade_delays(84, "one", "rush_pm"))
