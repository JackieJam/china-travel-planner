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
  currentZoom: 5,

  init(container) {
    this.map = new AMap.Map(container, {
      zoom: 4.5,
      center: [105, 35],
      viewMode: '2D',
      mapStyle: 'amap://styles/normal',
      resizeEnable: true,
      zooms: [3, 18],
    });

    this.map.setLimitBounds(new AMap.Bounds([73, 17], [136, 54]));

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
      this._setOverlaysVisible(this.overlays.metroLines, show);
      this._setOverlaysVisible(this.overlays.metroStations, show);
    } else if (layerName === 'spots') {
      if (show && this.selectedCity) {
        this._renderSpotsLayer(this.selectedCity);
      }
      this._setOverlaysVisible(this.overlays.spotMarkers, show);
    }
  },

  onZoomChange(zoom) {
    // 缩放级别变化时可以调整标注可见性
    const showHSRLabels = zoom >= 5;
    this._setOverlaysVisible(this.overlays.hsrLabels, showHSRLabels && this.visible.hsr);

    // Control line visibility by zoom level and importance
    this.overlays.hsrLines.forEach(line => {
      const data = line.getExtData();
      const importance = data ? data.importance : 1;
      let show = false;
      if (zoom >= 8) show = true;
      else if (zoom >= 6 && importance <= 3) show = true;
      else if (zoom >= 5 && importance <= 2) show = true;
      else if (importance <= 1) show = true;

      // Also check line type filter state
      const lineType = data ? data.lineType : 'G';
      if (show && this.visible.hsr && this._lineFilterVisible(lineType)) {
        line.show();
      } else {
        line.hide();
      }
    });

    // Control station marker visibility by zoom and importance
    this.overlays.hsrStations.forEach(marker => {
      const importance = marker._stationImportance || 3;
      let show = false;
      if (zoom >= 10) show = true;
      else if (zoom >= 7 && importance <= 2) show = true;
      else if (zoom >= 5 && importance <= 1) show = true;

      if (show && this.visible.hsr) marker.show(); else marker.hide();
    });

    // Control station labels by zoom and importance
    this.overlays.stationLabels.forEach(label => {
      const importance = label._stationImportance || 3;
      let show = false;
      if (zoom >= 10) show = true;
      else if (zoom >= 7 && importance <= 2) show = true;
      else if (zoom >= 5 && importance <= 1) show = true;

      if (show && MapManager._cleanMode && this.visible.hsr) label.show(); else label.hide();
    });
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

      // Check zoom-based visibility
      let showByZoom = false;
      if (zoom >= 8) showByZoom = true;
      else if (zoom >= 6 && importance <= 3) showByZoom = true;
      else if (zoom >= 5 && importance <= 2) showByZoom = true;
      else if (importance <= 1) showByZoom = true;

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

    // 飞入城市
    MapManager.flyTo(city.center, city.zoom || 11);

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
    MapManager.flyTo([105, 35], 4.5);
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

    metroData.lines.forEach(line => {
      const path = line.stations.map(s => s.center);
      if (path.length < 2) return;

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

      polyline.on('click', () => {
        UIController.showMetroLineDetail(line, cityName);
      });

      map.add(polyline);
      this.overlays.metroLines.push(polyline);

      // 地铁站标记
      line.stations.forEach(station => {
        const marker = new AMap.Marker({
          position: station.center,
          content: `<div style="width:6px;height:6px;background:#fff;border:2px solid ${line.color};border-radius:50%;cursor:pointer;" title="${station.name}"></div>`,
          offset: new AMap.Pixel(-4, -4),
          zIndex: 85,
        });

        marker._stationImportance = this._getStationImportance(station.name);

        marker.on('click', () => {
          // 查找该站属于哪些地铁线
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
              'font-weight': '500',
            },
            zIndex: 86,
            visible: MapManager._cleanMode,
          });
          label._stationImportance = this._getStationImportance(station.name);
          map.add(label);
          this.overlays.stationLabels.push(label);
        }
      });
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
};

// ==================== Bootstrap ====================
(async function main() {
  // 初始化 UI
  UIController.init();

  // 初始化地图
  MapManager.init('map-container');

  // 加载数据
  await DataManager.loadAll();

  // 渲染侧边栏
  UIController.renderSidebar();

  // 初始化图层
  LayerManager.init();
})();
