#!/usr/bin/env python3
# /// script
# requires-python = ">=3.10"
# dependencies = ["requests"]
# ///
"""
地铁数据采集工具 - 全国交通旅游地图

通过高德公交线路 API 批量采集各城市地铁线路和站点数据（有序、含坐标），
输出为 metro.json。

用法：
  uv run tools/collect_metro.py                        # 采集所有 hasMetro 城市
  uv run tools/collect_metro.py --city 深圳             # 采集单个城市
  uv run tools/collect_metro.py --dry-run               # 只发现线路，不拉站点
"""

import argparse
import json
import re
import sys
import time
from pathlib import Path

try:
    import requests
except ImportError:
    print("请先安装 requests: pip install requests")
    sys.exit(1)

DATA_DIR = Path(__file__).parent.parent / "data"
AMAP_KEY = "a1433a639b84f333a4b37f17b6388da3"
API_PLACE = "https://restapi.amap.com/v3/place/text"
API_BUSLINE = "https://restapi.amap.com/v3/bus/linename"

# ── 线路颜色 ────────────────────────────────────────────────
# 各城市地铁线路的官方/常用颜色，缺失时使用自动生成的默认色
LINE_COLORS = {
    # 北京
    "北京": {
        "1号线": "#A41916", "2号线": "#006098", "3号线": "#D3A16A",
        "4号线": "#008C4E", "5号线": "#B58500", "6号线": "#C4572F",
        "7号线": "#F2C172", "8号线": "#009D7D", "9号线": "#8DC440",
        "10号线": "#009BC0", "11号线": "#E66539", "12号线": "#9E5210",
        "13号线": "#F9E700", "14号线": "#D4A76A", "15号线": "#5D2F6D",
        "16号线": "#65C53A", "17号线": "#006D75", "19号线": "#6E3A8E",
        "昌平线": "#DE8BC3", "房山线": "#D3547E", "亦庄线": "#D8282F",
        "大兴线": "#008C4E", "S1线": "#8B4513", "燕房线": "#808080",
        "首都机场线": "#A0D8EF",
    },
    # 上海
    "上海": {
        "1号线": "#E3002B", "2号线": "#7FB800", "3号线": "#F6D700",
        "4号线": "#4F1D8E", "5号线": "#A6218F", "6号线": "#D600B2",
        "7号线": "#F26A09", "8号线": "#009FD9", "9号线": "#8CCAE5",
        "10号线": "#C7AFD3", "11号线": "#8C2221", "12号线": "#00835E",
        "13号线": "#EF91C0", "14号线": "#617E22", "15号线": "#C4A46C",
        "16号线": "#3D8C74", "17号线": "#B5D4E0", "18号线": "#C38C28",
        "浦江线": "#B5B5B5",
    },
    # 广州
    "广州": {
        "1号线": "#F3D03E", "2号线": "#00629B", "3号线": "#ECA154",
        "4号线": "#00843D", "5号线": "#C5003E", "6号线": "#80278B",
        "7号线": "#89D96C", "8号线": "#008C8C", "9号线": "#78B159",
        "13号线": "#8A5D27", "14号线": "#81312F", "18号线": "#002868",
        "21号线": "#1A2A60", "22号线": "#DA291C", "APM线": "#00B0F0",
        "广佛线": "#C4D82D",
    },
    # 深圳
    "深圳": {
        "1号线": "#00A650", "2号线": "#E4002B", "3号线": "#00A0E9",
        "4号线": "#E4002B", "5号线": "#8E24AA", "6号线": "#00C0A4",
        "7号线": "#264D8B", "8号线": "#E4002B", "9号线": "#8B9DC3",
        "10号线": "#F05A78", "11号线": "#6E2585", "12号线": "#6F8F1B",
        "13号线": "#002D72", "14号线": "#A57F3F", "16号线": "#F28C0A",
        "20号线": "#E5A300",
    },
    # 成都
    "成都": {
        "1号线": "#155DBA", "2号线": "#E4002B", "3号线": "#009B4D",
        "4号线": "#0094C5", "5号线": "#8E3B99", "6号线": "#B58500",
        "7号线": "#56C1A5", "8号线": "#8DC63F", "9号线": "#F5A623",
        "10号线": "#002D72", "17号线": "#6E3A8E", "18号线": "#002D72",
    },
    # 武汉
    "武汉": {
        "1号线": "#006098", "2号线": "#D8232A", "3号线": "#E59F00",
        "4号线": "#5AAB00", "5号线": "#D81E06", "6号线": "#009B4D",
        "7号线": "#9370DB", "8号线": "#8CCAE5", "11号线": "#F28C0A",
        "12号线": "#A0D8EF", "16号线": "#00B0F0",
        "阳逻线": "#8E24AA",
    },
    # 杭州
    "杭州": {
        "1号线": "#E4002B", "2号线": "#F5A623", "3号线": "#009B4D",
        "4号线": "#0094C5", "5号线": "#00B0F0", "6号线": "#8E3B99",
        "7号线": "#F28C0A", "8号线": "#6E3A8E", "9号线": "#B58500",
        "10号线": "#002D72", "12号线": "#56C1A5", "16号线": "#D81E06",
        "19号线": "#8DC63F",
    },
    # 南京
    "南京": {
        "1号线": "#009FD9", "2号线": "#CE1126", "3号线": "#009B4D",
        "4号线": "#8E3B99", "7号线": "#F28C0A", "10号线": "#56C1A5",
        "S1号线": "#8CCAE5", "S3号线": "#F5A623", "S7号线": "#D81E06",
        "S8号线": "#00B0F0", "S9号线": "#8E24AA",
    },
    # 重庆
    "重庆": {
        "1号线": "#E4002B", "2号线": "#009FD9", "3号线": "#009B4D",
        "4号线": "#F5A623", "5号线": "#8E3B99", "6号线": "#00B0F0",
        "9号线": "#F28C0A", "10号线": "#002D72", "环线": "#56C1A5",
        "18号线": "#B58500", "国博线": "#D81E06",
    },
    # 西安
    "西安": {
        "1号线": "#8CCAE5", "2号线": "#E4002B", "3号线": "#8E3B99",
        "4号线": "#009B4D", "5号线": "#F5A623", "6号线": "#002D72",
        "9号线": "#F28C0A", "14号线": "#56C1A5", "16号线": "#D81E06",
    },
    # 天津
    "天津": {
        "1号线": "#E4002B", "2号线": "#F5A623", "3号线": "#0094C5",
        "4号线": "#009B4D", "5号线": "#8E3B99", "6号线": "#00B0F0",
        "9号线": "#F28C0A", "10号线": "#002D72",
    },
    # 长沙
    "长沙": {
        "1号线": "#E4002B", "2号线": "#0094C5", "3号线": "#009B4D",
        "4号线": "#8E3B99", "5号线": "#F5A623", "6号线": "#F28C0A",
    },
    # 郑州
    "郑州": {
        "1号线": "#E4002B", "2号线": "#0094C5", "3号线": "#009B4D",
        "4号线": "#8E3B99", "5号线": "#F5A623", "6号线": "#F28C0A",
        "10号线": "#002D72", "12号线": "#56C1A5", "14号线": "#D81E06",
        "城郊线": "#8CCAE5",
    },
    # 沈阳
    "沈阳": {
        "1号线": "#E4002B", "2号线": "#F5A623", "9号线": "#0094C5",
        "10号线": "#009B4D",
    },
    # 哈尔滨
    "哈尔滨": {
        "1号线": "#E4002B", "2号线": "#0094C5", "3号线": "#009B4D",
    },
    # 大连
    "大连": {
        "1号线": "#0094C5", "2号线": "#E4002B", "3号线": "#009B4D",
        "5号线": "#F5A623", "12号线": "#8E3B99", "13号线": "#F28C0A",
    },
    # 青岛
    "青岛": {
        "1号线": "#E4002B", "2号线": "#0094C5", "3号线": "#009B4D",
        "4号线": "#8E3B99", "8号线": "#F5A623", "11号线": "#F28C0A",
        "13号线": "#002D72",
    },
    # 昆明
    "昆明": {
        "1号线": "#E4002B", "2号线": "#0094C5", "3号线": "#009B4D",
        "4号线": "#8E3B99", "5号线": "#F5A623", "6号线": "#F28C0A",
    },
    # 贵阳
    "贵阳": {
        "1号线": "#E4002B", "2号线": "#0094C5", "3号线": "#009B4D",
        "S1线": "#F5A623",
    },
    # 南宁
    "南宁": {
        "1号线": "#E4002B", "2号线": "#0094C5", "3号线": "#009B4D",
        "4号线": "#8E3B99", "5号线": "#F5A623",
    },
    # 福州
    "福州": {
        "1号线": "#E4002B", "2号线": "#0094C5", "4号线": "#8E3B99",
        "5号线": "#F5A623", "6号线": "#F28C0A",
    },
    # 厦门
    "厦门": {
        "1号线": "#E4002B", "2号线": "#0094C5", "3号线": "#009B4D",
    },
    # 合肥
    "合肥": {
        "1号线": "#E4002B", "2号线": "#0094C5", "3号线": "#009B4D",
        "4号线": "#8E3B99", "5号线": "#F5A623",
    },
    # 南昌
    "南昌": {
        "1号线": "#E4002B", "2号线": "#0094C5", "3号线": "#009B4D",
        "4号线": "#8E3B99",
    },
    # 无锡
    "无锡": {
        "1号线": "#E4002B", "2号线": "#0094C5", "3号线": "#009B4D",
        "4号线": "#8E3B99", "S1线": "#F5A623",
    },
    # 苏州
    "苏州": {
        "1号线": "#E4002B", "2号线": "#0094C5", "3号线": "#009B4D",
        "4号线": "#8E3B99", "5号线": "#F5A623", "11号线": "#F28C0A",
    },
    # 宁波
    "宁波": {
        "1号线": "#E4002B", "2号线": "#0094C5", "3号线": "#009B4D",
        "4号线": "#8E3B99", "5号线": "#F5A623",
    },
    # 佛山
    "佛山": {
        "1号线": "#009B4D", "2号线": "#0094C5", "3号线": "#E4002B",
    },
    # 东莞
    "东莞": {
        "2号线": "#E4002B", "1号线": "#0094C5",
    },
}

# 自动生成的默认颜色（备用）
DEFAULT_COLORS = [
    "#E74C3C", "#3498DB", "#2ECC71", "#F39C12", "#9B59B6",
    "#1ABC9C", "#E67E22", "#2980B9", "#27AE60", "#8E44AD",
    "#D35400", "#16A085", "#C0392B", "#7F8C8D", "#F1C40F",
]

def load_json(filename):
    filepath = DATA_DIR / filename
    if filepath.exists():
        with open(filepath, "r", encoding="utf-8") as f:
            return json.load(f)
    return []


def save_json(filename, data):
    filepath = DATA_DIR / filename
    with open(filepath, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)
    print(f"✓ 已保存到 {filepath}")


def api_get(url, params, retries=3):
    """带重试的 GET 请求"""
    for attempt in range(retries):
        try:
            resp = requests.get(url, params=params, timeout=10)
            data = resp.json()
            if data.get("status") == "1":
                return data
            info = data.get("info", "unknown")
            if "INFREQUENT" in str(info) or "DAILY" in str(info):
                print(f"  ⚠ API 配额耗尽: {info}")
                return None
            print(f"  ⚠ API 返回: {info} (attempt {attempt+1})")
        except Exception as e:
            print(f"  ⚠ 请求失败: {e} (attempt {attempt+1})")
        time.sleep(1)
    return None


def discover_lines(city_name):
    """通过 POI 搜索发现城市所有地铁线路名称"""
    all_line_names = set()
    page = 1
    page_size = 25

    while True:
        params = {
            "key": AMAP_KEY,
            "keywords": "地铁站",
            "types": "150500",
            "city": city_name,
            "citylimit": "true",
            "offset": page_size,
            "page": page,
            "extensions": "all",
        }

        data = api_get(API_PLACE, params)
        if not data:
            break

        pois = data.get("pois", [])
        if not pois:
            break

        for poi in pois:
            address = poi.get("address", "") or ""
            # address 格式: "1号线/罗宝线;4号线/龙华线" 或 "2号线(8号线)"
            for part in address.split(";"):
                part = part.strip()
                if not part:
                    continue
                # 去掉括号内的别名，保留主线名
                # "2号线(8号线)" → "2号线"
                # "1号线/罗宝线" → "1号线"
                main_name = part.split("(")[0].split("/")[0].strip()
                if main_name:
                    all_line_names.add(main_name)

        total = int(data.get("count", 0))
        if page * page_size >= total or page >= 8:
            break

        page += 1
        time.sleep(0.25)

    return sorted(all_line_names, key=_line_sort_key)


def _line_sort_key(name):
    """线路名排序：数字线 → 字母线 → 中文线"""
    m = re.match(r"(\d+)", name)
    if m:
        return (0, int(m.group(1)), name)
    if name.startswith("S"):
        m2 = re.match(r"S(\d+)", name)
        if m2:
            return (1, int(m2.group(1)), name)
    return (2, 0, name)


def fetch_line_stations(city_name, line_name):
    """通过公交线路 API 获取单条线路的有序站点列表"""
    # 构造搜索关键词：尝试多种搜索方式
    search_variants = [f"地铁{line_name}", f"{line_name}"]
    # 如果有别名格式（如"2号线(8号线)"），也搜索
    if "(" in line_name:
        base = line_name.split("(")[0]
        search_variants.append(f"地铁{base}")

    all_candidates = []

    for kw in search_variants:
        params = {
            "key": AMAP_KEY,
            "city": city_name,
            "keywords": kw,
            "offset": 10,
            "page": 1,
            "extensions": "all",
        }

        data = api_get(API_BUSLINE, params)
        if not data:
            continue

        buslines = data.get("buslines", [])
        for bl in buslines:
            full_name = bl.get("name", "")
            # 严格匹配：线路全名必须包含我们搜索的线路名
            # "地铁2号线(8号线)" 包含 "2号线" ✓
            # "地铁20号线二期" 包含 "2号线" ✗（需要排除）
            if not _strict_line_match(full_name, line_name):
                continue
            busstops = bl.get("busstops", [])
            if busstops:
                all_candidates.append((full_name, busstops))

        if all_candidates:
            break  # 找到匹配了就不用试更多关键词了
        time.sleep(0.3)

    if not all_candidates:
        return None

    # 选择站点数最多的结果（主线优先于支线）
    all_candidates.sort(key=lambda x: len(x[1]), reverse=True)
    line_full_name, busstops = all_candidates[0]

    stations = []
    seen = set()
    for stop in busstops:
        loc = stop.get("location", "")
        name = stop.get("name", "").strip()
        if not name or not loc or "," not in loc:
            continue
        lng, lat = loc.split(",")
        # 去重
        key = f"{name}_{lng}_{lat}"
        if key in seen:
            continue
        seen.add(key)
        stations.append({
            "name": name,
            "center": [round(float(lng), 4), round(float(lat), 4)],
        })

    return stations, line_full_name


def _strict_line_match(full_name, target_line):
    """严格匹配线路名，防止 2号线 匹配到 20号线"""
    # full_name 示例: "地铁2号线(8号线)(溪涌--赤湾)"
    # target_line 示例: "2号线"

    # 先去掉前缀 "地铁"
    name = full_name.replace("地铁", "")

    # 提取数字部分进行精确比对
    target_num = re.match(r"([A-Za-z]?\d+)", target_line)
    if not target_num:
        # 非数字线路名（环线等），用简单包含匹配
        return target_line in full_name

    target_id = target_num.group(1)

    # 在 full_name 中查找匹配的数字编号
    # 需要确保 "2" 不会匹配 "20"、"22" 等
    pattern = rf"(?:^|[^0-9]){re.escape(target_id)}(?:号线|线)"
    return bool(re.search(pattern, name))


def get_line_color(city_name, line_name):
    """获取线路颜色"""
    city_colors = LINE_COLORS.get(city_name, {})
    if line_name in city_colors:
        return city_colors[line_name]
    # 默认颜色 hash
    idx = hash(f"{city_name}_{line_name}") % len(DEFAULT_COLORS)
    return DEFAULT_COLORS[idx]


def collect_city_metro(city_name, dry_run=False):
    """采集单个城市的所有地铁线路"""
    print(f"\n{'='*50}")
    print(f"  采集 {city_name} 地铁数据")
    print(f"{'='*50}")

    # Step 1: 发现线路
    print(f"  [1/2] 发现线路...")
    line_names = discover_lines(city_name)
    if not line_names:
        print(f"  ✗ 未发现任何地铁线路")
        return None

    print(f"  发现 {len(line_names)} 条线路: {', '.join(line_names)}")

    if dry_run:
        return {"city": city_name, "lines": []}

    # Step 2: 逐条拉站点
    print(f"  [2/2] 拉取站点数据...")
    lines_data = []
    for i, lname in enumerate(line_names):
        result = fetch_line_stations(city_name, lname)
        if result:
            stations, full_name = result
            color = get_line_color(city_name, lname)
            lines_data.append({
                "name": lname,
                "color": color,
                "stations": stations,
            })
            print(f"    [{i+1}/{len(line_names)}] {lname}: {len(stations)} 站 ✓")
        else:
            print(f"    [{i+1}/{len(line_names)}] {lname}: 无数据 ✗")
        time.sleep(0.5)  # 避免限流

    if not lines_data:
        return None

    return {
        "city": city_name,
        "lines": lines_data,
    }


def main():
    parser = argparse.ArgumentParser(description="地铁数据采集工具")
    parser.add_argument("--city", help="城市名称（不指定则采集所有）")
    parser.add_argument("--dry-run", action="store_true", help="只发现线路，不拉站点")
    args = parser.parse_args()

    cities = load_json("cities.json")
    metro_cities = [c["name"] for c in cities if c.get("hasMetro")]

    if args.city:
        if args.city not in metro_cities:
            print(f"⚠ {args.city} 不在 hasMetro 城市列表中")
            # 仍然尝试采集
        target_cities = [args.city]
    else:
        target_cities = metro_cities

    print(f"目标城市 ({len(target_cities)}): {', '.join(target_cities)}")

    all_metro = []
    for i, city in enumerate(target_cities):
        print(f"\n>>> [{i+1}/{len(target_cities)}] {city}")
        result = collect_city_metro(city, dry_run=args.dry_run)
        if result and result["lines"]:
            all_metro.append(result)
            total_stations = sum(len(l["stations"]) for l in result["lines"])
            print(f"  ✓ {city}: {len(result['lines'])} 条线路, {total_stations} 个站点")
        time.sleep(0.5)

    if all_metro:
        save_json("metro.json", all_metro)
        total_lines = sum(len(m["lines"]) for m in all_metro)
        total_stations = sum(
            len(l["stations"]) for m in all_metro for l in m["lines"]
        )
        print(f"\n{'='*50}")
        print(f"  采集完成！")
        print(f"  {len(all_metro)} 城市, {total_lines} 条线路, {total_stations} 个站点")
        print(f"{'='*50}")
    else:
        print("\n未采集到任何数据")


if __name__ == "__main__":
    main()
