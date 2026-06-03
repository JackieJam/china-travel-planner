#!/usr/bin/env python3
"""
Generate comprehensive train service (车次) data from railway line data.

Reads:  data/hsr.json
Writes: data/trains.json

Usage:  python3 tools/generate_trains.py
"""

import json
import math
import os
import sys

# ---------------------------------------------------------------------------
# Path setup (allow running from project root or tools/)
# ---------------------------------------------------------------------------
SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
PROJECT_ROOT = os.path.dirname(SCRIPT_DIR)
DATA_DIR = os.path.join(PROJECT_ROOT, "data")
INPUT_FILE = os.path.join(DATA_DIR, "hsr.json")
OUTPUT_FILE = os.path.join(DATA_DIR, "trains.json")

# ---------------------------------------------------------------------------
# Haversine distance
# ---------------------------------------------------------------------------

def haversine(coord1, coord2):
    """Distance in km between two [lon, lat] points using Haversine formula."""
    lon1 = math.radians(coord1[0])
    lat1 = math.radians(coord1[1])
    lon2 = math.radians(coord2[0])
    lat2 = math.radians(coord2[1])
    dlat = lat2 - lat1
    dlon = lon2 - lon1
    a = math.sin(dlat / 2) ** 2 + math.cos(lat1) * math.cos(lat2) * math.sin(dlon / 2) ** 2
    return 6371 * 2 * math.asin(math.sqrt(a))


# ---------------------------------------------------------------------------
# Time helpers
# ---------------------------------------------------------------------------

def fmt(minutes):
    """Format minutes-since-midnight as HH:MM string."""
    h = int(minutes) // 60
    m = int(minutes) % 60
    return f"{h:02d}:{m:02d}"


def add_time(hhmm, delta):
    """Add *delta* minutes (may be negative) to an HH:MM string, return HH:MM."""
    parts = hhmm.split(":")
    total = int(parts[0]) * 60 + int(parts[1]) + delta
    total = max(0, total)
    return fmt(total)


def round2(minutes):
    """Round to nearest 2-minute mark for realistic timetables."""
    return int(round(minutes / 2.0)) * 2


# ---------------------------------------------------------------------------
# Line classification
# ---------------------------------------------------------------------------

TRUNK_KW = ["京沪", "京广", "京哈", "沪昆", "沿海", "杭深", "兰新", "青银"]
INTERCITY_KW = ["城际", "S2", "金山"]


def classify(name):
    """
    Return (line_type, train_prefix, service_count_range, avg_speed_kmh).

    line_type: trunk | regional | intercity | fast
    """
    for kw in INTERCITY_KW:
        if kw in name:
            return "intercity", "C", (8, 15), 160.0
    for kw in TRUNK_KW:
        if kw in name:
            return "trunk", "G", (12, 20), 280.0
    if "高铁" in name:
        return "regional", "G", (6, 12), 250.0
    # Everything else: fast rail / regular rail
    return "fast", "D", (3, 6), 180.0


# ---------------------------------------------------------------------------
# Service-count heuristics (tune per line type + station count)
# ---------------------------------------------------------------------------

def service_count(line_type, n_stations):
    """How many services per direction per day."""
    if line_type == "trunk":
        return 15 if n_stations > 15 else 12
    if line_type == "regional":
        if n_stations > 20:
            return 10
        if n_stations > 10:
            return 8
        return 6
    if line_type == "intercity":
        return 12 if n_stations > 10 else 8
    # fast
    return 4 if n_stations > 8 else 3


# ---------------------------------------------------------------------------
# Departure-time generation
# ---------------------------------------------------------------------------

def departures(n, start=360, end=1290):
    """
    Return *n* evenly-spaced departure times (minutes since midnight)
    between *start* and *end* (default 06:00 – 21:30), snapped to 5-min marks.
    """
    if n <= 1:
        return [start]
    step = (end - start) / (n - 1)
    return [round((start + i * step) / 5) * 5 for i in range(n)]


# ---------------------------------------------------------------------------
# Segment distances
# ---------------------------------------------------------------------------

def seg_distances(stations):
    """Haversine distance (km) between each pair of adjacent stations."""
    return [haversine(stations[i]["center"], stations[i + 1]["center"])
            for i in range(len(stations) - 1)]


# ---------------------------------------------------------------------------
# Schedule builder
# ---------------------------------------------------------------------------

def build_route(stations, start_min, speed, stop_min=2, skip=None):
    """
    Build a list of station-dicts with arrive/depart times.

    *skip*: set of station **indices** to skip (express service).
            Skipped stations get arrive="" and depart="".
            Travel time across skipped segments is correctly accumulated.
    """
    dists = seg_distances(stations)
    n = len(stations)
    if skip is None:
        skip = set()

    route = []
    cur = float(start_min)        # running clock (departure from last served station + travel)
    acc_travel = 0.0              # accumulated travel since last served station

    for i in range(n):
        is_skipped = (i in skip and i != 0 and i != n - 1)

        if is_skipped:
            # Accumulate travel time for this segment, don't update cur yet
            if i > 0:
                acc_travel += (dists[i - 1] / speed) * 60
            route.append({
                "station": stations[i]["name"],
                "center": list(stations[i]["center"]),
                "arrive": "",
                "depart": "",
            })
            continue

        # --- Served station ---
        if i > 0:
            acc_travel += (dists[i - 1] / speed) * 60

        if i == 0:
            route.append({
                "station": stations[i]["name"],
                "center": list(stations[i]["center"]),
                "arrive": "",
                "depart": fmt(round2(cur)),
            })
        else:
            arr = round2(cur + acc_travel)
            dep_time = fmt(arr + stop_min) if i < n - 1 else ""
            route.append({
                "station": stations[i]["name"],
                "center": list(stations[i]["center"]),
                "arrive": fmt(arr),
                "depart": dep_time,
            })
            # Reset travel accumulator; advance clock past this station
            cur = arr
            acc_travel = 0.0
            if i < n - 1:
                cur += stop_min  # dwell time at intermediate stop

    # Last station: ensure no depart
    if route:
        route[-1]["depart"] = ""
    return route


# ---------------------------------------------------------------------------
# Major-station detection (for express services)
# ---------------------------------------------------------------------------

MAJOR_NAMES = {
    "北京南", "北京西", "北京", "北京朝阳", "北京丰台",
    "上海虹桥", "上海",
    "广州南", "广州", "广州东",
    "深圳北", "深圳",
    "南京南", "南京",
    "杭州东", "杭州", "杭州西",
    "武汉", "汉口",
    "成都东", "成都",
    "重庆北", "重庆西", "重庆",
    "西安北", "西安",
    "郑州东", "郑州",
    "长沙南", "长沙",
    "济南西", "济南", "济南东",
    "青岛", "青岛北",
    "天津", "天津西", "天津南",
    "沈阳北", "沈阳",
    "哈尔滨", "哈尔滨西",
    "长春", "长春西",
    "大连北", "大连",
    "昆明南", "昆明",
    "贵阳北", "贵阳",
    "南宁东", "南宁",
    "兰州西", "兰州",
    "乌鲁木齐",
    "福州", "福州南",
    "合肥南", "合肥",
    "南昌西", "南昌",
    "石家庄",
    "太原南", "太原",
    "呼和浩特东", "呼和浩特",
    "银川",
    "西宁",
    "拉萨",
    "海口东", "海口",
    "苏州北", "苏州",
    "无锡东", "无锡",
    "徐州东",
    "厦门北", "厦门",
}


def major_indices(stations):
    """Indices of stations whose name is in MAJOR_NAMES."""
    return [i for i, s in enumerate(stations) if s["name"] in MAJOR_NAMES]


# ---------------------------------------------------------------------------
# Train-pair generator
# ---------------------------------------------------------------------------

_counter = 1  # global sequential counter


def make_pair(line_name, prefix, stations, speed,
              start_min, express=False, skip_set=None, via=None):
    """
    Create one forward + one reverse train dict.
    Returns (forward_train, reverse_train).
    """
    global _counter
    fwd_num = f"{prefix}{_counter}"
    _counter += 1
    rev_num = f"{prefix}{_counter}"
    _counter += 1

    fwd_route = build_route(stations, start_min, speed, skip=skip_set)

    # Reverse route: flip stations, recompute schedule from same start time
    rev_stations = list(reversed(stations))
    rev_skip = None
    if skip_set:
        n = len(stations)
        rev_skip = {(n - 1 - idx) for idx in skip_set}
    rev_route = build_route(rev_stations, start_min, speed, skip=rev_skip)

    fwd = {
        "number": fwd_num,
        "type": prefix,
        "name": line_name,
        "route": fwd_route,
    }
    if express and skip_set:
        fwd["stops"] = sorted(skip_set)

    rev = {
        "number": rev_num,
        "type": prefix,
        "name": line_name,
        "route": rev_route,
    }
    if express and skip_set:
        n = len(stations)
        rev["stops"] = sorted(n - 1 - idx for idx in skip_set)

    if via:
        fwd["via"] = via
        rev["via"] = via

    return fwd, rev


# ---------------------------------------------------------------------------
# Cross-line service definitions
# ---------------------------------------------------------------------------

CROSS_LINE_DEFS = [
    {
        "name": "京昆高铁",
        "segments": ["京广高铁", "沪昆高铁"],
        "join_station": "长沙南",  # last of line1 == first of line2
    },
    {
        "name": "京福高铁",
        "segments": ["京沪高铁", "合福高铁"],
        "join_station": "蚌埠南",
    },
    {
        "name": "沪广高铁",
        "segments": ["沪昆高铁", "贵广高铁"],
        "join_station": "贵阳北",
    },
]


def find_line(lines, name):
    """Look up a line by name; return None if not found."""
    for ln in lines:
        if ln["name"] == name:
            return ln
    return None


def build_cross_line_stations(segments, join_station):
    """
    Concatenate stations from *segments* (list of line dicts),
    joining at *join_station* (shared station, included once).
    Returns station list or None if join fails.
    """
    combined = []
    for i, line in enumerate(segments):
        sts = line["stations"]
        if i == 0:
            combined.extend(sts)
        else:
            # Find join_station in this line's stations
            idx = None
            for j, s in enumerate(sts):
                if s["name"] == join_station:
                    idx = j
                    break
            if idx is None:
                return None
            # Append from join_station onward (skip if it's already the last of prev)
            combined.extend(sts[idx:])
    return combined


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def generate(hsr_lines):
    """Generate all train services. Returns list of train dicts."""
    global _counter
    _counter = 1
    trains = []
    stats = {"trunk": 0, "regional": 0, "intercity": 0, "fast": 0, "express": 0}

    # --- Per-line generation ------------------------------------------------
    for line in hsr_lines:
        name = line["name"]
        stations = line["stations"]
        n = len(stations)
        if n < 2:
            continue

        lt, prefix, _, speed = classify(name)
        sc = service_count(lt, n)
        dep_times = departures(sc)

        # Decide express services: trunk lines with enough stations
        n_express = 0
        if lt == "trunk" and n >= 12:
            n_express = 3
        elif lt == "trunk" and n >= 8:
            n_express = 2

        # Pre-compute express skip sets
        express_configs = []
        if n_express > 0:
            majors = major_indices(stations)
            if len(majors) >= 4:
                # Config 1: only first + last + 3-4 evenly-spaced majors
                n_keep = min(6, len(majors))
                step = max(1, (len(majors) - 1) / (n_keep - 1))
                keep_indices_1 = {0, n - 1}
                for k in range(n_keep):
                    keep_indices_1.add(majors[round(k * step)])
                skip_1 = set(range(n)) - keep_indices_1
                express_configs.append(skip_1)

                if n_express >= 2 and len(majors) >= 5:
                    # Config 2: more stops than config 1
                    n_keep2 = min(8, len(majors))
                    step2 = max(1, (len(majors) - 1) / (n_keep2 - 1))
                    keep_indices_2 = {0, n - 1}
                    for k in range(n_keep2):
                        keep_indices_2.add(majors[round(k * step2)])
                    skip_2 = set(range(n)) - keep_indices_2
                    express_configs.append(skip_2)

                if n_express >= 3 and len(majors) >= 6:
                    # Config 3: keep even more
                    n_keep3 = min(10, len(majors))
                    step3 = max(1, (len(majors) - 1) / (n_keep3 - 1))
                    keep_indices_3 = {0, n - 1}
                    for k in range(n_keep3):
                        keep_indices_3.add(majors[round(k * step3)])
                    skip_3 = set(range(n)) - keep_indices_3
                    express_configs.append(skip_3)

        # Generate services
        for i, dt in enumerate(dep_times):
            if i < len(express_configs):
                skip_set = express_configs[i]
                fwd, rev = make_pair(name, prefix, stations, speed, dt,
                                     express=True, skip_set=skip_set)
                trains.extend([fwd, rev])
                stats["express"] += 2
            else:
                fwd, rev = make_pair(name, prefix, stations, speed, dt)
                trains.extend([fwd, rev])

        stats[lt] += sc * 2

    # --- Cross-line services ------------------------------------------------
    cross_count = 0
    for xdef in CROSS_LINE_DEFS:
        seg_lines = [find_line(hsr_lines, s) for s in xdef["segments"]]
        if any(s is None for s in seg_lines):
            continue

        combined = build_cross_line_stations(seg_lines, xdef["join_station"])
        if combined is None or len(combined) < 4:
            continue

        # Use trunk speed for cross-line G trains
        speed = 270.0
        prefix = "G"

        # Generate 2 services (each direction)
        dep_times_x = departures(2, start=420, end=1080)  # 07:00, 18:00
        for dt in dep_times_x:
            fwd, rev = make_pair(
                xdef["name"], prefix, combined, speed, dt,
                via=xdef["segments"],
            )
            trains.extend([fwd, rev])
            cross_count += 2

    stats["cross_line"] = cross_count
    return trains, stats


def main():
    print(f"Reading {INPUT_FILE} ...")
    with open(INPUT_FILE, "r", encoding="utf-8") as f:
        hsr_lines = json.load(f)
    print(f"  {len(hsr_lines)} railway lines loaded\n")

    trains, stats = generate(hsr_lines)

    # Write output
    os.makedirs(os.path.dirname(OUTPUT_FILE), exist_ok=True)
    with open(OUTPUT_FILE, "w", encoding="utf-8") as f:
        json.dump(trains, f, ensure_ascii=False, indent=2)

    # Print statistics
    total = len(trains)
    print(f"Generated {total} train services")
    print(f"  Written to: {OUTPUT_FILE}\n")

    print("By line type:")
    for lt in ("trunk", "regional", "intercity", "fast"):
        print(f"  {lt:12s}: {stats[lt]:4d} services")

    print(f"\nExpress (大站车) : {stats['express']:4d}")
    print(f"Cross-line      : {stats.get('cross_line', 0):4d}")

    # Type breakdown
    from collections import Counter
    type_cnt = Counter()
    for t in trains:
        type_cnt[t["type"]] += 1
    print("\nBy train prefix:")
    for tp in sorted(type_cnt):
        print(f"  {tp}-series: {type_cnt[tp]:4d}")

    # Show a sample
    print("\n--- Sample trains ---")
    shown = set()
    for t in trains:
        key = t["name"]
        if key in shown:
            continue
        shown.add(key)
        first = t["route"][0]
        last = t["route"][-1]
        extra = f"  [express]" if "stops" in t else ""
        via = f"  via {' + '.join(t['via'])}" if "via" in t else ""
        print(f"  {t['number']:8s} {t['name']:12s}  "
              f"{first['station']}({first['depart'] or '----'}) -> "
              f"{last['station']}({last['arrive'] or '----'}){extra}{via}")
        if len(shown) >= 15:
            break

    # File size
    size_kb = os.path.getsize(OUTPUT_FILE) / 1024
    print(f"\nFile size: {size_kb:.1f} KB")


if __name__ == "__main__":
    main()
