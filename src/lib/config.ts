import type { MapStyles } from './types';

let mmlKey = '';

const mmlTile = (layer: string, ext: string) =>
  `https://avoin-karttakuva.maanmittauslaitos.fi/avoin/wmts/1.0.0/${layer}/default/WGS84_Pseudo-Mercator/{z}/{y}/{x}.${ext}?api-key=${mmlKey}`;

export async function loadConfig() {
  const res = await fetch('/api/config');
  const config = (await res.json()) as { mmlApiKey: string };
  mmlKey = config.mmlApiKey;
}

export const mapStyles: MapStyles = {
  opentopomap: {
    version: 8,
    sources: {
      opentopomap: {
        type: 'raster',
        tiles: [
          'https://a.tile.opentopomap.org/{z}/{x}/{y}.png',
          'https://b.tile.opentopomap.org/{z}/{x}/{y}.png',
          'https://c.tile.opentopomap.org/{z}/{x}/{y}.png'
        ],
        tileSize: 256,
        attribution: '© OpenTopoMap (CC-BY-SA)'
      }
    },
    layers: [{ id: 'opentopomap', type: 'raster', source: 'opentopomap' }]
  },
  satellite: {
    version: 8,
    sources: {
      'esri-satellite': {
        type: 'raster',
        tiles: [
          'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'
        ],
        tileSize: 256,
        attribution: '© Esri'
      }
    },
    layers: [{ id: 'esri-satellite', type: 'raster', source: 'esri-satellite' }]
  },
  mml_maastokartta: {
    version: 8,
    sources: {
      mml_maastokartta: {
        type: 'raster',
        tiles: [mmlTile('maastokartta', 'png')],
        tileSize: 256,
        maxzoom: 16,
        attribution: '© Maanmittauslaitos'
      }
    },
    layers: [
      {
        id: 'mml_maastokartta',
        type: 'raster',
        source: 'mml_maastokartta'
      }
    ]
  },
  mml_ortokuva: {
    version: 8,
    sources: {
      mml_ortokuva: {
        type: 'raster',
        tiles: [mmlTile('ortokuva', 'jpg')],
        tileSize: 256,
        maxzoom: 16,
        attribution: '© Maanmittauslaitos'
      }
    },
    layers: [
      { id: 'mml_ortokuva', type: 'raster', source: 'mml_ortokuva' }
    ]
  }
};
