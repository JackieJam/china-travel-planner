"""
补充主要城市景点数据（手动整理，坐标为 GCJ-02 近似值）
运行后追加到 spots.json，自动去重（按 name+city 去重）
"""
import json
from pathlib import Path

NEW_SPOTS = [
    # ===== 北京 =====
    {"name": "南锣鼓巷", "city": "北京", "center": [116.403, 39.937], "category": "文化", "description": "北京最古老的街区之一，胡同文化代表，汇集各类小店和美食。"},
    {"name": "什刹海", "city": "北京", "center": [116.388, 39.942], "category": "自然", "description": "由前海、后海、西海三片水面组成的历史文化旅游风景区。"},
    {"name": "雍和宫", "city": "北京", "center": [116.417, 39.947], "category": "文化", "description": "北京市内最大的藏传佛教寺院，原为雍正帝府邸。"},
    {"name": "鸟巢·水立方", "city": "北京", "center": [116.396, 39.993], "category": "现代", "description": "2008年北京奥运会主体育场和国家游泳中心，地标性建筑。"},
    {"name": "中国国家博物馆", "city": "北京", "center": [116.404, 39.905], "category": "文化", "description": "世界上建筑面积最大的博物馆之一，藏品超140万件。"},
    {"name": "798艺术区", "city": "北京", "center": [116.495, 39.984], "category": "现代", "description": "由废弃工厂改造而成的当代艺术聚集地。"},
    {"name": "慕田峪长城", "city": "北京", "center": [116.570, 40.432], "category": "历史", "description": "万里长城精华段，植被覆盖率高，景色壮丽。"},
    {"name": "香山公园", "city": "北京", "center": [116.187, 39.992], "category": "自然", "description": "以红叶闻名的皇家园林，秋季赏红叶胜地。"},
    {"name": "景山公园", "city": "北京", "center": [116.397, 39.925], "category": "自然", "description": "可俯瞰故宫全景的最佳观景点。"},
    {"name": "恭王府", "city": "北京", "center": [116.386, 39.934], "category": "历史", "description": "清代规模最大王府花园，和珅旧宅。"},
    {"name": "前门大街", "city": "北京", "center": [116.398, 39.899], "category": "文化", "description": "北京著名商业老街，保留大量民国建筑。"},
    {"name": "国家大剧院", "city": "北京", "center": [116.383, 39.904], "category": "现代", "description": "外形如水上明珠的现代建筑，世界级表演场所。"},
    {"name": "王府井步行街", "city": "北京", "center": [116.410, 39.914], "category": "现代", "description": "北京最著名的商业街，有中华老字号聚集地之称。"},

    # ===== 上海 =====
    {"name": "外滩", "city": "上海", "center": [121.490, 31.240], "category": "历史", "description": "上海标志性景观，万国建筑博览群与陆家嘴金融区隔江相望。"},
    {"name": "东方明珠", "city": "上海", "center": [121.500, 31.240], "category": "现代", "description": "上海地标建筑，高468米的电视塔，可俯瞰浦江两岸。"},
    {"name": "豫园", "city": "上海", "center": [121.492, 31.228], "category": "历史", "description": "上海著名的古典园林，始建于明代嘉靖年间。"},
    {"name": "南京路步行街", "city": "上海", "center": [121.475, 31.236], "category": "现代", "description": "中华商业第一街，上海最繁华的购物街区。"},
    {"name": "新天地", "city": "上海", "center": [121.474, 31.220], "category": "现代", "description": "石库门里弄改造的时尚休闲区，中西文化交融。"},
    {"name": "上海博物馆", "city": "上海", "center": [121.474, 31.229], "category": "文化", "description": "中国四大博物馆之一，馆藏文物近百万件。"},
    {"name": "田子坊", "city": "上海", "center": [121.468, 31.211], "category": "文化", "description": "由老弄堂改造的创意产业园区，文艺小店聚集。"},
    {"name": "陆家嘴", "city": "上海", "center": [121.506, 31.237], "category": "现代", "description": "中国最具影响力的金融中心，上海中心大厦等超高层地标所在。"},
    {"name": "朱家角古镇", "city": "上海", "center": [121.055, 31.107], "category": "历史", "description": "上海保存最完整的江南水乡古镇。"},
    {"name": "上海迪士尼乐园", "city": "上海", "center": [121.673, 31.144], "category": "现代", "description": "中国大陆首座迪士尼主题乐园。"},

    # ===== 西安 =====
    {"name": "秦始皇兵马俑", "city": "西安", "center": [109.278, 34.384], "category": "历史", "description": "世界第八大奇迹，秦始皇陵的陪葬坑，出土数千件陶俑。"},
    {"name": "大雁塔", "city": "西安", "center": [108.961, 34.218], "category": "历史", "description": "唐代玄奘法师翻译佛经之所，西安标志性建筑。"},
    {"name": "华清宫", "city": "西安", "center": [109.213, 34.367], "category": "历史", "description": "唐代皇家园林，以温泉和长恨歌演出闻名。"},
    {"name": "西安城墙", "city": "西安", "center": [108.940, 34.260], "category": "历史", "description": "中国现存规模最大、保存最完整的古城墙。"},
    {"name": "钟鼓楼", "city": "西安", "center": [108.943, 34.261], "category": "历史", "description": "西安市中心地标，明代建筑，晨钟暮鼓。"},
    {"name": "回民街", "city": "西安", "center": [108.939, 34.264], "category": "文化", "description": "西安最著名的美食文化街区，汇集西北特色小吃。"},
    {"name": "陕西历史博物馆", "city": "西安", "center": [108.952, 34.226], "category": "文化", "description": "中国第一座大型现代化博物馆，馆藏文物37万余件。"},
    {"name": "大明宫国家遗址公园", "city": "西安", "center": [108.960, 34.300], "category": "历史", "description": "唐代皇宫遗址，面积是故宫的4.5倍。"},
    {"name": "碑林博物馆", "city": "西安", "center": [108.941, 34.253], "category": "文化", "description": "收藏中国古代碑石时间最早、数目最大的艺术宝库。"},
    {"name": "永兴坊", "city": "西安", "center": [108.960, 34.270], "category": "文化", "description": "非遗美食文化街区，汇集陕西各地市特色美食。"},

    # ===== 成都 =====
    {"name": "武侯祠", "city": "成都", "center": [104.049, 30.645], "category": "历史", "description": "纪念诸葛亮的祠堂，与刘备惠陵、汉昭烈庙合一。"},
    {"name": "锦里", "city": "成都", "center": [104.048, 30.644], "category": "文化", "description": "武侯祠旁的古街，西蜀历史上最古老的商业街区之一。"},
    {"name": "杜甫草堂", "city": "成都", "center": [104.034, 30.663], "category": "历史", "description": "诗圣杜甫流寓成都时的故居，园林清幽。"},
    {"name": "大熊猫繁育研究基地", "city": "成都", "center": [104.145, 30.734], "category": "自然", "description": "全球最大的大熊猫人工繁育基地。"},
    {"name": "宽窄巷子", "city": "成都", "center": [104.054, 30.670], "category": "文化", "description": "成都三大历史文化名城保护街区之一，清朝古街道。"},
    {"name": "都江堰", "city": "成都", "center": [103.647, 31.005], "category": "历史", "description": "世界文化遗产，公元前256年建造的无坝引水工程。"},
    {"name": "青城山", "city": "成都", "center": [103.573, 30.900], "category": "自然", "description": "中国道教发源地之一，世界文化遗产，林木葱翠。"},
    {"name": "春熙路", "city": "成都", "center": [104.080, 30.657], "category": "现代", "description": "成都最繁华的商业中心，中西部最大的商业街区。"},
    {"name": "人民公园", "city": "成都", "center": [104.057, 30.660], "category": "文化", "description": "成都最具生活气息的公园，鹤鸣茶社喝盖碗茶。"},

    # ===== 广州 =====
    {"name": "广州塔", "city": "广州", "center": [113.325, 23.106], "category": "现代", "description": "昵称小蛮腰，广州地标建筑，高600米。"},
    {"name": "陈家祠", "city": "广州", "center": [113.246, 23.129], "category": "历史", "description": "清代宗祠建筑巅峰之作，岭南建筑艺术明珠。"},
    {"name": "白云山", "city": "广州", "center": [113.296, 23.190], "category": "自然", "description": "广州最高峰，南粤名山之一，风景秀丽。"},
    {"name": "沙面岛", "city": "广州", "center": [113.237, 23.111], "category": "历史", "description": "欧式建筑群，曾是英法租界，异域风情浓厚。"},
    {"name": "越秀公园", "city": "广州", "center": [113.271, 23.142], "category": "自然", "description": "广州最大公园，五羊雕像所在地。"},
    {"name": "北京路步行街", "city": "广州", "center": [113.264, 23.123], "category": "现代", "description": "广州最繁华的商业街，地下有千年古道遗址。"},
    {"name": "长隆旅游度假区", "city": "广州", "center": [113.330, 22.996], "category": "现代", "description": "集主题公园、水上乐园、野生动物世界于一体的旅游胜地。"},
    {"name": "中山纪念堂", "city": "广州", "center": [113.267, 23.133], "category": "历史", "description": "纪念孙中山先生的标志性建筑，八角形宫殿式建筑。"},
    {"name": "广东省博物馆", "city": "广州", "center": [113.323, 23.116], "category": "文化", "description": "外形如宝盒的现代化博物馆，馆藏丰富。"},

    # ===== 武汉 =====
    {"name": "黄鹤楼", "city": "武汉", "center": [114.302, 30.549], "category": "历史", "description": "江南三大名楼之首，始建于三国时期。"},
    {"name": "武汉大学", "city": "武汉", "center": [114.363, 30.537], "category": "文化", "description": "中国最美大学校园之一，樱花季闻名全国。"},
    {"name": "东湖", "city": "武汉", "center": [114.380, 30.560], "category": "自然", "description": "中国最大的城中湖，面积是西湖的6倍。"},
    {"name": "户部巷", "city": "武汉", "center": [114.300, 30.552], "category": "文化", "description": "武汉著名小吃街，热干面、豆皮等汉味小吃聚集地。"},
    {"name": "湖北省博物馆", "city": "武汉", "center": [114.366, 30.561], "category": "文化", "description": "藏有越王勾践剑、曾侯乙编钟等国宝级文物。"},
    {"name": "江汉路步行街", "city": "武汉", "center": [114.289, 30.577], "category": "现代", "description": "中国最长的步行街，近代建筑群保存完好。"},
    {"name": "晴川阁", "city": "武汉", "center": [114.278, 30.557], "category": "历史", "description": "与黄鹤楼隔江相望，晴川历历汉阳树。"},
    {"name": "楚河汉街", "city": "武汉", "center": [114.342, 30.555], "category": "现代", "description": "世界级城市商业文化旅游步行街。"},
    {"name": "古琴台", "city": "武汉", "center": [114.272, 30.557], "category": "历史", "description": "伯牙鼓琴遇知音的典故发源地。"},

    # ===== 杭州 =====
    {"name": "西湖", "city": "杭州", "center": [120.148, 30.246], "category": "自然", "description": "世界文化遗产，中国十大风景名胜之一。"},
    {"name": "灵隐寺", "city": "杭州", "center": [120.101, 30.243], "category": "历史", "description": "中国佛教禅宗十大古刹之一，始建于东晋。"},
    {"name": "雷峰塔", "city": "杭州", "center": [120.149, 30.232], "category": "历史", "description": "白蛇传传说发源地，西湖南岸标志性建筑。"},
    {"name": "西溪湿地", "city": "杭州", "center": [120.060, 30.267], "category": "自然", "description": "国家湿地公园，城市中的天然湿地。"},
    {"name": "宋城", "city": "杭州", "center": [120.122, 30.187], "category": "文化", "description": "大型宋文化主题公园，宋城千古情演出驰名全国。"},
    {"name": "河坊街", "city": "杭州", "center": [120.168, 30.248], "category": "文化", "description": "杭州保存最完整的旧时商业街，明清风格。"},
    {"name": "良渚古城遗址", "city": "杭州", "center": [120.000, 30.405], "category": "历史", "description": "世界文化遗产，中华五千年文明史的实证。"},
    {"name": "千岛湖", "city": "杭州", "center": [118.970, 29.590], "category": "自然", "description": "1078个岛屿组成的人造湖，水质清澈，风景如画。"},
    {"name": "断桥残雪", "city": "杭州", "center": [120.155, 30.260], "category": "自然", "description": "西湖十景之一，白娘子与许仙相会之处。"},

    # ===== 南京 =====
    {"name": "中山陵", "city": "南京", "center": [118.856, 32.063], "category": "历史", "description": "孙中山先生陵寝，中国近代建筑史上的经典之作。"},
    {"name": "夫子庙", "city": "南京", "center": [118.787, 32.022], "category": "历史", "description": "秦淮河畔的文化圣地，中国四大文庙之一。"},
    {"name": "明孝陵", "city": "南京", "center": [118.838, 32.060], "category": "历史", "description": "世界文化遗产，明太祖朱元璋与马皇后合葬陵墓。"},
    {"name": "玄武湖", "city": "南京", "center": [118.797, 32.078], "category": "自然", "description": "中国最大的皇家园林湖泊，与钟山风景区相连。"},
    {"name": "总统府", "city": "南京", "center": [118.787, 32.045], "category": "历史", "description": "中国近代史博物馆，见证太平天国到民国历史。"},
    {"name": "南京博物院", "city": "南京", "center": [118.812, 32.045], "category": "文化", "description": "中国三大博物馆之一，前身是国立中央博物院。"},
    {"name": "鸡鸣寺", "city": "南京", "center": [118.794, 32.062], "category": "历史", "description": "南京最古老的梵刹之一，樱花季尤为出名。"},
    {"name": "秦淮河", "city": "南京", "center": [118.788, 32.025], "category": "文化", "description": "南京母亲河，十里秦淮风光带夜景璀璨。"},
    {"name": "雨花台", "city": "南京", "center": [118.773, 31.989], "category": "历史", "description": "革命烈士陵园和风景名胜区，雨花石产地。"},

    # ===== 重庆 =====
    {"name": "洪崖洞", "city": "重庆", "center": [106.579, 29.563], "category": "现代", "description": "11层吊脚楼建筑群，夜景酷似千与千寻，重庆地标。"},
    {"name": "解放碑", "city": "重庆", "center": [106.577, 29.558], "category": "历史", "description": "全国唯一纪念抗日战争胜利的纪念碑，商业中心地标。"},
    {"name": "磁器口古镇", "city": "重庆", "center": [106.448, 29.580], "category": "历史", "description": "千年古镇，巴渝文化缩影，小重庆之称。"},
    {"name": "长江索道", "city": "重庆", "center": [106.585, 29.556], "category": "现代", "description": "横跨长江的空中索道，体验山城立体交通的独特方式。"},
    {"name": "大足石刻", "city": "重庆", "center": [105.700, 29.700], "category": "历史", "description": "世界文化遗产，唐宋石刻艺术的代表。"},
    {"name": "武隆天生三桥", "city": "重庆", "center": [107.750, 29.350], "category": "自然", "description": "世界自然遗产，三座天然石拱桥组成的喀斯特地貌奇观。"},
    {"name": "鹅岭公园", "city": "重庆", "center": [106.539, 29.560], "category": "自然", "description": "可360度俯瞰重庆两江风光的城市制高点。"},
    {"name": "三峡博物馆", "city": "重庆", "center": [106.543, 29.560], "category": "文化", "description": "展示三峡文化和重庆历史的综合性博物馆。"},
    {"name": "朝天门", "city": "重庆", "center": [106.587, 29.567], "category": "历史", "description": "嘉陵江与长江交汇处，重庆古城门之一。"},

    # ===== 深圳 =====
    {"name": "世界之窗", "city": "深圳", "center": [113.974, 22.535], "category": "现代", "description": "汇集世界著名景观缩微模型的主题公园。"},
    {"name": "东部华侨城", "city": "深圳", "center": [114.305, 22.616], "category": "自然", "description": "集休闲度假、户外运动、生态体验于一体的旅游度假区。"},
    {"name": "深圳湾公园", "city": "深圳", "center": [113.990, 22.503], "category": "自然", "description": "沿海休闲带，观鸟胜地，可远眺香港。"},
    {"name": "莲花山公园", "city": "深圳", "center": [114.059, 22.555], "category": "自然", "description": "深圳市中心最大公园，山顶广场可俯瞰深圳全景。"},
    {"name": "仙湖植物园", "city": "深圳", "center": [114.177, 22.570], "category": "自然", "description": "集植物收集、研究与观赏为一体的植物园，弘法寺所在。"},
    {"name": "华侨城创意文化园", "city": "深圳", "center": [113.986, 22.540], "category": "现代", "description": "由旧工业区改造的创意园区，深圳798。"},
    {"name": "大鹏古城", "city": "深圳", "center": [114.497, 22.590], "category": "历史", "description": "深圳唯一的国家级重点文物保护单位，明清海防要塞。"},
    {"name": "锦绣中华", "city": "深圳", "center": [113.984, 22.534], "category": "文化", "description": "中国第一个荟萃各民族民艺、民俗的主题公园。"},
    {"name": "大梅沙海滨公园", "city": "深圳", "center": [114.307, 22.598], "category": "自然", "description": "深圳最长的海滩，沙质细白，海水清澈。"},

    # ===== 长沙 =====
    {"name": "岳麓山", "city": "长沙", "center": [112.938, 28.186], "category": "自然", "description": "南岳衡山七十二峰的最后一峰，岳麓书院所在地。"},
    {"name": "橘子洲", "city": "长沙", "center": [112.973, 28.187], "category": "现代", "description": "湘江中央的长岛，毛泽东青年雕像所在地。"},
    {"name": "太平街", "city": "长沙", "center": [112.975, 28.197], "category": "文化", "description": "长沙保留最完整的古街，贾谊故居所在地。"},

    # ===== 沈阳 =====
    {"name": "沈阳故宫", "city": "沈阳", "center": [123.450, 41.796], "category": "历史", "description": "中国仅存的两大宫殿建筑群之一，清太祖努尔哈赤皇宫。"},
    {"name": "张氏帅府", "city": "沈阳", "center": [123.454, 41.793], "category": "历史", "description": "张学良旧居，东北近代史缩影。"},
]

def main():
    spots_path = Path(__file__).parent.parent / "data" / "spots.json"
    with open(spots_path) as f:
        existing = json.load(f)

    # Build set of existing keys (name + city)
    existing_keys = {(s["name"], s["city"]) for s in existing}

    added = []
    skipped = []
    for spot in NEW_SPOTS:
        key = (spot["name"], spot["city"])
        if key in existing_keys:
            skipped.append(spot["name"])
        else:
            # Fill optional fields with defaults
            spot.setdefault("image", None)
            spot.setdefault("images", [])
            existing.append(spot)
            existing_keys.add(key)
            added.append(f"{spot['city']}-{spot['name']}")

    with open(spots_path, "w") as f:
        json.dump(existing, f, ensure_ascii=False, indent=2)

    print(f"新增: {len(added)} 个景点")
    for a in added:
        print(f"  + {a}")
    if skipped:
        print(f"跳过(已存在): {len(skipped)} 个")
        for s in skipped:
            print(f"  - {s}")

    # Show updated counts
    from collections import Counter
    counts = Counter(s["city"] for s in existing)
    print(f"\n更新后各城市景点数:")
    for city, count in counts.most_common():
        print(f"  {city}: {count}")
    print(f"总计: {len(existing)} 个景点")


if __name__ == "__main__":
    main()
