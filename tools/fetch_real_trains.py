#!/usr/bin/env python3
# /// script
# requires-python = ">=3.10"
# dependencies = ["requests"]
# ///
"""
从 12306 leftTicket 接口采集真实车次数据，替换模拟 trains.json。

策略：
  1. 拉取站名电报码映射
  2. 从 hsr.json 推导查询城市对（优先短途走廊）
  3. 每次查询用独立 session（规避 12306 IP 限流）
  4. 多轮重试，逐步积累数据
  5. 匹配车次到 HSR 线路，用距离比例插值中间站时刻
  6. 去重后写入 trains.json

用法：
  python3 -u tools/fetch_real_trains.py                       # 全量采集（3轮）
  python3 -u tools/fetch_real_trains.py --dry-run             # 预览不写入
  python3 -u tools/fetch_real_trains.py --rounds 1            # 只跑1轮
  python3 -u tools/fetch_real_trains.py --max-pairs 10        # 限制查询对数
"""

import argparse
import json
import math
import sys
import time
from pathlib import Path
from datetime import datetime, timedelta
from collections import Counter

try:
    import requests
except ImportError:
    print("请先安装 requests: pip install requests", flush=True)
    sys.exit(1)

SCRIPT_DIR = Path(__file__).parent
PROJECT_ROOT = SCRIPT_DIR.parent
DATA_DIR = PROJECT_ROOT / "data"

STATION_URL = "https://kyfw.12306.cn/otn/resources/js/framework/station_name.js"
LEFT_TICKET_URL = "https://kyfw.12306.cn/otn/leftTicket/queryG"
INIT_URL = "https://kyfw.12306.cn/otn/leftTicket/init"
HOME_URL = "https://www.12306.cn/index/"

BROWSER_HEADERS = {
    "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
                  "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.0 Safari/537.36",
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,"
              "image/avif,image/webp,*/*;q=0.8",
    "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
    "Accept-Encoding": "gzip, deflate, br",
    "Connection": "keep-alive",
}

QUERY_HEADERS = {
    "Accept": "*/*",
    "X-Requested-With": "XMLHttpRequest",
    "Referer": "https://kyfw.12306.cn/otn/leftTicket/init?linktypeid=dc",
    "Sec-Fetch-Dest": "empty",
    "Sec-Fetch-Mode": "cors",
    "Sec-Fetch-Site": "same-origin",
}

DEFAULT_ROUNDS = 3


# ── Haversine ──
def haversine(c1, c2):
    lon1, lat1 = math.radians(c1[0]), math.radians(c1[1])
    lon2, lat2 = math.radians(c2[0]), math.radians(c2[1])
    dlat, dlon = lat2 - lat1, lon2 - lon1
    a = math.sin(dlat/2)**2 + math.cos(lat1)*math.cos(lat2)*math.sin(dlon/2)**2
    return 6371 * 2 * math.asin(math.sqrt(a))


# ── Time helpers ──
def time_to_minutes(hhmm):
    h, m = hhmm.split(":")
    return int(h) * 60 + int(m)


def minutes_to_time(minutes):
    h = int(minutes) // 60
    m = int(minutes) % 60
    return f"{h:02d}:{m:02d}"


def load_json(path):
    with open(path, "r", encoding="utf-8") as f:
        return json.load(f)


def save_json(path, data):
    with open(path, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)


# ── Station Codes ──
def fetch_station_codes():
    """从 12306 拉取站名→电报码映射"""
    print("拉取站名电报码...", flush=True)
    resp = requests.get(STATION_URL,
                        headers={"User-Agent": BROWSER_HEADERS["User-Agent"]},
                        timeout=15)
    resp.raise_for_status()

    codes = {}
    reverse = {}
    for entry in resp.text.split("@"):
        parts = entry.split("|")
        if len(parts) >= 3:
            name, code = parts[1], parts[2]
            codes[name] = code
            reverse[code] = name

    print(f"  获取 {len(codes)} 个站名映射", flush=True)
    return codes, reverse


# ── Single Query with Fresh Session ──
def fresh_query(from_code, to_code, date):
    """每次查询用独立 session，返回 (result_list, station_map, success)"""
    s = requests.Session()
    s.headers.update(BROWSER_HEADERS)
    try:
        s.get(HOME_URL, timeout=10)
        time.sleep(0.2)
        s.get(INIT_URL, timeout=10)
        time.sleep(0.2)

        params = {
            "leftTicketDTO.train_date": date,
            "leftTicketDTO.from_station": from_code,
            "leftTicketDTO.to_station": to_code,
            "purpose_codes": "ADULT",
        }
        r = s.get(LEFT_TICKET_URL, params=params,
                  timeout=15, headers=QUERY_HEADERS)
        ct = r.headers.get("Content-Type", "")
        if "json" not in ct:
            return [], {}, False

        text = r.text.strip()
        if text.startswith("\ufeff"):
            text = text[1:]
        if not text.startswith("{"):
            return [], {}, False

        data = json.loads(text)
        results = data.get("data", {}).get("result", [])
        station_map = data.get("data", {}).get("map", {})
        return results, station_map, True
    except Exception:
        return [], {}, False
    finally:
        s.close()


# ── Parse leftTicket result ──
def parse_ticket_result(result_str):
    parts = result_str.split("|")
    if len(parts) < 15:
        return None
    return {
        "train_no": parts[2],
        "train_code": parts[3],
        "from_code": parts[6],
        "to_code": parts[7],
        "start_time": parts[8],
        "arrive_time": parts[9],
        "duration": parts[10],
        "date": parts[13],
    }


# ── Match train to HSR line ──
def match_train_to_line(train_code, from_station, to_station, hsr_lines):
    best_match = None
    best_score = 0

    for line in hsr_lines:
        station_names = [s["name"] for s in line["stations"]]
        from_idx = _fuzzy_find(station_names, from_station)
        to_idx = _fuzzy_find(station_names, to_station)

        if from_idx is not None and to_idx is not None and to_idx > from_idx:
            score = to_idx - from_idx
            if score > best_score:
                best_score = score
                best_match = (line, from_idx, to_idx)

    return best_match


def _fuzzy_find(station_names, target):
    for i, name in enumerate(station_names):
        if name == target or name.startswith(target) or target.startswith(name):
            return i
    return None


# ── Interpolate intermediate stops ──
def interpolate_route(line_stations, from_idx, to_idx, start_time, arrive_time):
    segment = line_stations[from_idx:to_idx + 1]
    if len(segment) < 2:
        return []

    distances = []
    for i in range(len(segment) - 1):
        d = haversine(segment[i]["center"], segment[i + 1]["center"])
        distances.append(max(d, 1))

    total_dist = sum(distances)
    total_minutes = time_to_minutes(arrive_time) - time_to_minutes(start_time)
    if total_minutes <= 0:
        total_minutes += 24 * 60

    route = []
    current_min = time_to_minutes(start_time)

    for i, station in enumerate(segment):
        if i == 0:
            route.append({
                "station": station["name"],
                "center": station["center"],
                "arrive": "",
                "depart": start_time,
            })
        elif i == len(segment) - 1:
            route.append({
                "station": station["name"],
                "center": station["center"],
                "arrive": arrive_time,
                "depart": "",
            })
        else:
            leg_dist = distances[i - 1]
            leg_min = max(2, round(total_minutes * leg_dist / total_dist))
            current_min += leg_min
            arr = minutes_to_time(current_min % (24 * 60))
            current_min += 2
            dep = minutes_to_time(current_min % (24 * 60))
            route.append({
                "station": station["name"],
                "center": station["center"],
                "arrive": arr,
                "depart": dep,
            })

    return route


# ── Build query pairs ──
def build_query_pairs(hsr_lines, station_codes):
    """从 HSR 线路生成查询城市对。
    短途区间查询成功率更高，所以把长线路切分成相邻区段。"""
    pairs = set()

    for line in hsr_lines:
        stations = line["stations"]
        if len(stations) < 2:
            continue
        names = [s["name"] for s in stations]

        # 相邻站对（间隔 2~5 站），覆盖全线路
        step = max(2, min(5, len(names) // 4))
        for i in range(0, len(names) - 1, step):
            j = min(i + step, len(names) - 1)
            if names[i] in station_codes and names[j] in station_codes:
                pairs.add((names[i], names[j]))

        # 起终点（可能长途，成功率低但也尝试）
        first, last = names[0], names[-1]
        if first in station_codes and last in station_codes:
            pairs.add((first, last))

    # 按站名长度排序（短名 ≈ 大城市，优先查询）
    return sorted(pairs, key=lambda p: len(p[0]) + len(p[1]))


# ── Main ──
def main():
    parser = argparse.ArgumentParser(description="从 12306 采集真实车次数据")
    parser.add_argument("--dry-run", action="store_true", help="预览不写入")
    parser.add_argument("--max-pairs", type=int, default=0,
                        help="限制查询城市对数（0=全部）")
    parser.add_argument("--rounds", type=int, default=DEFAULT_ROUNDS,
                        help="重试轮数（默认3）")
    args = parser.parse_args()

    hsr = load_json(DATA_DIR / "hsr.json")
    station_codes, code_to_name = fetch_station_codes()

    pairs = build_query_pairs(hsr, station_codes)
    if args.max_pairs > 0:
        pairs = pairs[:args.max_pairs]
    print(f"查询城市对: {len(pairs)} 对", flush=True)
    print(f"重试轮数: {args.rounds}", flush=True)

    tomorrow = (datetime.now() + timedelta(days=1)).strftime("%Y-%m-%d")
    print(f"查询日期: {tomorrow}", flush=True)

    all_trains = {}
    total_results = 0
    total_api_calls = 0
    total_success = 0

    # Multi-round collection with retry
    pending_pairs = list(pairs)

    for round_num in range(1, args.rounds + 1):
        if not pending_pairs:
            print(f"\n所有查询对已完成，提前结束", flush=True)
            break

        print(f"\n{'='*50}", flush=True)
        print(f"第 {round_num}/{args.rounds} 轮，待查询: {len(pending_pairs)} 对",
              flush=True)
        print(f"{'='*50}", flush=True)

        prev_count = len(all_trains)

        round_ok = 0
        round_fail = 0
        next_pending = []

        for idx, (from_name, to_name) in enumerate(pending_pairs):
            from_code = station_codes.get(from_name)
            to_code = station_codes.get(to_name)
            if not from_code or not to_code:
                continue

            results, station_map, success = fresh_query(from_code, to_code, tomorrow)
            total_api_calls += 1

            if not success:
                round_fail += 1
                next_pending.append((from_name, to_name))
                # Brief pause after failure
                time.sleep(0.5)
                continue

            round_ok += 1
            total_success += 1
            total_results += len(results)

            for code, name in station_map.items():
                if code not in code_to_name:
                    code_to_name[code] = name

            new_in_round = 0
            for r in results:
                parsed = parse_ticket_result(r)
                if not parsed:
                    continue
                train_code = parsed["train_code"]
                if train_code in all_trains:
                    continue

                from_station = code_to_name.get(parsed["from_code"], from_name)
                to_station = code_to_name.get(parsed["to_code"], to_name)

                match = match_train_to_line(
                    train_code, from_station, to_station, hsr
                )
                if not match:
                    continue

                line, from_idx, to_idx = match
                route = interpolate_route(
                    line["stations"], from_idx, to_idx,
                    parsed["start_time"], parsed["arrive_time"]
                )

                if route:
                    code_prefix = train_code[0] if train_code else "G"
                    if code_prefix in "GDC":
                        train_type = code_prefix
                    elif code_prefix in "KTZ":
                        train_type = code_prefix
                    else:
                        train_type = "K"
                    all_trains[train_code] = {
                        "number": train_code,
                        "type": train_type,
                        "name": line["name"],
                        "route": route,
                    }
                    new_in_round += 1

            # Progress
            if (idx + 1) % 5 == 0:
                print(f"  [{idx+1}/{len(pending_pairs)}] "
                      f"成功 {round_ok}, 失败 {round_fail}, "
                      f"累计车次 {len(all_trains)} (+{new_in_round})",
                      flush=True)

            time.sleep(0.3)

        round_new = len(all_trains) - prev_count
        print(f"\n  轮次小结: 成功 {round_ok}, 失败 {round_fail}, "
              f"新增 {round_new} 条车次", flush=True)
        print(f"  累计车次: {len(all_trains)}", flush=True)

        pending_pairs = next_pending

        # Pause between rounds
        if pending_pairs and round_num < args.rounds:
            pause = 5
            print(f"  等待 {pause}s 后开始下一轮...", flush=True)
            time.sleep(pause)

    # Summary
    print(f"\n{'='*50}", flush=True)
    print(f"采集完成", flush=True)
    print(f"  API 调用: {total_api_calls} 次", flush=True)
    print(f"  成功响应: {total_success} 次", flush=True)
    print(f"  原始结果: {total_results} 条", flush=True)
    print(f"  匹配车次: {len(all_trains)} 条", flush=True)

    if not all_trains:
        print("未采集到任何车次，请检查网络连接", flush=True)
        return

    trains_list = sorted(all_trains.values(), key=lambda t: t["number"])

    types = Counter(t["type"] for t in trains_list)
    print(f"类型分布: {dict(types)}", flush=True)

    # Show a few samples
    for t in trains_list[:3]:
        print(f"  {t['number']} "
              f"{t['route'][0]['station']} {t['route'][0]['depart']} → "
              f"{t['route'][-1]['station']} {t['route'][-1]['arrive']}",
              flush=True)

    if not args.dry_run:
        save_json(DATA_DIR / "trains.json", trains_list)
        print(f"\ntrains.json 已更新 ({len(trains_list)} 条)", flush=True)

        meta_path = DATA_DIR / "meta.json"
        meta = load_json(meta_path) if meta_path.exists() else {}
        meta.setdefault("datasets", {})["trains"] = {
            "updatedAt": datetime.now().isoformat(),
            "count": len(trains_list),
            "source": "12306 leftTicket API",
        }
        meta["updatedAt"] = datetime.now().isoformat()
        meta["note"] = ("车次数据来自 12306 实时接口查询（queryG），"
                        "中间站时刻基于 Haversine 距离比例插值")
        save_json(meta_path, meta)
        print("meta.json 已更新", flush=True)
    else:
        print("[dry-run] 未写入文件", flush=True)


if __name__ == "__main__":
    main()
