#!/usr/bin/env python3
"""
景点数据增强工具 - 全国交通旅游地图

功能：
  从中文维基百科和 Wikimedia Commons 获取景点描述和图片，
  丰富 spots.json 中的 description 和 image 字段。

用法：
  python3 tools/enrich_spots.py                     # 增强所有景点
  python3 tools/enrich_spots.py --dry-run            # 预览，不保存
  python3 tools/enrich_spots.py --spot 故宫博物院     # 增强单个景点

依赖：
  pip install requests
"""

import argparse
import json
import shutil
import sys
import time
from pathlib import Path
from urllib.parse import quote

try:
    import requests
except ImportError:
    print("请先安装 requests: pip install requests")
    sys.exit(1)

# 项目路径
DATA_DIR = Path(__file__).parent.parent / "data"
SPOTS_FILE = DATA_DIR / "spots.json"
BACKUP_FILE = DATA_DIR / "spots_backup.json"

# API 端点
WIKI_SUMMARY_API = "https://zh.wikipedia.org/api/rest_v1/page/summary/{title}"
COMMONS_SEARCH_API = "https://commons.wikimedia.org/w/api.php"

# 请求头：标识脚本身份，符合 Wikimedia API 礼仪规范
HEADERS = {
    "User-Agent": "MetroMapEnrichBot/1.0 (https://github.com/example/metro-map; educational project)"
}

# 请求间隔（秒），避免过于频繁调用
REQUEST_INTERVAL = 1.0


def load_spots():
    """读取 spots.json"""
    if not SPOTS_FILE.exists():
        print(f"错误：找不到 {SPOTS_FILE}")
        sys.exit(1)
    with open(SPOTS_FILE, "r", encoding="utf-8") as f:
        return json.load(f)


def save_spots(spots):
    """保存 spots.json"""
    with open(SPOTS_FILE, "w", encoding="utf-8") as f:
        json.dump(spots, f, ensure_ascii=False, indent=2)
    print(f"已保存到 {SPOTS_FILE} ({len(spots)} 条记录)")


def create_backup():
    """创建 spots.json 的备份"""
    if SPOTS_FILE.exists():
        shutil.copy2(SPOTS_FILE, BACKUP_FILE)
        print(f"已创建备份: {BACKUP_FILE}")


def fetch_wiki_description(name):
    """
    从中文维基百科获取景点描述。

    返回 2-3 句描述文本，失败时返回 None。
    会尝试多种标题形式：原名、加城市后缀等。
    """
    # 维基百科页面标题可能与景点名不完全一致，尝试多种变体
    title_variants = _generate_wiki_titles(name)

    for title in title_variants:
        encoded_title = quote(title, safe="")
        url = WIKI_SUMMARY_API.format(title=encoded_title)

        try:
            resp = requests.get(url, headers=HEADERS, timeout=10)
            if resp.status_code == 200:
                data = resp.json()
                extract = data.get("extract", "").strip()
                if extract and len(extract) > 20:
                    return extract
            # 404 说明该标题不存在，尝试下一个变体
            elif resp.status_code != 404:
                print(f"  Wikipedia API 返回 {resp.status_code}: {title}")
        except requests.RequestException as e:
            print(f"  Wikipedia 请求失败 ({title}): {e}")

        time.sleep(REQUEST_INTERVAL)

    return None


def _generate_wiki_titles(name):
    """
    生成可能的维基百科标题变体。

    例如 "故宫博物院" -> ["故宫博物院", "北京故宫"]
    "故宫沈阳" -> ["故宫沈阳", "沈阳故宫"]
    """
    titles = [name]

    # 特殊映射：部分景点名与维基百科标题不一致
    special_mappings = {
        "故宫博物院": ["故宫博物院", "故宫", "北京故宫"],
        "故宫沈阳": ["沈阳故宫"],
        "大熊猫基地": ["成都大熊猫繁育研究基地", "大熊猫繁育研究基地"],
        "秦始皇兵马俑": ["秦始皇兵马俑", "秦始皇陵兵马俑", "兵马俑"],
        "城墙": ["西安城墙", "西安府城墙"],
        "冰雪大世界": ["哈尔滨冰雪大世界", "哈尔滨国际冰雪节"],
        "解放碑": ["解放碑 (重庆)", "重庆解放碑", "人民解放纪念碑"],
        "洪崖洞": ["洪崖洞", "洪崖洞民俗风貌区"],
        "橘子洲": ["橘子洲", "橘子洲头"],
        "回民街": ["回民街", "西安回民街", "回坊"],
        "户部巷": ["户部巷", "武汉户部巷"],
        "锦里": ["锦里", "锦里古街"],
        "宽窄巷子": ["宽窄巷子", "成都宽窄巷子"],
        "磁器口": ["磁器口古镇", "磁器口 (重庆)"],
        "三坊七巷": ["三坊七巷", "福州三坊七巷"],
        "世界之窗": ["世界之窗 (深圳)", "深圳世界之窗"],
        "东部华侨城": ["东部华侨城", "深圳东部华侨城"],
        "武隆天坑": ["武隆天生三桥", "天生三桥", "武隆喀斯特"],
        "中央大街": ["中央大街", "哈尔滨中央大街"],
        "河坊街": ["河坊街", "杭州河坊街", "清河坊"],
        "翠湖": ["翠湖 (昆明)", "昆明翠湖"],
        "天涯海角": ["天涯海角", "天涯海角风景区"],
    }

    if name in special_mappings:
        return special_mappings[name]

    return titles


def fetch_commons_image(name):
    """
    从 Wikimedia Commons 搜索景点图片并获取图片 URL。

    分两步：
      1. 搜索匹配的图片文件标题
      2. 通过 imageinfo API 获取实际 URL

    返回图片 URL 字符串，失败时返回 None。
    """
    # 第一步：搜索图片
    search_url = COMMONS_SEARCH_API
    params = {
        "action": "query",
        "list": "search",
        "srsearch": name,
        "srnamespace": "6",  # File 命名空间
        "srlimit": 1,
        "format": "json",
    }

    try:
        resp = requests.get(search_url, params=params, headers=HEADERS, timeout=10)
        resp.raise_for_status()
        data = resp.json()
    except requests.RequestException as e:
        print(f"  Commons 搜索请求失败 ({name}): {e}")
        return None

    time.sleep(REQUEST_INTERVAL)

    results = data.get("query", {}).get("search", [])
    if not results:
        return None

    file_title = results[0].get("title", "")
    if not file_title:
        return None

    # 第二步：获取图片 URL
    info_params = {
        "action": "query",
        "titles": file_title,
        "prop": "imageinfo",
        "iiprop": "url",
        "format": "json",
    }

    try:
        resp = requests.get(search_url, params=info_params, headers=HEADERS, timeout=10)
        resp.raise_for_status()
        data = resp.json()
    except requests.RequestException as e:
        print(f"  Commons imageinfo 请求失败 ({file_title}): {e}")
        return None

    time.sleep(REQUEST_INTERVAL)

    # 从嵌套结构中提取 URL
    pages = data.get("query", {}).get("pages", {})
    for page_id, page_data in pages.items():
        imageinfo_list = page_data.get("imageinfo", [])
        if imageinfo_list:
            return imageinfo_list[0].get("url")

    return None


def enrich_spot(spot, dry_run=False):
    """
    增强单个景点数据。

    获取维基百科描述和 Wikimedia 图片 URL，更新到 spot 字典中。
    返回 (description_updated, image_updated) 布尔元组。
    """
    name = spot["name"]
    desc_updated = False
    img_updated = False

    print(f"\n处理: {name} ({spot.get('city', '')})")

    # 获取维基百科描述
    print(f"  查询维基百科描述...")
    wiki_desc = fetch_wiki_description(name)
    if wiki_desc:
        old_desc = spot.get("description", "")
        # 仅当维基百科内容更丰富时才替换（长度显著更长）
        if len(wiki_desc) > len(old_desc) + 10:
            spot["description"] = wiki_desc
            desc_updated = True
            if dry_run:
                preview = wiki_desc[:80] + ("..." if len(wiki_desc) > 80 else "")
                print(f"  [描述] 旧: {old_desc[:50]}...")
                print(f"  [描述] 新: {preview}")
            else:
                print(f"  [描述] 已更新 ({len(wiki_desc)} 字)")
        else:
            print(f"  [描述] 现有描述已足够详细，跳过")
    else:
        print(f"  [描述] 未找到维基百科条目")

    # 获取 Wikimedia 图片
    print(f"  查询 Wikimedia 图片...")
    image_url = fetch_commons_image(name)
    if image_url:
        spot["image"] = image_url
        img_updated = True
        if dry_run:
            print(f"  [图片] {image_url[:80]}...")
        else:
            print(f"  [图片] 已添加")
    else:
        print(f"  [图片] 未找到相关图片")

    return desc_updated, img_updated


def main():
    parser = argparse.ArgumentParser(
        description="景点数据增强 - 从维基百科和 Wikimedia Commons 丰富景点描述和图片"
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="预览模式，不保存更改",
    )
    parser.add_argument(
        "--spot",
        type=str,
        help="仅增强指定名称的景点",
    )

    args = parser.parse_args()

    # 读取数据
    spots = load_spots()
    print(f"已加载 {len(spots)} 个景点")

    if args.dry_run:
        print("=== 预览模式 (dry-run)，不会保存更改 ===")

    # 确定要处理的景点
    if args.spot:
        targets = [s for s in spots if s["name"] == args.spot]
        if not targets:
            print(f"错误：找不到名为 '{args.spot}' 的景点")
            print("可用景点:")
            for s in spots:
                print(f"  - {s['name']} ({s['city']})")
            sys.exit(1)
    else:
        # 过滤掉已有丰富描述和图片的景点，只处理需要增强的
        targets = [
            s for s in spots
            if not s.get("image")  # 没有图片的优先处理
            or len(s.get("description", "")) < 30  # 描述过于简短的也处理
        ]
        if not targets:
            print("所有景点数据已完善，无需增强")
            return

    print(f"待处理: {len(targets)} 个景点")

    # 非预览模式下先创建备份
    if not args.dry_run:
        create_backup()

    # 逐个增强
    desc_count = 0
    img_count = 0

    for i, spot in enumerate(targets):
        print(f"\n[{i + 1}/{len(targets)}]", end="")
        desc_ok, img_ok = enrich_spot(spot, dry_run=args.dry_run)
        if desc_ok:
            desc_count += 1
        if img_ok:
            img_count += 1

    # 汇总
    print(f"\n{'=' * 50}")
    print(f"处理完成: {len(targets)} 个景点")
    print(f"  描述更新: {desc_count} 个")
    print(f"  图片添加: {img_count} 个")

    # 保存（非预览模式）
    if not args.dry_run and (desc_count > 0 or img_count > 0):
        save_spots(spots)
    elif args.dry_run:
        print(f"\n预览模式，未保存。去掉 --dry-run 以应用更改。")
    else:
        print("无变更，无需保存。")


if __name__ == "__main__":
    main()
