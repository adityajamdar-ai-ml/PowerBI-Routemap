import * as L from 'leaflet';
import { ILocation, IBound } from './converter';
import { bound, anchor, fitOptions, area } from './converter';
// anchorPixel removed — pixel conversion is handled inline via L.Map.latLngToContainerPoint
import { keys, IPoint, partial } from '../type';
import { ISelex, selex } from '../d3';

export interface IMapElement {
  forest: boolean,
  label: boolean,
  road: "color" | "gray" | 'gray_label' | "hidden",
  icon: boolean,
  area: boolean,
  building: boolean,
  city: boolean,
  scale: boolean
}

export interface IMapControl {
  type: 'hidden' | 'road' | 'grayscale' | 'canvasDark' | 'canvasLight',
  lang: string,
  pan: boolean,
  zoom: boolean
}

export interface IMapFormat extends IMapControl, IMapElement { }

export function defaultZoom(width: number, height: number): number {
  const min = Math.min(width, height);
  for (var level = 1; level < 20; level++) {
    if (256 * Math.pow(2, level) > min) {
      break;
    }
  }
  return level;
}

export class MapFormat implements IMapFormat {
  type = 'road' as 'road' | 'grayscale' | 'canvasDark' | 'canvasLight';
  lang = 'default';
  pan = true;
  zoom = true;
  city = false;
  road = "color" as "color" | "gray" | 'gray_label' | "hidden";
  label = true;
  forest = true;
  icon = false;
  building = false;
  area = false;
  scale = false;

  public static build(...fmts: any[]): MapFormat {
    var ret = new MapFormat();
    for (let f of fmts.filter(v => v)) {
      for (var key in ret) {
        if (key in f) {
          ret[key] = f[key];
        }
      }
    }
    return ret;
  }

  public static control<T>(fmt: MapFormat, extra: T): IMapControl & T {
    let result = partial(fmt, ['type', 'lang', 'pan', 'zoom']) as any;
    for (let key in extra) {
      result[key] = extra[key];
    }
    return result;
  }

  public static element<T>(fmt: MapFormat, extra: T): IMapElement & T {
    let result = partial(fmt, ['road', 'forest', 'label', 'city', 'icon', 'building', 'area', 'scale']) as any;
    for (let key in extra) {
      result[key] = extra[key];
    }
    return result;
  }
}

function tileUrl(type: IMapFormat['type']): string | null {
  switch (type) {
    case 'road':        return 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png';
    case 'grayscale':   return 'https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png';
    case 'canvasDark':  return 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png';
    case 'canvasLight': return 'https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png';
    case 'hidden':      return null;
    default:            return 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png';
  }
}

function tileAttribution(type: IMapFormat['type']): string {
  switch (type) {
    case 'grayscale':
    case 'canvasLight':
    case 'canvasDark':
      return '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> © <a href="https://carto.com/attributions">CARTO</a>';
    default:
      return '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors';
  }
}

export interface IListener {
  transform?(ctl: Controller, pzoom: number, end?: boolean): void;
  resize?(ctl: Controller): void;
}

export class Controller {
  private _div: HTMLDivElement;
  private _map: L.Map;
  private _tileLayer: L.TileLayer | null = null;
  private _scaleControl: L.Control.Scale | null = null;
  private _fmt: IMapFormat;
  private _svg: ISelex;
  private _svgroot: ISelex;
  private _canvas: ISelex;

  public get map() { return this._map; }
  public get format() { return this._fmt; }
  public get svg() { return this._svgroot; }
  public get canvas() { return this._canvas; }

  public location(p: IPoint): ILocation {
    const size = this._map.getSize();
    const latlng = this._map.containerPointToLatLng(L.point(p.x + size.x / 2, p.y + size.y / 2));
    return { latitude: latlng.lat, longitude: latlng.lng };
  }

  public setCenterZoom(center: { lat: number, lng: number } | ILocation, zoom: number) {
    if (this._map) {
      zoom = Math.min(20, Math.max(1, zoom));
      const lat = 'lat' in center ? center.lat : (center as ILocation).latitude;
      const lng = 'lng' in center ? center.lng : (center as ILocation).longitude;
      this._map.setView([lat, lng], zoom, { animate: false });
    }
  }

  public pixel(loc: ILocation | IBound): IPoint {
    const anchor = (loc as IBound).anchor ? (loc as IBound).anchor : loc as ILocation;
    const size = this._map.getSize();
    const p = this._map.latLngToContainerPoint(L.latLng(anchor.latitude, anchor.longitude));
    return { x: p.x - size.x / 2, y: p.y - size.y / 2 };
  }

  public anchor(locs: ILocation[]) { return anchor(locs); }
  public area(locs: ILocation[], level = 20) { return area(locs, level); }
  public bound(locs: ILocation[]): IBound { return bound(locs); }

  private _listener: IListener[] = [];
  public add(v: IListener) { this._listener.push(v); return this; }

  public fitView(areas: IBound[], backupCenter?: ILocation) {
    const size = this._map.getSize();
    const config = fitOptions(areas, { width: size.x, height: size.y });
    this._map.setView([config.center.latitude, config.center.longitude], config.zoom, { animate: false });
    this._viewChange(false);
  }

  constructor(id: string) {
    const div = selex(id).node<HTMLDivElement>();
    this._fmt = {} as IMapFormat;
    this._div = div;
    const applyStyle = (root: ISelex) => {
      root.att.tabIndex(-1)
        .sty.pointer_events('none')
        .sty.position('absolute')
        .sty.visibility('inherit')
        .sty.user_select('none');
      return root;
    };
    this._canvas = applyStyle(selex(div).append('canvas'));
    this._svg = applyStyle(selex(div).append('svg'));
    this._svgroot = this._svg.append('g').att.id('root');
  }

  private _applyTileLayer() {
    if (this._tileLayer) {
      this._map.removeLayer(this._tileLayer);
      this._tileLayer = null;
    }
    const url = tileUrl(this._fmt.type);
    if (url) {
      this._tileLayer = L.tileLayer(url, {
        attribution: tileAttribution(this._fmt.type),
        subdomains: 'abcd',
        maxZoom: 19
      });
      this._tileLayer.addTo(this._map);
    }
    if (this._scaleControl) {
      this._scaleControl.remove();
      this._scaleControl = null;
    }
    if (this._fmt.scale) {
      this._scaleControl = L.control.scale({ position: 'bottomleft' });
      this._scaleControl.addTo(this._map);
    }
  }

  private _applyInteraction() {
    if (!this._map) { return; }
    if (this._fmt.pan) {
      this._map.dragging.enable();
    } else {
      this._map.dragging.disable();
    }
    if (this._fmt.zoom) {
      this._map.scrollWheelZoom.enable();
      this._map.doubleClickZoom.enable();
      this._map.touchZoom && this._map.touchZoom.enable();
      this._map.boxZoom && this._map.boxZoom.enable();
    } else {
      this._map.scrollWheelZoom.disable();
      this._map.doubleClickZoom.disable();
      this._map.touchZoom && this._map.touchZoom.disable();
      this._map.boxZoom && this._map.boxZoom.disable();
    }
  }

  private _viewChange(end = false) {
    const zoom = this._map.getZoom();
    for (const l of this._listener) {
      l.transform && l.transform(this, this._zoom, end);
    }
    this._zoom = zoom;
  }

  private _zoom: number;

  private _resize(): void {
    if (!this._map) { return; }
    const size = this._map.getSize();
    const w = size.x, h = size.y;
    this._svg.att.width('100%').att.height('100%');
    this._canvas && this._canvas.att.size(w, h);
    this._svgroot.att.translate(w / 2, h / 2);
    for (const l of this._listener) {
      l.resize && l.resize(this);
    }
  }

  restyle(fmt: Partial<IMapFormat>, then?: (map: any) => void): Controller {
    then = then || (() => { });
    const dirty = {} as Partial<IMapFormat>;
    for (const k in fmt) {
      if (fmt[k] !== this._fmt[k]) {
        dirty[k] = this._fmt[k] = fmt[k];
      }
    }

    if (!this._map) {
      const initZoom = defaultZoom(this._div.clientWidth || 400, this._div.clientHeight || 300);
      this._map = L.map(this._div, {
        center: [0, 0],
        zoom: initZoom,
        zoomControl: false,
        attributionControl: true,
      });
      // Move SVG/canvas on top of Leaflet's internal panes
      this._div.appendChild(this._canvas.node());
      this._div.appendChild(this._svg.node());
      (this._svg.node() as any as HTMLElement).style.zIndex = '800';
      this._map.on('move', () => this._viewChange(false));
      this._map.on('moveend', () => this._viewChange(true));
      this._map.on('resize', () => this._resize());
      this._applyTileLayer();
      this._applyInteraction();
      this._resize();
      then(this._map);
      return this;
    }

    if (keys(dirty).length === 0) {
      then(null);
      return this;
    }

    const tileKeys = { type: 1, scale: 1 };
    const interactionKeys = { pan: 1, zoom: 1 };
    let needTile = false, needInteraction = false;
    for (const k in dirty) {
      if (k in tileKeys) { needTile = true; }
      if (k in interactionKeys) { needInteraction = true; }
    }
    if (needTile) { this._applyTileLayer(); }
    if (needInteraction) { this._applyInteraction(); }
    then(null);
    return this;
  }
}
