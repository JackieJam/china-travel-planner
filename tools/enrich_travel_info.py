#!/usr/bin/env python3
# /// script
# requires-python = ">=3.10"
# ///
"""
景点旅行信息补充工具

为 spots.json 中的景点添加：
- visitDuration: 建议游览时长（分钟）
- ticketPrice: 门票价格区间（元）
- nearestStation: 最近的高铁/地铁站

基于景点分类给出合理默认值，距离计算用 Haversine 公式。

用法：
  python3 tools/enrich_travel_info.py          # 处理全部
  python3 tools/enrich_travel_info.py --dry-run # 预览不写入
"""

import json
import math
import os
import sys
from pathlib import Path

SCRIPT_DIR = Path(__file__).parent
PROJECT_ROOT = SCRIPT_DIR.parent
DATA_DIR = PROJECT_ROOT / "data"

# ── 分类对应的默认游览时长和门票 ──────────────────────────
CATEGORY_DEFAULTS = {
    "自然": {"visitDuration": [120, 240], "ticketPrice": [30, 120]},
    "历史": {"visitDuration": [90, 180], "ticketPrice": [20, 80]},
    "文化": {"visitDuration": [120, 240], "ticketPrice": [30, 80]},
    "现代": {"visitDuration": [60, 150], "ticketPrice": [0, 100]},
}

# 特殊景点的精确数据（覆盖默认值）
KNOWN_SPOTS = {
    "故宫博物院":     {"visitDuration": [180, 300], "ticketPrice": [60, 60]},
    "故宫":           {"visitDuration": [180, 300], "ticketPrice": [60, 60]},
    "长城":           {"visitDuration": [180, 300], "ticketPrice": [40, 60]},
    "八达岭长城":     {"visitDuration": [180, 240], "ticketPrice": [40, 40]},
    "慕田峪长城":     {"visitDuration": [180, 240], "ticketPrice": [45, 45]},
    "兵马俑":         {"visitDuration": [120, 180], "ticketPrice": [120, 120]},
    "秦始皇兵马俑博物馆": {"visitDuration": [120, 180], "ticketPrice": [120, 120]},
    "西湖":           {"visitDuration": [120, 240], "ticketPrice": [0, 0]},
    "外滩":           {"visitDuration": [60, 90], "ticketPrice": [0, 0]},
    "东方明珠":       {"visitDuration": [90, 120], "ticketPrice": [180, 220]},
    "上海迪士尼":     {"visitDuration": [480, 600], "ticketPrice": [475, 719]},
    "张家界国家森林公园": {"visitDuration": [360, 480], "ticketPrice": [225, 225]},
    "九寨沟":         {"visitDuration": [360, 480], "ticketPrice": [169, 250]},
    "黄山":           {"visitDuration": [480, 720], "ticketPrice": [190, 190]},
    "布达拉宫":       {"visitDuration": [90, 120], "ticketPrice": [200, 200]},
    "鼓浪屿":         {"visitDuration": [240, 360], "ticketPrice": [35, 100]},
    "峨眉山":         {"visitDuration": [360, 480], "ticketPrice": [160, 185]},
    "泰山":           {"visitDuration": [360, 480], "ticketPrice": [115, 115]},
    "华山":           {"visitDuration": [360, 480], "ticketPrice": [160, 180]},
    "颐和园":         {"visitDuration": [150, 240], "ticketPrice": [30, 30]},
    "天坛":           {"visitDuration": [120, 180], "ticketPrice": [15, 34]},
    "圆明园":         {"visitDuration": [90, 150], "ticketPrice": [10, 25]},
    "武侯祠":         {"visitDuration": [90, 120], "ticketPrice": [50, 50]},
    "杜甫草堂":       {"visitDuration": [60, 120], "ticketPrice": [50, 50]},
    "岳麓山":         {"visitDuration": [120, 180], "ticketPrice": [0, 0]},
    "橘子洲":         {"visitDuration": [90, 120], "ticketPrice": [0, 0]},
    "中山陵":         {"visitDuration": [90, 120], "ticketPrice": [0, 0]},
    "夫子庙":         {"visitDuration": [60, 120], "ticketPrice": [0, 50]},
    "洪崖洞":         {"visitDuration": [60, 120], "ticketPrice": [0, 0]},
    "广州塔":         {"visitDuration": [90, 150], "ticketPrice": [150, 228]},
    "长隆":           {"visitDuration": [360, 480], "ticketPrice": [250, 500]},
}


def haversine(c1, c2):
    """两个 [lon, lat] 坐标间的公里距离"""
    lon1, lat1 = math.radians(c1[0]), math.radians(c1[1])
    lon2, lat2 = math.radians(c2[0]), math.radians(c2[1])
    dlat, dlon = lat2 - lat1, lon2 - lon1
    a = math.sin(dlat/2)**2 + math.cos(lat1)*math.cos(lat2)*math.sin(dlon/2)**2
    return 6371 * 2 * math.asin(math.sqrt(a))


def find_nearest_station(spot_center, all_stations):
    """找最近的站点，返回 {name, distance, lineType}"""
    best = None
    best_dist = float('inf')
    for st in all_stations:
        d = haversine(spot_center, st['center'])
        if d < best_dist:
            best_dist = d
            best = {
                'name': st['name'],
                'distance': round(best_dist, 2),
                'type': st.get('type', 'hsr'),
            }
    return best


def load_json(path):
    with open(path, 'r', encoding='utf-8') as f:
        return json.load(f)


def save_json(path, data):
    with open(path, 'w', encoding='utf-8') as f:
        json.dump(data, f, ensure_ascii=False, indent=2)


def main():
    import argparse
    parser = argparse.ArgumentParser()
    parser.add_argument('--dry-run', action='store_true', help='预览不写入')
    args = parser.parse_args()

    spots = load_json(DATA_DIR / 'spots.json')
    hsr = load_json(DATA_DIR / 'hsr.json')
    metro = load_json(DATA_DIR / 'metro.json')

    # 构建站点索引
    all_stations = []
    for line in hsr:
        for s in line['stations']:
            all_stations.append({**s, 'type': 'hsr'})

    metro_by_city = {}
    for m in metro:
        city_stations = []
        for line in m['lines']:
            for s in line['stations']:
                city_stations.append({**s, 'type': 'metro', 'line': line['name']})
        metro_by_city[m['city']] = city_stations

    updated = 0
    for spot in spots:
        name = spot['name']
        category = spot.get('category', '现代')
        center = spot.get('center')

        # 游览时长和门票
        if name in KNOWN_SPOTS:
            info = KNOWN_SPOTS[name]
        else:
            info = CATEGORY_DEFAULTS.get(category, CATEGORY_DEFAULTS['现代'])

        spot['visitDuration'] = info['visitDuration']
        spot['ticketPrice'] = info['ticketPrice']

        # 最近交通站
        if center:
            city = spot.get('city', '')
            candidates = list(all_stations)
            # 加入该城市的地铁站
            if city in metro_by_city:
                candidates.extend(metro_by_city[city])

            nearest = find_nearest_station(center, candidates)
            if nearest:
                spot['nearestStation'] = nearest

        updated += 1

    print(f'已处理 {updated} 个景点')

    # 统计
    has_metro = sum(1 for s in spots if s.get('nearestStation', {}).get('type') == 'metro')
    has_hsr = sum(1 for s in spots if s.get('nearestStation', {}).get('type') == 'hsr')
    print(f'最近站: 地铁 {has_metro}, 高铁 {has_hsr}')

    # 样例输出
    for s in spots[:3]:
        ns = s.get('nearestStation', {})
        print(f"  {s['name']}: {s.get('visitDuration')} min, ¥{s.get('ticketPrice')}, 最近站: {ns.get('name','?')}({ns.get('distance','?')}km)")

    if not args.dry_run:
        save_json(DATA_DIR / 'spots.json', spots)
        print('spots.json 已更新')

        # 更新 meta.json
        from datetime import datetime
        meta_path = DATA_DIR / 'meta.json'
        if meta_path.exists():
            meta = load_json(meta_path)
        else:
            meta = {}
        meta.setdefault('datasets', {})['spots'] = {
            'updatedAt': datetime.now().isoformat(),
            'count': len(spots),
        }
        meta['updatedAt'] = datetime.now().isoformat()
        save_json(meta_path, meta)
        print('meta.json 已更新')
    else:
        print('[dry-run] 未写入文件')


if __name__ == '__main__':
    main()
