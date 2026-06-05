/**
 * 全国交通旅游地图 - 主应用逻辑
 * 
 * 核心模块：
 *   MapManager    - 高德地图初始化与视图控制
 *   DataManager   - JSON 数据加载与查询
 *   LayerManager  - 高铁/地铁/景点图层管理
 *   UIController  - 侧边栏、搜索、详情面板
 */

// ==================== Map Manager ====================
const MapManager = {
  map: null,
  currentZoom: 4.5,

  init(container) {
    this.map = new AMap.Map(container, {
      zoom: 4.5,
      center: [108, 36],
      viewMode: '2D',
      mapStyle: 'amap://styles/normal',
      resizeEnable: true,
      zooms: [3, 18],
    });

    this.map.on('zoomchange', () => {
      this.currentZoom = this.map.getZoom();
      UIController.updateZoomLevel(this.currentZoom);
      LayerManager.onZoomChange(this.currentZoom);
    });

    this.map.on('click', (e) => {
      // 点击空白处关闭详情面板
      if (!e.target || e.target === this.map) {
        UIController.hideDetail();
      }
    });

    this.loadProvinceBorders();
  },

  flyTo(center, zoom) {
    this.map.setZoomAndCenter(zoom, center, false, 600);
  },

  fitBounds(bounds) {
    this.map.setBounds(bounds, false, [60, 60, 60, 60]);
  },

  // 纯净模式：隐藏底图杂项，只保留省界/水系/自定义覆盖物
  _cleanMode: false,
  _provinceBorders: [],
  _provinceLabels: [],

  toggleCleanMode() {
    if (this._cleanMode) {
      // 恢复标准模式
      this.map.setFeatures(['bg', 'road', 'building', 'point']);
      this._cleanMode = false;
    } else {
      // 纯净模式：只显示背景（含省界、水系）
      this.map.setFeatures(['bg']);
      this._cleanMode = true;
    }

    // Show/hide station labels
    LayerManager.setStationLabelsVisible(this._cleanMode);

    // Show/hide province borders
    this._provinceBorders.forEach(o => {
      if (this._cleanMode) o.show(); else o.hide();
    });
    this._provinceLabels.forEach(o => {
      if (this._cleanMode) o.show(); else o.hide();
    });

    return this._cleanMode;
  },

  async loadProvinceBorders() {
    try {
      const resp = await fetch('https://geo.datav.aliyun.com/areas_v3/bound/100000_full.json');
      if (!resp.ok) return;
      const geojson = await resp.json();

      this._provinceBorders = [];
      this._provinceLabels = [];

      const features = geojson.features || [];
      for (const feature of features) {
        const name = feature.properties.name;
        const center = feature.properties.center || feature.properties.centroid;
        const geometry = feature.geometry;

        // Draw province boundaries as polylines
        if (geometry.type === 'Polygon') {
          this._drawPolygon(geometry.coordinates, name, center);
        } else if (geometry.type === 'MultiPolygon') {
          for (const polygon of geometry.coordinates) {
            this._drawPolygon(polygon, name, center);
          }
        }
      }

      // Initially hidden
      this._provinceBorders.forEach(o => o.hide());
      this._provinceLabels.forEach(o => o.hide());
    } catch (e) {
      console.warn('省界数据加载失败:', e);
    }
  },

  _drawPolygon(coordinates, name, center) {
    const map = this.map;

    // coordinates is array of rings, first ring is outer boundary
    for (const ring of coordinates) {
      const path = ring.map(coord => new AMap.LngLat(coord[0], coord[1]));
      if (path.length < 3) continue;

      const polygon = new AMap.Polygon({
        path: path,
        strokeColor: '#999',
        strokeWeight: 1.5,
        strokeOpacity: 0.7,
        fillColor: 'transparent',
        fillOpacity: 0,
        zIndex: 5,
      });

      map.add(polygon);
      this._provinceBorders.push(polygon);
    }

    // Province name label
    if (center) {
      const label = new AMap.Text({
        text: name,
        position: [center[0], center[1]],
        style: {
          'font-size': '12px',
          'color': '#666',
          'background-color': 'transparent',
          'border': 'none',
          'padding': '0',
          'font-weight': '400',
        },
        zIndex: 4,
      });
      map.add(label);
      this._provinceLabels.push(label);
    }
  },
};

// ==================== Data Manager ====================
const DataManager = {
  cities: [],
  hsr: [],
  metro: [],
  spots: [],
  trains: [],

  async loadAll() {
    const overlay = document.getElementById('loading-overlay');
    UIController.setStatus('加载数据中…');
    try {
      const [cities, hsr, metro, spots] = await Promise.all([
        this._fetch('data/cities.json'),
        this._fetch('data/hsr.json'),
        this._fetch('data/metro.json'),
        this._fetch('data/spots.json'),
      ]);
      this.cities = cities;
      this.hsr = hsr;
      this.metro = metro;
      this.spots = spots;

      if (overlay) overlay.style.display = 'none';

      UIController.setStatus(`已加载 ${cities.length} 城市, ${hsr.length} 高铁线, ${metro.length} 城市地铁, ${spots.length} 景点`);

      // 车次数据懒加载：首次访问站点时按需拉取
      this._trainsLoaded = false;
    } catch (err) {
      console.error('数据加载失败:', err);
      UIController.setStatus('数据加载失败，请检查 JSON 文件');
      if (overlay) overlay.style.display = 'none';
    }
  },

  async loadTrains() {
    if (this._trainsLoaded) return;
    this._trainsLoaded = true;
    UIController.setStatus('加载车次数据…');
    try {
      this.trains = await this._fetch('data/trains.json');
      UIController.setStatus(`车次加载完成: ${this.trains.length} 条`);
    } catch (e) {
      console.warn('车次数据加载失败（可忽略）:', e);
      this.trains = [];
    }
  },

  meta: null,

  async loadMeta() {
    try {
      this.meta = await this._fetch('data/meta.json');
    } catch (e) {
      this.meta = null;
    }
  },

  getDataFreshnessText() {
    if (!this.meta || !this.meta.updatedAt) return '';
    const d = new Date(this.meta.updatedAt);
    const now = new Date();
    const days = Math.floor((now - d) / 86400000);
    if (days === 0) return '数据今日更新';
    if (days < 30) return `数据更新于 ${days} 天前`;
    const months = Math.floor(days / 30);
    return `数据更新于 ${months} 个月前`;
  },

  async _fetch(url) {
    const resp = await fetch(url);
    if (!resp.ok) throw new Error(`${url}: ${resp.status}`);
    return resp.json();
  },

  getCity(name) {
    return this.cities.find(c => c.name === name || c.name.startsWith(name));
  },

  searchCities(query) {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    return this.cities.filter(c =>
      c.name.toLowerCase().includes(q) ||
      (c.province && c.province.toLowerCase().includes(q))
    ).slice(0, 10);
  },

  getCityHSR(cityName) {
    return this.hsr.filter(line =>
      line.stations.some(s => s.name === cityName || s.name.includes(cityName))
    );
  },

  getCityMetro(cityName) {
    return this.metro.find(m => m.city === cityName);
  },

  getCitySpots(cityName) {
    return this.spots.filter(s => s.city === cityName);
  },

  getStationTrains(stationName) {
    if (!this.trains || !this.trains.length) return [];
    return this.trains.filter(t =>
      t.route.some(s => s.station === stationName || s.station.includes(stationName))
    );
  },

  getTrainByNumber(number) {
    if (!this.trains || !this.trains.length) return null;
    return this.trains.find(t => t.number === number);
  },

  // ---- Route Query ----

  /**
   * 查询两城市之间的车次
   * @param {string} fromCity 出发城市名
   * @param {string} toCity 到达城市名
   * @returns {{ direct: Array, transfer: Array }}
   */
  queryRoutes(fromCity, toCity) {
    if (!this.trains || !this.trains.length) return { direct: [], transfer: [] };

    const direct = this._findDirectTrains(fromCity, toCity);
    const transfer = direct.length < 5
      ? this._findTransferRoutes(fromCity, toCity, direct)
      : [];

    return { direct, transfer };
  },

  /**
   * 获取一个城市关联的所有高铁站名
   */
  getCityStationNames(cityName) {
    const names = new Set();
    // From hsr.json: stations whose name starts with city name
    this.hsr.forEach(line => {
      line.stations.forEach(s => {
        if (s.name === cityName || s.name.startsWith(cityName)) {
          names.add(s.name);
        }
      });
    });
    return [...names];
  },

  _findDirectTrains(fromCity, toCity) {
    const fromStations = this.getCityStationNames(fromCity);
    const toStations = this.getCityStationNames(toCity);
    if (!fromStations.length || !toStations.length) return [];

    const results = [];
    for (const train of this.trains) {
      const stops = train.route.filter(s => s.arrive || s.depart);
      let fromIdx = -1, toIdx = -1;

      for (let i = 0; i < stops.length; i++) {
        const sn = stops[i].station;
        if (fromIdx === -1 && fromStations.some(fs => sn === fs || sn.startsWith(fs.replace('市', '')))) {
          fromIdx = i;
        }
        if (toStations.some(ts => sn === ts || sn.startsWith(ts.replace('市', '')))) {
          toIdx = i;
        }
      }

      if (fromIdx >= 0 && toIdx > fromIdx) {
        const fromStop = stops[fromIdx];
        const toStop = stops[toIdx];
        const depart = fromStop.depart || fromStop.arrive;
        const arrive = toStop.arrive || toStop.depart;

        results.push({
          train: train,
          fromStation: fromStop.station,
          toStation: toStop.station,
          depart,
          arrive,
          duration: this._calcDuration(depart, arrive),
          stops: toIdx - fromIdx,
        });
      }
    }

    // Sort by departure time
    results.sort((a, b) => (a.depart || '').localeCompare(b.depart || ''));
    return results;
  },

  _findTransferRoutes(fromCity, toCity, directResults) {
    const fromStations = this.getCityStationNames(fromCity);
    const toStations = this.getCityStationNames(toCity);
    const directKeys = new Set(directResults.map(r => r.train.number));

    // Build index: station -> trains passing through
    const stationIndex = {};
    for (const train of this.trains) {
      for (const stop of train.route) {
        if (!stop.arrive && !stop.depart) continue;
        if (!stationIndex[stop.station]) stationIndex[stop.station] = [];
        stationIndex[stop.station].push({ train, stop });
      }
    }

    const transfers = [];

    for (const train1 of this.trains) {
      const stops1 = train1.route.filter(s => s.arrive || s.depart);
      // Find boarding stop at fromCity
      let boardIdx = -1;
      for (let i = 0; i < stops1.length; i++) {
        if (fromStations.some(fs => stops1[i].station === fs || stops1[i].station.startsWith(fs.replace('市', '')))) {
          boardIdx = i;
          break;
        }
      }
      if (boardIdx < 0) continue;

      // For each possible transfer station on train1
      for (let i = boardIdx + 1; i < stops1.length; i++) {
        const transferStation = stops1[i].station;
        // Skip if transfer station is already at toCity
        if (toStations.some(ts => transferStation === ts || transferStation.startsWith(ts.replace('市', '')))) continue;

        const transfersHere = stationIndex[transferStation];
        if (!transfersHere) continue;

        for (const { train: train2, stop: t2stop } of transfersHere) {
          if (train2.number === train1.number) continue;
          if (directKeys.has(train2.number)) continue;

          const stops2 = train2.route.filter(s => s.arrive || s.depart);
          const transferIdx2 = stops2.findIndex(s => s.station === transferStation);
          if (transferIdx2 < 0) continue;

          // Find arrival at toCity on train2
          let arriveIdx = -1;
          for (let j = transferIdx2 + 1; j < stops2.length; j++) {
            if (toStations.some(ts => stops2[j].station === ts || stops2[j].station.startsWith(ts.replace('市', '')))) {
              arriveIdx = j;
              break;
            }
          }
          if (arriveIdx < 0) continue;

          const depart1 = stops1[boardIdx].depart || stops1[boardIdx].arrive;
          const arrive1 = stops1[i].arrive || stops1[i].depart;
          const depart2 = t2stop.depart || t2stop.arrive;
          const arrive2 = stops2[arriveIdx].arrive || stops2[arriveIdx].depart;

          // Transfer wait time (must be positive, i.e. train2 departs after train1 arrives)
          const waitMin = this._calcDuration(arrive1, depart2);
          if (waitMin < 20 || waitMin > 300) continue; // 20min ~ 5hr transfer window

          const leg1 = this._calcDuration(depart1, arrive1);
          const leg2 = this._calcDuration(depart2, arrive2);

          transfers.push({
            train1, train2,
            fromStation: stops1[boardIdx].station,
            transferStation,
            toStation: stops2[arriveIdx].station,
            depart: depart1,
            arrive: arrive2,
            arrive1, depart2,
            duration: leg1 + waitMin + leg2,
            waitMin,
            leg1, leg2,
          });

          if (transfers.length >= 10) break;
        }
        if (transfers.length >= 10) break;
      }
      if (transfers.length >= 10) break;
    }

    // Sort by total duration
    transfers.sort((a, b) => a.duration - b.duration);
    return transfers.slice(0, 5);
  },

  _calcDuration(fromTime, toTime) {
    if (!fromTime || !toTime) return 0;
    const [h1, m1] = fromTime.split(':').map(Number);
    const [h2, m2] = toTime.split(':').map(Number);
    let diff = (h2 * 60 + m2) - (h1 * 60 + m1);
    if (diff < 0) diff += 24 * 60; // handle overnight
    return diff;
  },

  _formatDuration(minutes) {
    if (minutes <= 0) return '--';
    const h = Math.floor(minutes / 60);
    const m = minutes % 60;
    return h > 0 ? `${h}h${m > 0 ? m + 'min' : ''}` : `${m}min`;
  },
};

// ==================== Layer Manager ====================
const LayerManager = {
  // 图层状态
  visible: { hsr: true, metro: false, spots: false },
  selectedCity: null,

  // 车次高亮状态
  _highlightedTrain: null,
  _trainHighlight: [],

  // Station importance classification
  MAJOR_STATIONS: new Set([
    '北京', '北京南', '北京西', '北京朝阳',
    '上海', '上海虹桥',
    '广州', '广州南', '广州东',
    '深圳', '深圳北', '福田',
    '武汉', '武汉站',
    '成都', '成都东',
    '重庆', '重庆北', '重庆西', '沙坪坝',
    '西安', '西安北',
    '南京', '南京南',
    '杭州', '杭州东', '杭州西',
    '长沙', '长沙南',
    '郑州', '郑州东',
    '天津', '天津南', '天津西',
    '沈阳', '沈阳北',
    '哈尔滨', '哈尔滨西',
    '昆明', '昆明南',
    '贵阳', '贵阳北', '贵阳东',
    '南宁', '南宁东',
    '福州', '福州南',
    '厦门', '厦门北',
    '合肥', '合肥南',
    '济南', '济南西', '济南东',
    '青岛', '青岛北',
    '大连', '大连北',
    '兰州', '兰州西',
    '乌鲁木齐',
    '拉萨',
    '太原', '太原南',
    '石家庄',
    '南昌', '南昌西',
    '海口', '海口东',
    '三亚',
  ]),

  REGIONAL_STATIONS: new Set([
    '苏州', '苏州北', '无锡', '无锡东', '常州', '常州北',
    '宁波', '温州', '温州南',
    '佛山', '佛山西', '东莞', '东莞南', '珠海',
    '洛阳', '洛阳龙门',
    '徐州', '徐州东',
    '烟台', '潍坊',
    '桂林', '柳州',
    '宜昌', '宜昌东',
    '襄阳', '襄阳东',
    '九江',
    '芜湖', '蚌埠',
    '绍兴', '金华', '衢州',
    '张家界', '怀化', '衡阳',
    '遵义', '毕节',
    '包头', '呼和浩特',
    '银川', '西宁',
    '秦皇岛', '唐山',
    '保定', '邯郸',
    '长春', '吉林',
    '齐齐哈尔',
    '延吉',
    '威海', '日照',
    '黄石', '咸宁',
    '常德', '岳阳',
    '赣州', '吉安',
    '莆田', '泉州',
    '肇庆', '惠州',
    '中山', '江门',
    '百色', '钦州',
    '普洱', '西双版纳',
    '林芝', '日喀则',
    '敦煌', '嘉峪关', '张掖',
    '万州', '达州', '南充',
    '绵阳', '德阳', '乐山', '宜宾',
    '汉中', '广元',
    '临汾', '运城',
    '曲阜', '泰安',
    '黄山', '婺源',
    '上饶', '鹰潭',
  ]),

  // 高德地图覆盖物
  overlays: {
    hsrLines: [],
    hsrStations: [],
    hsrLabels: [],
    metroLines: [],
    metroStations: [],
    spotMarkers: [],
    cityMarkers: [],
    stationLabels: [],
  },

  init() {
    this._renderCityMarkers();
    this._renderHSRLayer();
  },

  _getStationImportance(stationName) {
    if (this.MAJOR_STATIONS.has(stationName)) return 1;
    if (this.REGIONAL_STATIONS.has(stationName)) return 2;
    return 3;
  },

  toggleLayer(layerName, show) {
    this.visible[layerName] = show;
    if (layerName === 'hsr') {
      // Re-apply zoom-based visibility rules for lines, stations, and labels
      this.onZoomChange(MapManager.currentZoom);
    } else if (layerName === 'metro') {
      if (show && this.selectedCity) {
        this._renderMetroLayer(this.selectedCity);
      }
      // 用渐进式显示代替全量显示/隐藏
      if (show) {
        this._applyMetroZoomVisibility(MapManager.currentZoom);
      } else {
        // 关闭地铁图层：用 setMap(null) 确保隐藏
        const map = MapManager.map;
        this.overlays.metroLines.forEach(o => o.setMap(null));
        this.overlays.metroStations.forEach(o => o.setMap(null));
        this.overlays.stationLabels.forEach(o => {
          if (o._metroStationImportance !== undefined) o.setMap(null);
        });
      }
    } else if (layerName === 'spots') {
      if (show && this.selectedCity) {
        this._renderSpotsLayer(this.selectedCity);
      }
      this._setOverlaysVisible(this.overlays.spotMarkers, show);
    }
  },

  onZoomChange(zoom) {
    // 缩放级别变化时可以调整标注可见性
    // 线路名称标注：zoom >= 6 时显示（zoom 5 只看主干线，不需要名字）
    const showHSRLabels = zoom >= 6;
    this._setOverlaysVisible(this.overlays.hsrLabels, showHSRLabels && this.visible.hsr);

    // 高铁线路渐进显示（zoom 越大显示越多）
    // importance: 1=主干线(京沪/京广等), 2=G型高铁, 3=D/C型动车城际, 4=K型及其他
    this.overlays.hsrLines.forEach(line => {
      const data = line.getExtData();
      const importance = data ? data.importance : 1;
      let show = false;
      if (zoom >= 8) show = true;                      // 全部线路
      else if (zoom >= 7 && importance <= 3) show = true; // + 动车/城际
      else if (zoom >= 6 && importance <= 2) show = true; // + G型高铁
      else if (zoom >= 5 && importance <= 1) show = true; // 仅主干线

      // Also check line type filter state
      const lineType = data ? data.lineType : 'G';
      if (show && this.visible.hsr && this._lineFilterVisible(lineType)) {
        line.show();
      } else {
        line.hide();
      }
    });

    // 高铁站点渐进显示
    // importance: 1=大型枢纽, 2=区域枢纽, 3=普通站
    this.overlays.hsrStations.forEach(marker => {
      const importance = marker._stationImportance || 3;
      let show = false;
      if (zoom >= 10) show = true;                    // 全部站点
      else if (zoom >= 8 && importance <= 2) show = true; // + 区域枢纽
      else if (zoom >= 6 && importance <= 1) show = true; // 仅大型枢纽

      if (show && this.visible.hsr) marker.show(); else marker.hide();
    });

    // 站点名称标注（HSR 标签，跳过地铁标签——地铁由 _applyMetroZoomVisibility 处理）
    this.overlays.stationLabels.forEach(label => {
      if (label._metroStationImportance !== undefined) return; // 地铁标签，跳过
      const importance = label._stationImportance || 3;
      let show = false;
      if (zoom >= 10) show = true;
      else if (zoom >= 8 && importance <= 2) show = true;
      else if (zoom >= 6 && importance <= 1) show = true;

      if (show && MapManager._cleanMode && this.visible.hsr) label.show(); else label.hide();
    });

    // 地铁渐进式披露
    this._applyMetroZoomVisibility(zoom);
  },

  // Line type filter state (all visible by default)
  _lineFilters: { G: true, D: true, C: true, K: true },

  _lineFilterVisible(lineType) {
    return this._lineFilters[lineType] !== false;
  },

  setLineFilter(type, visible) {
    this._lineFilters[type] = visible;
    this._applyLineFilters();
  },

  _applyLineFilters() {
    const zoom = MapManager.currentZoom;
    this.overlays.hsrLines.forEach(line => {
      const data = line.getExtData();
      const lineType = data ? data.lineType : 'G';
      const importance = data ? data.importance : 1;

      // Check zoom-based visibility (same thresholds as onZoomChange)
      let showByZoom = false;
      if (zoom >= 8) showByZoom = true;
      else if (zoom >= 7 && importance <= 3) showByZoom = true;
      else if (zoom >= 6 && importance <= 2) showByZoom = true;
      else if (zoom >= 5 && importance <= 1) showByZoom = true;

      // Check filter visibility
      const showByFilter = this._lineFilterVisible(lineType);

      if (showByZoom && showByFilter && this.visible.hsr) {
        line.show();
      } else {
        line.hide();
      }
    });
  },

  selectCity(cityName) {
    this.selectedCity = cityName;
    const city = DataManager.getCity(cityName);
    if (!city) return;

    // 清除旧的地铁和景点图层
    this._clearOverlays(this.overlays.metroLines);
    this._clearOverlays(this.overlays.metroStations);
    this._clearOverlays(this.overlays.spotMarkers);
    // Remove metro-contributed station labels
    if (this._metroLabelStart !== undefined) {
      const removed = this.overlays.stationLabels.splice(this._metroLabelStart);
      removed.forEach(o => MapManager.map.remove(o));
      this._metroLabelStart = undefined;
    }

    // 居中到城市（保持当前缩放级别不变，由用户自行缩放）
    MapManager.map.panTo(city.center);

    // 渲染地铁和景点（如果图层开启）
    if (this.visible.metro) this._renderMetroLayer(cityName);
    if (this.visible.spots) this._renderSpotsLayer(cityName);

    // 高亮城市列表中对应项
    UIController.highlightCity(cityName);

    // 显示详情面板
    UIController.showCityDetail(cityName);
  },

  resetView() {
    this.selectedCity = null;
    this._clearOverlays(this.overlays.metroLines);
    this._clearOverlays(this.overlays.metroStations);
    this._clearOverlays(this.overlays.spotMarkers);
    // Remove metro-contributed station labels
    if (this._metroLabelStart !== undefined) {
      const removed = this.overlays.stationLabels.splice(this._metroLabelStart);
      removed.forEach(o => MapManager.map.remove(o));
      this._metroLabelStart = undefined;
    }
    MapManager.flyTo([108, 36], 4.5);
    UIController.hideDetail();
    UIController.highlightCity(null);
  },

  // ---- City Markers ----
  _renderCityMarkers() {
    const map = MapManager.map;
    DataManager.cities.forEach(city => {
      const marker = new AMap.Marker({
        position: city.center,
        content: `<div class="city-marker ${city.hasMetro ? 'has-metro' : ''} ${city.hsrHub ? 'hsr-hub' : ''}"></div>`,
        offset: new AMap.Pixel(-6, -6),
        extData: city,
        zIndex: 110,
      });

      // 城市名标注
      const label = new AMap.Text({
        text: city.name,
        position: city.center,
        offset: new AMap.Pixel(0, -20),
        style: {
          'font-size': '12px',
          'color': '#333',
          'background-color': 'rgba(255,255,255,0.8)',
          'border': 'none',
          'padding': '2px 6px',
          'border-radius': '3px',
        },
        zIndex: 109,
      });

      marker.on('click', () => this.selectCity(city.name));

      map.add([marker, label]);
      this.overlays.cityMarkers.push(marker);
    });
  },

  // ---- HSR Layer ----
  _renderHSRLayer() {
    const map = MapManager.map;
    const labeledStations = new Set();

    // Importance levels based on line type / name
    const trunkLines = ['京沪', '京广', '京哈', '沪昆', '沿海', '京港', '沪宁', '京津'];
    function getImportance(line) {
      // Level 1: trunk HSR lines
      if (trunkLines.some(name => line.name.includes(name))) return 1;
      // Level 2: G-type (高铁)
      if (line.type === 'G' || line.name.includes('高铁')) return 2;
      // Level 3: D-type or C-type (动车/城际)
      if (line.type === 'D' || line.type === 'C' || line.name.includes('城际') || line.name.includes('动车')) return 3;
      // Level 4: K-type or other fast rail
      return 4;
    }

    DataManager.hsr.forEach(line => {
      // 提取站点坐标组成线路路径
      const path = line.stations.map(s => s.center);
      if (path.length < 2) return;

      const importance = getImportance(line);

      const polyline = new AMap.Polyline({
        path: path,
        strokeColor: line.color,
        strokeWeight: 3,
        strokeOpacity: 0.5,
        lineJoin: 'round',
        lineCap: 'round',
        zIndex: 50,
        extData: { ...line, importance: importance, lineType: line.type || 'G' },
      });

      polyline.on('click', () => {
        UIController.showHSRDetail(line);
      });

      // Hover highlight
      polyline.on('mouseover', () => {
        polyline.setOptions({ strokeWeight: 5, strokeOpacity: 1 });
        polyline.setzIndex(100);
      });

      polyline.on('mouseout', () => {
        // Don't reset if there's an active train highlight dimming lines
        if (LayerManager._highlightedTrain) return;
        polyline.setOptions({ strokeWeight: 3, strokeOpacity: 0.5 });
        polyline.setzIndex(50);
      });

      map.add(polyline);
      this.overlays.hsrLines.push(polyline);

      // 站点标记
      line.stations.forEach(station => {
        const marker = new AMap.Marker({
          position: station.center,
          content: `<div class="station-marker" title="${station.name}"></div>`,
          offset: new AMap.Pixel(-4, -4),
          zIndex: 60,
        });

        marker._stationImportance = this._getStationImportance(station.name);

        marker.on('click', async (e) => {
          // 查找该站点属于哪些线路
          const lines = DataManager.hsr.filter(l =>
            l.stations.some(s => s.name === station.name)
          );
          UIController.showStationDetail(station, lines);
          // 懒加载车次数据
          if (!DataManager._trainsLoaded) {
            await DataManager.loadTrains();
            UIController.showStationDetail(station, lines);
          }
        });

        map.add(marker);
        this.overlays.hsrStations.push(marker);

        // 站点名称标注（去重：同一坐标只标注一次）
        const stationKey = station.center.join(',');
        if (!labeledStations.has(stationKey)) {
          labeledStations.add(stationKey);
          const label = new AMap.Text({
            text: station.name,
            position: station.center,
            offset: new AMap.Pixel(6, -6),
            style: {
              'font-size': '11px',
              'color': '#333',
              'background-color': 'rgba(255,255,255,0.85)',
              'border': 'none',
              'padding': '1px 4px',
              'border-radius': '2px',
              'font-weight': '500',
            },
            zIndex: 65,
            visible: false,
          });
          label._stationImportance = this._getStationImportance(station.name);
          map.add(label);
          this.overlays.stationLabels.push(label);
        }
      });

      // 线路名称标注（取中间站点位置）
      const midIdx = Math.floor(line.stations.length / 2);
      const midStation = line.stations[midIdx];
      const text = new AMap.Text({
        text: line.name,
        position: midStation.center,
        offset: new AMap.Pixel(0, 10),
        style: {
          'font-size': '11px',
          'color': line.color,
          'background-color': 'rgba(255,255,255,0.85)',
          'border': `1px solid ${line.color}`,
          'padding': '1px 6px',
          'border-radius': '3px',
          'font-weight': '600',
        },
        zIndex: 55,
      });

      map.add(text);
      this.overlays.hsrLabels.push(text);
    });
  },

  // ---- Metro Layer ----
  _renderMetroLayer(cityName) {
    this._clearOverlays(this.overlays.metroLines);
    this._clearOverlays(this.overlays.metroStations);
    // Remove metro-contributed station labels
    if (this._metroLabelStart !== undefined) {
      const removed = this.overlays.stationLabels.splice(this._metroLabelStart);
      removed.forEach(o => MapManager.map.remove(o));
    }
    this._metroLabelStart = this.overlays.stationLabels.length;

    const metroData = DataManager.getCityMetro(cityName);
    if (!metroData) return;

    const map = MapManager.map;
    const labeledMetroStations = new Set();
    const zoom = MapManager.currentZoom;

    // 预计算换乘站：出现在多条线路上的站点
    const stationLineCount = {};
    metroData.lines.forEach(line => {
      line.stations.forEach(s => {
        stationLineCount[s.name] = (stationLineCount[s.name] || 0) + 1;
      });
    });
    const isTransfer = (name) => (stationLineCount[name] || 0) >= 2;

    // 地铁线路重要性：1=主干线(1-5号), 2=辅助线(6-10号), 3=支线/快线
    const getMetroLineImportance = (lineName) => {
      const m = lineName.match(/(\d+)/);
      const num = m ? parseInt(m[1]) : 99;
      if (lineName.includes('支线') || lineName.includes('支')) return 3;
      if (num <= 5) return 1;
      if (num <= 10) return 2;
      return 3;
    };

    // 地铁站重要性：1=换乘站, 3=普通站
    const getMetroStationImportance = (stationName) => {
      if (isTransfer(stationName)) return 1;
      return 3;
    };

    metroData.lines.forEach(line => {
      const path = line.stations.map(s => s.center);
      if (path.length < 2) return;

      const lineImportance = getMetroLineImportance(line.name);

      const polyline = new AMap.Polyline({
        path: path,
        strokeColor: line.color,
        strokeWeight: 4,
        strokeOpacity: 0.9,
        lineJoin: 'round',
        lineCap: 'round',
        zIndex: 80,
        extData: line,
      });

      // 存储地铁线路重要性，供 onZoomChange 使用
      polyline._metroLineImportance = lineImportance;

      polyline.on('click', () => {
        UIController.showMetroLineDetail(line, cityName);
      });

      map.add(polyline);
      this.overlays.metroLines.push(polyline);

      // 地铁站标记
      line.stations.forEach(station => {
        const metroImportance = getMetroStationImportance(station.name);
        const isTransferStation = isTransfer(station.name);

        // 换乘站用更大的标记
        const markerContent = isTransferStation
          ? `<div style="width:8px;height:8px;background:#fff;border:2px solid #333;border-radius:50%;cursor:pointer;" title="${station.name}"></div>`
          : `<div style="width:6px;height:6px;background:#fff;border:2px solid ${line.color};border-radius:50%;cursor:pointer;" title="${station.name}"></div>`;

        const marker = new AMap.Marker({
          position: station.center,
          content: markerContent,
          offset: new AMap.Pixel(isTransferStation ? -5 : -4, isTransferStation ? -5 : -4),
          zIndex: 85,
        });

        // 地铁专用重要性（区别于 HSR 的 _stationImportance）
        marker._metroStationImportance = metroImportance;
        marker._stationImportance = this._getStationImportance(station.name);

        marker.on('click', () => {
          const transferLines = metroData.lines.filter(l =>
            l.stations.some(s => s.name === station.name)
          );
          UIController.showMetroStationDetail(station, transferLines, cityName);
        });

        map.add(marker);
        this.overlays.metroStations.push(marker);

        // 地铁站名称标注（去重）
        const stationKey = station.center.join(',');
        if (!labeledMetroStations.has(stationKey)) {
          labeledMetroStations.add(stationKey);
          const label = new AMap.Text({
            text: station.name,
            position: station.center,
            offset: new AMap.Pixel(6, -6),
            style: {
              'font-size': '10px',
              'color': '#333',
              'background-color': 'rgba(255,255,255,0.85)',
              'border': 'none',
              'padding': '1px 4px',
              'border-radius': '2px',
              'font-weight': isTransferStation ? '600' : '500',
            },
            zIndex: 86,
            visible: MapManager._cleanMode,
          });
          label._metroStationImportance = metroImportance;
          label._stationImportance = this._getStationImportance(station.name);
          map.add(label);
          this.overlays.stationLabels.push(label);
        }
      });
    });

    // 渲染后根据当前 zoom 应用渐进显示
    this._applyMetroZoomVisibility(zoom);
  },

  // 地铁渐进式披露：根据缩放级别控制地铁覆盖物的可见性
  _applyMetroZoomVisibility(zoom) {
    if (!this.visible.metro) return;
    const map = MapManager.map;

    // 地铁线路：zoom<11 只显示主干线，zoom<12 +辅助线，zoom>=12 全部
    // 注意：AMap 2.0 中 Polyline.hide() 不可靠，改用 setMap(null)/setMap(map)
    this.overlays.metroLines.forEach(line => {
      const imp = line._metroLineImportance || 1;
      let show = false;
      if (zoom >= 12) show = true;
      else if (zoom >= 11 && imp <= 2) show = true;
      else if (imp <= 1) show = true;
      if (show) line.setMap(map); else line.setMap(null);
    });

    // 地铁站：zoom<12 只显示换乘站，zoom>=12 全部
    this.overlays.metroStations.forEach(marker => {
      const imp = marker._metroStationImportance || 3;
      let show = false;
      if (zoom >= 12) show = true;
      else if (imp <= 1) show = true; // 换乘站始终可见
      if (show) marker.setMap(map); else marker.setMap(null);
    });

    // 站名标注：zoom<12 只显示换乘站名，zoom>=12 全部
    this.overlays.stationLabels.forEach(label => {
      const metroImp = label._metroStationImportance;
      if (metroImp === undefined) return; // 跳过 HSR 标签（由 onZoomChange 处理）
      let show = false;
      if (zoom >= 12) show = true;
      else if (metroImp <= 1) show = true; // 换乘站名始终可见
      if (show) label.setMap(map); else label.setMap(null);
    });
  },

  // ---- Spots Layer ----
  _renderSpotsLayer(cityName) {
    this._clearOverlays(this.overlays.spotMarkers);

    const spots = DataManager.getCitySpots(cityName);
    const map = MapManager.map;

    spots.forEach(spot => {
      const marker = new AMap.Marker({
        position: spot.center,
        content: `<div class="spot-marker" title="${spot.name}"></div>`,
        offset: new AMap.Pixel(-5, -5),
        zIndex: 90,
      });

      // 景点名标注
      const label = new AMap.Text({
        text: spot.name,
        position: spot.center,
        offset: new AMap.Pixel(8, -5),
        style: {
          'font-size': '11px',
          'color': '#27ae60',
          'background-color': 'rgba(255,255,255,0.9)',
          'border': 'none',
          'padding': '1px 4px',
          'border-radius': '2px',
        },
        zIndex: 89,
      });

      marker.on('click', () => {
        UIController.showSpotDetail(spot);
      });

      map.add([marker, label]);
      this.overlays.spotMarkers.push(marker, label);
    });
  },

  // ---- Train Highlight ----
  highlightTrain(trainNumber) {
    // Clear previous highlight
    this._clearTrainHighlight();

    const train = DataManager.getTrainByNumber(trainNumber);
    if (!train) return;

    this._highlightedTrain = train;

    // Show the clear-highlight button
    const clearBtn = document.getElementById('clear-highlight-btn');
    if (clearBtn) clearBtn.classList.remove('hidden');

    // Draw the train's route as a thick, brightly colored polyline
    const path = train.route
      .filter(s => s.arrive || s.depart)
      .map(s => s.center);
    if (path.length < 2) return;

    const typeColors = { G: '#FF0000', D: '#0066FF', C: '#00AA00', K: '#FF6600' };
    const color = typeColors[train.type] || '#FF0000';

    // Dim all other lines
    this._dimAllLines();

    // Draw highlighted route
    const polyline = new AMap.Polyline({
      path: path,
      strokeColor: color,
      strokeWeight: 6,
      strokeOpacity: 1,
      lineJoin: 'round',
      zIndex: 200,
    });

    polyline.on('click', () => {
      if (this._highlightedTrain) {
        this._clearTrainHighlight();
        UIController.hideDetail();
      }
    });

    MapManager.map.add(polyline);
    this._trainHighlight.push(polyline);

    // Add station markers along the route
    train.route.forEach(s => {
      if (!s.arrive && !s.depart) return; // Skip passed-through stations
      const marker = new AMap.Marker({
        position: s.center,
        content: `<div style="background:${color};color:#fff;padding:2px 6px;border-radius:3px;font-size:11px;font-weight:600;white-space:nowrap;">${s.station}</div>`,
        offset: new AMap.Pixel(-20, -10),
        zIndex: 210,
      });
      MapManager.map.add(marker);
      this._trainHighlight.push(marker);
    });

    // Fit map to the route
    if (path.length >= 2) {
      MapManager.map.setBounds(new AMap.Bounds(
        [Math.min(...path.map(p => p[0])) - 0.5, Math.min(...path.map(p => p[1])) - 0.5],
        [Math.max(...path.map(p => p[0])) + 0.5, Math.max(...path.map(p => p[1])) + 0.5]
      ));
    }
  },

  _clearTrainHighlight() {
    this._trainHighlight.forEach(o => MapManager.map.remove(o));
    this._trainHighlight = [];
    this._highlightedTrain = null;
    this._restoreAllLines();

    // Hide the clear-highlight button
    const clearBtn = document.getElementById('clear-highlight-btn');
    if (clearBtn) clearBtn.classList.add('hidden');
  },

  _dimAllLines() {
    this.overlays.hsrLines.forEach(l => l.setOptions({ strokeOpacity: 0.15 }));
  },

  _restoreAllLines() {
    this.overlays.hsrLines.forEach(l => l.setOptions({ strokeOpacity: 0.5 }));
  },

  // ---- Utility ----
  _setOverlaysVisible(overlays, visible) {
    overlays.forEach(o => {
      if (visible) o.show(); else o.hide();
    });
  },

  _clearOverlays(arr) {
    arr.forEach(o => MapManager.map.remove(o));
    arr.length = 0;
  },

  setStationLabelsVisible(visible) {
    this.overlays.stationLabels.forEach(label => {
      if (visible) label.show(); else label.hide();
    });
  },
};

// ==================== UI Controller ====================
const UIController = {
  elements: {},

  init() {
    this.elements = {
      sidebar: document.getElementById('sidebar'),
      citySearch: document.getElementById('city-search'),
      searchResults: document.getElementById('search-results'),
      quickCities: document.getElementById('quick-cities'),
      cityList: document.getElementById('city-list'),
      cityCount: document.getElementById('city-count'),
      detailPanel: document.getElementById('detail-panel'),
      detailContent: document.getElementById('detail-content'),
      detailClose: document.getElementById('detail-close'),
      statusText: document.getElementById('status-text'),
      zoomLevel: document.getElementById('zoom-level'),
      mapModeToggle: document.getElementById('map-mode-toggle'),
    };

    this._bindEvents();
  },

  _bindEvents() {
    // 图层切换
    document.querySelectorAll('[data-layer-toggle]').forEach(cb => {
      cb.addEventListener('change', (e) => {
        const layer = e.target.dataset.layerToggle;
        LayerManager.toggleLayer(layer, e.target.checked);
      });
    });

    // 搜索
    this.elements.citySearch.addEventListener('input', (e) => {
      const results = DataManager.searchCities(e.target.value);
      this._renderSearchResults(results);
    });

    this.elements.citySearch.addEventListener('focus', () => {
      const results = DataManager.searchCities(this.elements.citySearch.value || '  ');
      this._renderSearchResults(results);
    });

    document.addEventListener('click', (e) => {
      if (!e.target.closest('.search-box')) {
        this.elements.searchResults.classList.add('hidden');
      }
    });

    // 关闭详情
    this.elements.detailClose.addEventListener('click', () => this.hideDetail());

    // ESC 关闭详情
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') this.hideDetail();
    });

    // 移动端侧边栏切换
    const sidebar = document.getElementById('sidebar');
    const sidebarToggle = document.getElementById('sidebar-toggle');
    const sidebarBackdrop = document.getElementById('sidebar-backdrop');
    if (sidebar && sidebarToggle) {
      const toggleSidebar = () => {
        sidebar.classList.toggle('collapsed');
      };
      sidebarToggle.addEventListener('click', toggleSidebar);
      if (sidebarBackdrop) sidebarBackdrop.addEventListener('click', toggleSidebar);
      // 移动端默认收起
      if (window.innerWidth <= 768) sidebar.classList.add('collapsed');
    }

    // 纯净模式切换
    this.elements.mapModeToggle.addEventListener('click', () => {
      const isClean = MapManager.toggleCleanMode();
      this.elements.mapModeToggle.classList.toggle('active', isClean);
      this.elements.mapModeToggle.textContent = isClean ? '标准模式' : '纯净模式';
      this.updateMapModeStatus(isClean);
    });

    // 线路筛选
    document.querySelectorAll('.filter-chip[data-filter]').forEach(chip => {
      chip.addEventListener('click', () => {
        const type = chip.dataset.filter;
        const isActive = chip.classList.toggle('active');
        LayerManager.setLineFilter(type, isActive);
      });
    });

    // 取消车次高亮按钮
    document.getElementById('clear-highlight-btn').addEventListener('click', () => {
      LayerManager._clearTrainHighlight();
      UIController.hideDetail();
    });

    // 路线查询
    this._bindRouteSearch();
  },

  _bindRouteSearch() {
    const fromInput = document.getElementById('route-from');
    const toInput = document.getElementById('route-to');
    const fromSuggestions = document.getElementById('route-from-suggestions');
    const toSuggestions = document.getElementById('route-to-suggestions');
    const swapBtn = document.getElementById('route-swap');
    const searchBtn = document.getElementById('route-search-btn');

    if (!fromInput || !toInput) return;

    // Autocomplete
    const bindAutocomplete = (input, suggestionsEl) => {
      input.addEventListener('input', () => {
        const results = DataManager.searchCities(input.value);
        if (!results.length) { suggestionsEl.classList.add('hidden'); return; }
        suggestionsEl.innerHTML = results.map(c =>
          `<div class="route-suggestion-item" data-city="${c.name}">${c.name}<span style="color:#8892a4;font-size:11px;margin-left:4px">${c.province || ''}</span></div>`
        ).join('');
        suggestionsEl.classList.remove('hidden');
        suggestionsEl.querySelectorAll('.route-suggestion-item').forEach(item => {
          item.addEventListener('click', () => {
            input.value = item.dataset.city;
            suggestionsEl.classList.add('hidden');
          });
        });
      });

      input.addEventListener('focus', () => {
        if (input.value) input.dispatchEvent(new Event('input'));
      });
    };

    bindAutocomplete(fromInput, fromSuggestions);
    bindAutocomplete(toInput, toSuggestions);

    // Close suggestions on outside click
    document.addEventListener('click', (e) => {
      if (!e.target.closest('.route-input-group')) {
        fromSuggestions.classList.add('hidden');
        toSuggestions.classList.add('hidden');
      }
    });

    // Swap
    swapBtn.addEventListener('click', () => {
      const tmp = fromInput.value;
      fromInput.value = toInput.value;
      toInput.value = tmp;
    });

    // Search
    const doSearch = async () => {
      const from = fromInput.value.trim();
      const to = toInput.value.trim();
      if (!from || !to) return;
      if (from === to) {
        this.showRouteError('出发城市和到达城市不能相同');
        return;
      }

      searchBtn.disabled = true;
      searchBtn.textContent = '查询中…';

      // Ensure trains are loaded
      if (!DataManager._trainsLoaded) {
        await DataManager.loadTrains();
      }

      const result = DataManager.queryRoutes(from, to);
      this.showRouteResults(from, to, result);

      searchBtn.disabled = false;
      searchBtn.textContent = '查询车次';
    };

    searchBtn.addEventListener('click', doSearch);

    // Enter key triggers search
    [fromInput, toInput].forEach(input => {
      input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') doSearch();
      });
    });
  },

  renderSidebar() {
    // 快捷城市（有地铁的城市优先展示）
    const hotCities = DataManager.cities
      .filter(c => c.hsrHub || c.hasMetro)
      .slice(0, 12);

    this.elements.quickCities.innerHTML = hotCities.map(c =>
      `<span class="city-chip" data-city="${c.name}">${c.name}</span>`
    ).join('');

    this.elements.quickCities.querySelectorAll('.city-chip').forEach(chip => {
      chip.addEventListener('click', () => LayerManager.selectCity(chip.dataset.city));
    });

    // 全部城市列表
    const sorted = [...DataManager.cities].sort((a, b) => a.name.localeCompare(b.name, 'zh'));
    this.elements.cityCount.textContent = `(${sorted.length})`;

    this.elements.cityList.innerHTML = sorted.map(c => {
      const tags = [];
      if (c.hsrHub) tags.push('<span class="city-tag hsr">高铁</span>');
      if (c.hasMetro) tags.push('<span class="city-tag metro">地铁</span>');
      return `<li data-city="${c.name}">
        <span>${c.name}</span>
        <span class="city-tags">${tags.join('')}</span>
      </li>`;
    }).join('');

    this.elements.cityList.querySelectorAll('li').forEach(li => {
      li.addEventListener('click', () => LayerManager.selectCity(li.dataset.city));
    });
  },

  highlightCity(cityName) {
    document.querySelectorAll('.city-chip, .city-list li').forEach(el => {
      el.classList.toggle('active', el.dataset.city === cityName);
    });
  },

  _renderSearchResults(results) {
    if (!results.length) {
      this.elements.searchResults.classList.add('hidden');
      return;
    }

    this.elements.searchResults.innerHTML = results.map(c =>
      `<div class="search-result-item" data-city="${c.name}">
        ${c.name}<span class="province">${c.province || ''}</span>
      </div>`
    ).join('');

    this.elements.searchResults.classList.remove('hidden');

    this.elements.searchResults.querySelectorAll('.search-result-item').forEach(item => {
      item.addEventListener('click', () => {
        LayerManager.selectCity(item.dataset.city);
        this.elements.searchResults.classList.add('hidden');
        this.elements.citySearch.value = '';
      });
    });
  },

  // ---- Detail Panels ----
  showCityDetail(cityName) {
    const city = DataManager.getCity(cityName);
    if (!city) return;

    const hsrLines = DataManager.getCityHSR(cityName);
    const metroData = DataManager.getCityMetro(cityName);
    const spots = DataManager.getCitySpots(cityName);

    // Back button
    let html = `<button class="btn-back-national" id="btn-back-national">← 返回全国视图</button>`;

    html += `<h2>${city.name}</h2>`;
    html += `<div class="city-meta">${city.province || ''} · ${city.description || ''}</div>`;

    // Summary counts
    html += `<div class="city-summary-counts">`;
    if (hsrLines.length) html += `<span class="count-badge hsr">🚄 高铁 ${hsrLines.length}</span>`;
    if (metroData) html += `<span class="count-badge metro">🚇 地铁 ${metroData.lines.length}</span>`;
    if (spots.length) html += `<span class="count-badge spots">📍 景点 ${spots.length}</span>`;
    html += `</div>`;

    // 高铁信息
    if (hsrLines.length) {
      html += `<div class="section">
        <h3><span class="dot" style="background:var(--hsr-color)"></span>高铁线路 (${hsrLines.length}条经过)</h3>`;
      hsrLines.forEach(line => {
        html += `<div class="line-item" style="border-left-color:${line.color}">
          <div class="line-name">${line.name}</div>
          <div class="line-desc">${line.stations.map(s => s.name).join(' → ')}</div>
        </div>`;
      });
      html += '</div>';
    }

    // 地铁信息
    if (metroData) {
      html += `<div class="section">
        <h3><span class="dot" style="background:var(--metro-color)"></span>地铁线路 (${metroData.lines.length}条)</h3>`;
      metroData.lines.forEach(line => {
        html += `<div class="line-item" style="border-left-color:${line.color}">
          <div class="line-name">${line.name}</div>
          <div class="line-desc">${line.stations.length}站 · ${line.stations.map(s => s.name).join(' → ')}</div>
        </div>`;
      });
      html += '</div>';
    }

    // 景点信息 (with thumbnails)
    if (spots.length) {
      const bgColors = {
        '自然': '#27ae60', '历史': '#8e44ad', '文化': '#d35400',
        '现代': '#2980b9',
      };
      html += `<div class="section">
        <h3><span class="dot" style="background:var(--spots-color)"></span>著名景点 (${spots.length}个)</h3>`;
      spots.forEach(spot => {
        const tag = spot.category ? `<span class="spot-tag">${spot.category}</span>` : '';
        const hasThumb = spot.image || (spot.images && spot.images.length > 0);
        const thumbSrc = spot.image || (spot.images && spot.images[0]);
        const descPreview = (spot.description || '').slice(0, 40);

        if (hasThumb) {
          html += `<div class="spot-card with-thumb" data-spot="${spot.name}">
            <img class="spot-thumb" src="${thumbSrc}" alt="${spot.name}" loading="lazy"
                 onerror="this.outerHTML='<div class=\\'spot-thumb-placeholder\\' style=\\'background:${bgColors[spot.category] || '#4a90d9'}\\'>📍</div>'">
            <div class="spot-info">
              <div class="spot-name">${spot.name}${tag}</div>
              <div class="spot-meta">${descPreview}</div>
            </div>
          </div>`;
        } else {
          const bg = bgColors[spot.category] || '#4a90d9';
          html += `<div class="spot-card with-thumb" data-spot="${spot.name}">
            <div class="spot-thumb-placeholder" style="background:${bg}">📍</div>
            <div class="spot-info">
              <div class="spot-name">${spot.name}${tag}</div>
              <div class="spot-meta">${descPreview}</div>
            </div>
          </div>`;
        }
      });
      html += '</div>';
    }

    this.elements.detailContent.innerHTML = html;
    this.elements.detailPanel.classList.remove('hidden');

    // Back button
    document.getElementById('btn-back-national').addEventListener('click', () => {
      LayerManager.resetView();
    });

    // 景点卡片点击定位 + 打开详情
    this.elements.detailContent.querySelectorAll('.spot-card').forEach(card => {
      card.addEventListener('click', () => {
        const spot = DataManager.spots.find(s => s.name === card.dataset.spot);
        if (spot) {
          MapManager.flyTo(spot.center, 14);
          UIController.showSpotDetail(spot);
        }
      });
    });
  },

  showHSRDetail(line) {
    let html = `<h2>${line.name}</h2>`;
    html += `<div class="city-meta">高速铁路 · ${line.stations.length}个站点</div>`;
    html += `<div class="section"><h3><span class="dot" style="background:${line.color}"></span>途经站点</h3>`;
    line.stations.forEach((s, i) => {
      html += `<div class="line-item" style="border-left-color:${line.color}; cursor:pointer;" data-city="${s.name}">
        <div class="line-name">${i + 1}. ${s.name}</div>
      </div>`;
    });
    html += '</div>';

    this.elements.detailContent.innerHTML = html;
    this.elements.detailPanel.classList.remove('hidden');

    this.elements.detailContent.querySelectorAll('.line-item[data-city]').forEach(item => {
      item.addEventListener('click', () => LayerManager.selectCity(item.dataset.city));
    });
  },

  showStationDetail(station, lines) {
    let html = `<h2>${station.name}</h2>`;
    html += `<div class="city-meta">高铁站</div>`;
    html += `<div class="section"><h3><span class="dot" style="background:var(--hsr-color)"></span>经过线路</h3>`;
    lines.forEach(line => {
      html += `<div class="line-item" style="border-left-color:${line.color}">
        <div class="line-name">${line.name}</div>
        <div class="line-desc">${line.stations.map(s => s.name).join(' → ')}</div>
      </div>`;
    });
    html += '</div>';

    // Train services passing through this station
    const trains = DataManager.getStationTrains(station.name);
    if (trains.length > 0) {
      const typeColorMap = { G: '#E63946', D: '#457B9D', C: '#2A9D8F', K: '#A0522D' };
      const typeLabelMap = { G: '高铁', D: '动车', C: '城际', K: '快速' };
      html += `<div class="section"><h3><span class="dot" style="background:#FF6B35"></span>经过车次 (${trains.length})</h3>`;
      html += `<div class="train-data-notice"><span>⚠</span> 模拟数据，非实时时刻表</div>`;
      html += `<div class="train-list">`;
      trains.forEach(train => {
        const typeClass = (train.type || 'G').toLowerCase() + '-type';
        const routeStations = train.route.filter(s => s.arrive || s.depart);
        const startStation = routeStations.length > 0 ? routeStations[0].station : '';
        const endStation = routeStations.length > 1 ? routeStations[routeStations.length - 1].station : '';

        // Find arrival/departure time at this station
        const stationStop = train.route.find(s => s.station === station.name || s.station.includes(station.name));
        let timeStr = '';
        if (stationStop) {
          if (stationStop.depart) timeStr = stationStop.depart + '发';
          else if (stationStop.arrive) timeStr = stationStop.arrive + '到';
        }

        html += `<div class="train-card" data-train="${train.number}">
          <div class="train-header">
            <span class="train-number ${typeClass}">${train.number}</span>
            <span class="train-time">${timeStr}</span>
          </div>
          <div class="train-route-brief">${startStation} → ${endStation}</div>
        </div>`;
      });
      html += `</div></div>`;
    }

    this.elements.detailContent.innerHTML = html;
    this.elements.detailPanel.classList.remove('hidden');

    // Train card click handlers
    this.elements.detailContent.querySelectorAll('.train-card').forEach(card => {
      card.addEventListener('click', () => {
        const trainNumber = card.dataset.train;
        LayerManager.highlightTrain(trainNumber);
        const train = DataManager.getTrainByNumber(trainNumber);
        if (train) {
          UIController.showTrainDetail(train);
        }
      });
    });
  },

  showTrainDetail(train) {
    const typeColorMap = { G: '#E63946', D: '#457B9D', C: '#2A9D8F', K: '#A0522D' };
    const typeLabelMap = { G: '高铁', D: '动车', C: '城际', K: '快速' };
    const color = typeColorMap[train.type] || '#E63946';
    const typeLabel = typeLabelMap[train.type] || '高铁';

    let html = `<h2>${train.number}</h2>`;
    html += `<div class="city-meta">${typeLabel} · ${train.route.length}个站点</div>`;

    // Calculate total journey time
    const routeStations = train.route.filter(s => s.arrive || s.depart);
    if (routeStations.length >= 2) {
      const firstTime = routeStations[0].depart || routeStations[0].arrive || '';
      const lastTime = routeStations[routeStations.length - 1].arrive || routeStations[routeStations.length - 1].depart || '';
      if (firstTime && lastTime) {
        html += `<div class="train-journey-time">全程: ${firstTime} — ${lastTime}</div>`;
      }
    }

    // Clear highlight button
    html += `<button class="btn-clear-highlight" id="btn-clear-train-highlight">取消高亮</button>`;

    // Full route with timeline style
    html += `<div class="section"><h3><span class="dot" style="background:${color}"></span>途经站点</h3>`;
    html += `<div class="train-detail-route">`;
    train.route.forEach((s, i) => {
      if (!s.arrive && !s.depart) return; // Skip non-stopping stations
      const isCurrentHighlight = LayerManager._highlightedTrain &&
        LayerManager._highlightedTrain.number === train.number;
      const highlightClass = isCurrentHighlight ? ' highlighted' : '';

      html += `<div class="train-route-stop${highlightClass}">
        <div class="route-stop-time">
          <span class="arrive-time">${s.arrive || '--:--'}</span>
          <span class="depart-time">${s.depart || '--:--'}</span>
        </div>
        <div class="route-stop-marker"></div>
        <div class="route-stop-name">${s.station}</div>
      </div>`;
    });
    html += `</div></div>`;

    this.elements.detailContent.innerHTML = html;
    this.elements.detailPanel.classList.remove('hidden');

    // Clear highlight button handler
    const clearBtn = document.getElementById('btn-clear-train-highlight');
    if (clearBtn) {
      clearBtn.addEventListener('click', () => {
        LayerManager._clearTrainHighlight();
        clearBtn.textContent = '已取消高亮';
        clearBtn.disabled = true;
      });
    }
  },

  showMetroLineDetail(line, cityName) {
    let html = `<h2>${line.name}</h2>`;
    html += `<div class="city-meta">${cityName}地铁 · ${line.stations.length}站</div>`;
    html += `<div class="section"><h3><span class="dot" style="background:${line.color}"></span>全部站点</h3>`;
    line.stations.forEach((s, i) => {
      html += `<div class="line-item" style="border-left-color:${line.color}">
        <div class="line-name">${i + 1}. ${s.name}</div>
      </div>`;
    });
    html += '</div>';

    this.elements.detailContent.innerHTML = html;
    this.elements.detailPanel.classList.remove('hidden');
  },

  showMetroStationDetail(station, transferLines, cityName) {
    let html = `<h2>${station.name}</h2>`;
    html += `<div class="city-meta">${cityName}地铁站</div>`;
    html += `<div class="section"><h3><span class="dot" style="background:var(--metro-color)"></span>经过线路</h3>`;
    transferLines.forEach(line => {
      html += `<div class="line-item" style="border-left-color:${line.color}">
        <div class="line-name">${line.name}</div>
      </div>`;
    });
    html += '</div>';

    this.elements.detailContent.innerHTML = html;
    this.elements.detailPanel.classList.remove('hidden');
  },

  showSpotDetail(spot) {
    let html = '';

    // Image or placeholder at the top
    if (spot.image) {
      html += `<div class="spot-image" onclick="window.open('${spot.image}', '_blank')">
        <img src="${spot.image}" alt="${spot.name}" loading="lazy"
             onerror="this.parentElement.style.display='none'">
      </div>`;
    } else if (spot.images && spot.images.length > 1) {
      html += `<div class="spot-gallery">`;
      spot.images.forEach(src => {
        html += `<img src="${src}" alt="${spot.name}" loading="lazy"
                      onclick="window.open('${src}', '_blank')"
                      onerror="this.style.display='none'">`;
      });
      html += `</div>`;
    } else if (spot.images && spot.images.length === 1) {
      html += `<div class="spot-image" onclick="window.open('${spot.images[0]}', '_blank')">
        <img src="${spot.images[0]}" alt="${spot.name}" loading="lazy"
             onerror="this.parentElement.style.display='none'">
      </div>`;
    } else {
      // Placeholder: colored div with name and icon
      const bgColors = {
        '自然': '#27ae60', '历史': '#8e44ad', '文化': '#d35400',
        '现代': '#2980b9',
      };
      const bg = bgColors[spot.category] || '#4a90d9';
      const icons = {
        '自然': '🏞️', '历史': '🏛️', '文化': '🎭',
        '现代': '🏙️',
      };
      const icon = icons[spot.category] || '📍';
      html += `<div class="spot-placeholder" style="background:${bg}">
        <span class="placeholder-icon">${icon}</span>
        <span class="placeholder-name">${spot.name}</span>
      </div>`;
    }

    html += `<h2>${spot.name}</h2>`;
    html += `<div class="city-meta">${spot.city} · ${spot.category || '景点'}</div>`;

    // Travel info cards
    const travelCards = [];
    if (spot.visitDuration) {
      const [min, max] = spot.visitDuration;
      const durText = min === max
        ? (min >= 60 ? `${Math.floor(min/60)}h${min%60 ? min%60 + 'min' : ''}` : `${min}min`)
        : (min >= 60 ? `${Math.floor(min/60)}~${Math.floor(max/60)}h` : `${min}~${max}min`);
      travelCards.push(`<div class="travel-card">
        <span class="travel-icon">⏱</span>
        <div class="travel-label">建议游览</div>
        <div class="travel-value">${durText}</div>
      </div>`);
    }
    if (spot.ticketPrice) {
      const [lo, hi] = spot.ticketPrice;
      const priceText = lo === 0 && hi === 0 ? '免费'
        : lo === hi ? `¥${lo}`
        : `¥${lo}~${hi}`;
      travelCards.push(`<div class="travel-card">
        <span class="travel-icon">🎫</span>
        <div class="travel-label">门票参考</div>
        <div class="travel-value ${lo === 0 && hi === 0 ? 'free' : ''}">${priceText}</div>
      </div>`);
    }
    if (spot.nearestStation) {
      const ns = spot.nearestStation;
      const typeIcon = ns.type === 'metro' ? '🚇' : '🚄';
      const distText = ns.distance < 1 ? `${Math.round(ns.distance * 1000)}m` : `${ns.distance}km`;
      travelCards.push(`<div class="travel-card">
        <span class="travel-icon">${typeIcon}</span>
        <div class="travel-label">最近站点</div>
        <div class="travel-value">${ns.name} · ${distText}</div>
      </div>`);
    }
    if (travelCards.length) {
      html += `<div class="travel-info-row">${travelCards.join('')}</div>`;
    }

    if (spot.description) {
      html += `<div class="section"><p class="spot-description">${spot.description}</p></div>`;
    }

    this.elements.detailContent.innerHTML = html;
    this.elements.detailPanel.classList.remove('hidden');
  },

  hideDetail() {
    this.elements.detailPanel.classList.add('hidden');
  },

  setStatus(text) {
    this.elements.statusText.textContent = text;
  },

  updateZoomLevel(zoom) {
    this.elements.zoomLevel.textContent = `缩放: ${zoom.toFixed(1)}`;
  },

  updateMapModeStatus(isClean) {
    const modeLabel = isClean ? '纯净模式' : '标准模式';
    this.elements.statusText.textContent = `地图: ${modeLabel}`;
  },

  showDataFreshness() {
    const el = document.getElementById('data-freshness');
    if (!el) return;
    const text = DataManager.getDataFreshnessText();
    if (text) {
      el.textContent = text;
      // Tooltip with detailed timestamps
      if (DataManager.meta && DataManager.meta.datasets) {
        const details = Object.entries(DataManager.meta.datasets)
          .map(([k, v]) => `${k}: ${v.count || '?'} 条 (${v.updatedAt ? new Date(v.updatedAt).toLocaleDateString('zh-CN') : '?'})`)
          .join('\n');
        el.title = details;
      }
    }
  },

  // ---- Route Results ----

  showRouteError(msg) {
    this.elements.detailContent.innerHTML = `<h2>路线查询</h2><p style="color:#e74c3c;margin-top:12px">${msg}</p>`;
    this.elements.detailPanel.classList.remove('hidden');
  },

  showRouteResults(from, to, result) {
    const { direct, transfer } = result;
    const typeColorMap = { G: '#E63946', D: '#457B9D', C: '#2A9D8F', K: '#A0522D' };
    const typeLabelMap = { G: '高铁', D: '动车', C: '城际', K: '快速' };

    let html = `<h2>${from} → ${to}</h2>`;
    html += `<div class="city-meta">查询结果</div>`;

    // Disclaimer
    html += `<div class="route-disclaimer">
      <span>⚠</span> 车次数据为算法模拟生成，非 12306 实时数据，仅供路线参考。
    </div>`;

    if (!direct.length && !transfer.length) {
      html += `<div class="route-empty">未找到直达或换乘方案</div>`;
      // Suggest checking via nearby hub cities
      html += `<div class="route-tips">
        <p>建议尝试：</p>
        <ul>
          <li>使用更短的城市名（如"北京"而非"北京市"）</li>
          <li>检查两城市是否均有高铁站</li>
          <li>尝试通过中间枢纽城市换乘</li>
        </ul>
      </div>`;
    }

    // Direct trains
    if (direct.length) {
      html += `<div class="section">
        <h3><span class="dot" style="background:#27ae60"></span>直达车次 (${direct.length})</h3>`;
      html += `<div class="route-results-list">`;
      direct.forEach(r => {
        const color = typeColorMap[r.train.type] || '#E63946';
        const label = typeLabelMap[r.train.type] || '高铁';
        html += `<div class="route-card" data-train="${r.train.number}">
          <div class="route-card-header">
            <span class="train-number ${(r.train.type||'G').toLowerCase()}-type">${r.train.number}</span>
            <span class="route-card-type">${label}</span>
          </div>
          <div class="route-card-timeline">
            <div class="route-time-block">
              <span class="route-time">${r.depart || '--:--'}</span>
              <span class="route-station-name">${r.fromStation}</span>
            </div>
            <div class="route-duration">
              <span class="route-duration-line"></span>
              <span class="route-duration-text">${DataManager._formatDuration(r.duration)}</span>
            </div>
            <div class="route-time-block arrive">
              <span class="route-time">${r.arrive || '--:--'}</span>
              <span class="route-station-name">${r.toStation}</span>
            </div>
          </div>
          <div class="route-card-meta">${r.stops}站 · ${r.train.name}</div>
        </div>`;
      });
      html += `</div></div>`;
    }

    // Transfer routes
    if (transfer.length) {
      html += `<div class="section">
        <h3><span class="dot" style="background:#f39c12"></span>换乘方案 (${transfer.length})</h3>`;
      html += `<div class="route-results-list">`;
      transfer.forEach((r, idx) => {
        html += `<div class="route-card transfer-card" data-transfer="${idx}">
          <div class="route-card-header">
            <span class="train-number ${(r.train1.type||'G').toLowerCase()}-type">${r.train1.number}</span>
            <span class="route-transfer-arrow">→</span>
            <span class="train-number ${(r.train2.type||'G').toLowerCase()}-type">${r.train2.number}</span>
          </div>
          <div class="route-card-timeline compact">
            <div class="route-time-block">
              <span class="route-time">${r.depart || '--:--'}</span>
              <span class="route-station-name">${r.fromStation}</span>
            </div>
            <div class="route-duration">
              <span class="route-duration-line"></span>
              <span class="route-duration-text">${DataManager._formatDuration(r.duration)}</span>
            </div>
            <div class="route-time-block arrive">
              <span class="route-time">${r.arrive || '--:--'}</span>
              <span class="route-station-name">${r.toStation}</span>
            </div>
          </div>
          <div class="route-card-meta">
            换乘站: ${r.transferStation} · 等待 ${DataManager._formatDuration(r.waitMin)}
          </div>
        </div>`;
      });
      html += `</div></div>`;
    }

    this.elements.detailContent.innerHTML = html;
    this.elements.detailPanel.classList.remove('hidden');

    // Click handlers for direct train cards
    this.elements.detailContent.querySelectorAll('.route-card[data-train]').forEach(card => {
      card.addEventListener('click', () => {
        const trainNumber = card.dataset.train;
        LayerManager.highlightTrain(trainNumber);
        const train = DataManager.getTrainByNumber(trainNumber);
        if (train) this.showTrainDetail(train);
      });
    });

    // Click handlers for transfer cards: show detail
    this.elements.detailContent.querySelectorAll('.transfer-card[data-transfer]').forEach(card => {
      card.addEventListener('click', () => {
        const idx = parseInt(card.dataset.transfer);
        const r = transfer[idx];
        this.showTransferDetail(r, from, to);
      });
    });
  },

  showTransferDetail(r, fromCity, toCity) {
    const typeColorMap = { G: '#E63946', D: '#457B9D', C: '#2A9D8F', K: '#A0522D' };
    let html = `<h2>${fromCity} → ${toCity} 换乘方案</h2>`;
    html += `<div class="city-meta">经 ${r.transferStation} 换乘</div>`;

    // Leg 1
    html += `<div class="section">
      <h3><span class="dot" style="background:${typeColorMap[r.train1.type] || '#E63946'}"></span>第一段: ${r.train1.number}</h3>
      <div class="line-item" style="border-left-color:${typeColorMap[r.train1.type] || '#E63946'}">
        <div class="line-name">${r.fromStation} ${r.depart || '--:--'} → ${r.transferStation} ${r.arrive1 || '--:--'}</div>
        <div class="line-desc">${DataManager._formatDuration(r.leg1)}</div>
      </div>
    </div>`;

    // Transfer wait
    html += `<div class="transfer-wait-info">
      换乘等待: ${DataManager._formatDuration(r.waitMin)}（${r.transferStation}）
    </div>`;

    // Leg 2
    html += `<div class="section">
      <h3><span class="dot" style="background:${typeColorMap[r.train2.type] || '#E63946'}"></span>第二段: ${r.train2.number}</h3>
      <div class="line-item" style="border-left-color:${typeColorMap[r.train2.type] || '#E63946'}">
        <div class="line-name">${r.transferStation} ${r.depart2 || '--:--'} → ${r.toStation} ${r.arrive || '--:--'}</div>
        <div class="line-desc">${DataManager._formatDuration(r.leg2)}</div>
      </div>
    </div>`;

    html += `<div class="train-journey-time" style="margin-top:12px">全程: ${DataManager._formatDuration(r.duration)}</div>`;

    // Buttons to view each train's full route
    html += `<div style="display:flex;gap:8px;margin-top:12px">
      <button class="btn-back-national" onclick="LayerManager.highlightTrain('${r.train1.number}'); UIController.showTrainDetail(DataManager.getTrainByNumber('${r.train1.number}'))">查看 ${r.train1.number}</button>
      <button class="btn-back-national" onclick="LayerManager.highlightTrain('${r.train2.number}'); UIController.showTrainDetail(DataManager.getTrainByNumber('${r.train2.number}'))">查看 ${r.train2.number}</button>
    </div>`;

    this.elements.detailContent.innerHTML = html;
  },
};

// ==================== Bootstrap ====================
(async function main() {
  // 初始化 UI（不依赖 AMap）
  UIController.init();

  // 等待高德 API 就绪
  if (typeof AMap === 'undefined') {
    await new Promise(resolve => {
      window.addEventListener('amap-ready', resolve, { once: true });
      // 超时 15 秒后仍然继续（让用户看到错误提示）
      setTimeout(resolve, 15000);
    });
  }

  if (typeof AMap === 'undefined') {
    UIController.setStatus('高德地图 API 未就绪，请检查 Key 配置');
    return;
  }

  // 初始化地图
  MapManager.init('map-container');

  // 加载数据
  await DataManager.loadAll();

  // 加载数据新鲜度信息
  await DataManager.loadMeta();
  UIController.showDataFreshness();

  // 渲染侧边栏
  UIController.renderSidebar();

  // 初始化图层
  LayerManager.init();
})();
