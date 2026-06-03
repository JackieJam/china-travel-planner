#!/usr/bin/env python3
"""
数据采集工具 - 全国交通旅游地图

功能：
  1. 通过高德 POI 搜索采集城市景点数据
  2. 扩展现有 cities.json 的城市列表
  3. 验证和清洗 JSON 数据

用法：
  python3 tools/collect_data.py --action spots --city 北京 --key YOUR_AMAP_KEY
  python3 tools/collect_data.py --action spots --all --key YOUR_AMAP_KEY
  python3 tools/collect_data.py --action validate

依赖：
  pip install requests
"""

import argparse
import json
import sys
import time
from pathlib import Path

try:
    import requests
except ImportError:
    print("请先安装 requests: pip install requests")
    sys.exit(1)

DATA_DIR = Path(__file__).parent.parent / "data"
AMAP_API_BASE = "https://restapi.amap.com/v3"


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
    print(f"已保存到 {filepath} ({len(data)} 条记录)")


def collect_spots(city_name, api_key, category="风景名胜", page_size=25):
    """通过高德 POI 搜索采集城市景点"""
    url = f"{AMAP_API_BASE}/place/text"
    spots = []
    page = 1

    while True:
        params = {
            "key": api_key,
            "keywords": category,
            "city": city_name,
            "citylimit": "true",
            "offset": page_size,
            "page": page,
            "extensions": "all",
        }

        resp = requests.get(url, params=params)
        data = resp.json()

        if data.get("status") != "1":
            print(f"  API 错误: {data.get('info', 'unknown')}")
            break

        pois = data.get("pois", [])
        if not pois:
            break

        for poi in pois:
            location = poi.get("location", "")
            if not location or "," not in location:
                continue

            lng, lat = location.split(",")
            spot = {
                "name": poi.get("name", ""),
                "city": city_name,
                "center": [float(lng), float(lat)],
                "category": _map_category(poi.get("type", "")),
                "description": poi.get("biz_ext", {}).get("rating", "") and
                    f"评分 {poi['biz_ext']['rating']}" or "",
            }

            # 避免重复
            if not any(s["name"] == spot["name"] for s in spots):
                spots.append(spot)

        total = int(data.get("count", 0))
        if page * page_size >= total or page >= 4:
            break

        page += 1
        time.sleep(0.2)  # 避免触发限流

    return spots


def _map_category(amap_type):
    """将高德 POI 类型映射到我们的分类"""
    if "自然" in amap_type or "风景" in amap_type or "公园" in amap_type:
        return "自然"
    elif "历史" in amap_type or "古迹" in amap_type or "文物" in amap_type:
        return "历史"
    elif "文化" in amap_type or "博物" in amap_type or "图书" in amap_type:
        return "文化"
    else:
        return "现代"


def collect_all_spots(api_key):
    """为所有已录入城市采集景点数据"""
    cities = load_json("cities.json")
    existing_spots = load_json("spots.json")
    existing_names = {s["name"] for s in existing_spots}

    new_spots = []
    for i, city in enumerate(cities):
        city_name = city["name"]
        print(f"[{i+1}/{len(cities)}] 采集 {city_name} 景点…")

        for category in ["风景名胜", "旅游景点", "博物馆", "公园"]:
            spots = collect_spots(city_name, api_key, category)
            for spot in spots:
                if spot["name"] not in existing_names:
                    new_spots.append(spot)
                    existing_names.add(spot["name"])

        # 高德 API 限流：每秒 5 次
        time.sleep(0.5)

    print(f"\n共采集到 {len(new_spots)} 个新景点")

    if new_spots:
        all_spots = existing_spots + new_spots
        save_json("spots.json", all_spots)


def collect_city_spots(city_name, api_key):
    """采集单个城市的景点"""
    existing_spots = load_json("spots.json")
    existing_names = {s["name"] for s in existing_spots}

    new_spots = []
    for category in ["风景名胜", "旅游景点", "博物馆", "公园", "历史建筑"]:
        print(f"  搜索分类: {category}")
        spots = collect_spots(city_name, api_key, category)
        for spot in spots:
            if spot["name"] not in existing_names:
                new_spots.append(spot)
                existing_names.add(spot["name"])
        time.sleep(0.3)

    print(f"\n{city_name} 新采集 {len(new_spots)} 个景点")

    if new_spots:
        all_spots = existing_spots + new_spots
        save_json("spots.json", all_spots)


def validate_data():
    """验证所有 JSON 数据文件的完整性"""
    errors = []

    # 检查 cities.json
    cities = load_json("cities.json")
    city_names = {c["name"] for c in cities}
    print(f"cities.json: {len(cities)} 个城市")

    for c in cities:
        if "center" not in c or len(c["center"]) != 2:
            errors.append(f"  {c['name']}: 缺少有效的 center 坐标")

    # 检查 hsr.json
    hsr = load_json("hsr.json")
    print(f"hsr.json: {len(hsr)} 条高铁线路")

    for line in hsr:
        for s in line.get("stations", []):
            if s["name"] not in city_names:
                pass  # 中间站可能不在城市列表中，不算错误

    # 检查 metro.json
    metro = load_json("metro.json")
    print(f"metro.json: {len(metro)} 个城市地铁")

    for m in metro:
        if m["city"] not in city_names:
            errors.append(f"  metro: 城市 {m['city']} 不在 cities.json 中")

    # 检查 spots.json
    spots = load_json("spots.json")
    print(f"spots.json: {len(spots)} 个景点")

    for spot in spots:
        if spot["city"] not in city_names:
            errors.append(f"  spots: {spot['name']} 所在城市 {spot['city']} 不在 cities.json 中")

    if errors:
        print(f"\n发现 {len(errors)} 个问题:")
        for e in errors:
            print(e)
    else:
        print("\n数据验证通过，无问题。")


def main():
    parser = argparse.ArgumentParser(description="全国交通旅游地图 - 数据采集工具")
    parser.add_argument("--action", choices=["spots", "validate"],
                        required=True, help="操作类型")
    parser.add_argument("--city", help="城市名称（采集单城市时使用）")
    parser.add_argument("--all", action="store_true", help="采集所有城市")
    parser.add_argument("--key", help="高德 Web 服务 API Key")

    args = parser.parse_args()

    if args.action == "validate":
        validate_data()

    elif args.action == "spots":
        if not args.key:
            print("错误：请提供高德 API Key (--key YOUR_KEY)")
            print("申请地址：https://console.amap.com/dev/key/app")
            sys.exit(1)

        if args.all:
            collect_all_spots(args.key)
        elif args.city:
            collect_city_spots(args.city, args.key)
        else:
            print("错误：请指定 --city 城市名 或 --all")
            sys.exit(1)


if __name__ == "__main__":
    main()
