"""
Optional - Pull REAL live SNCF data (to ground / validate the synthetic set).

The GTFS-RT Service Alerts + Trip Updates feeds are free and need no token
(see config). The richer SNCF/Navitia API (/disruptions) needs a free token.
Reminder: these feeds tell you THAT a train is disrupted, rarely a clean cause,
and almost never a how-long -> which is exactly why we simulate.
"""
from __future__ import annotations

import config


def fetch_service_alerts() -> bytes:
    """GET the GTFS-RT Service Alerts protobuf feed (active disruptions)."""
    # TODO: requests.get(config.GTFS_RT_SERVICE_ALERTS).content
    raise NotImplementedError


def parse_alerts(raw: bytes) -> list[dict]:
    """Parse the protobuf into simple dicts (needs gtfs-realtime-bindings)."""
    # TODO: use google.transit.gtfs_realtime_pb2 to decode.
    raise NotImplementedError


if __name__ == "__main__":
    raise NotImplementedError
