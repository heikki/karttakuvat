import type { MapStyles } from './types';

const mmlKey = process.env.PUBLIC_MML_API_KEY ?? '';

const mmlTile = (layer: string, ext: string) =>
  `https://avoin-karttakuva.maanmittauslaitos.fi/avoin/wmts/1.0.0/${layer}/default/WGS84_Pseudo-Mercator/{z}/{y}/{x}.${ext}?api-key=${mmlKey}`;

export function mapStyles(): MapStyles {
  return {
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
          maxzoom: 17,
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
          maxzoom: 19,
          attribution: '© Esri'
        }
      },
      layers: [
        { id: 'esri-satellite', type: 'raster', source: 'esri-satellite' }
      ]
    },
    mml_maastokartta: {
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
          maxzoom: 17,
          attribution: '© OpenTopoMap (CC-BY-SA)'
        },
        mml_maastokartta: {
          type: 'raster',
          tiles: [mmlTile('maastokartta', 'png')],
          tileSize: 256,
          maxzoom: 16,
          bounds: [19.0, 59.5, 31.6, 70.1],
          attribution: '© Maanmittauslaitos'
        }
      },
      layers: [
        { id: 'opentopomap', type: 'raster', source: 'opentopomap' },
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
        'esri-satellite': {
          type: 'raster',
          tiles: [
            'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'
          ],
          tileSize: 256,
          maxzoom: 19,
          attribution: '© Esri'
        },
        'mml_ortokuva': {
          type: 'raster',
          tiles: [mmlTile('ortokuva', 'jpg')],
          tileSize: 256,
          maxzoom: 16,
          bounds: [19.0, 59.5, 31.6, 70.1],
          attribution: '© Maanmittauslaitos'
        }
      },
      layers: [
        { id: 'esri-satellite', type: 'raster', source: 'esri-satellite' },
        { id: 'mml_ortokuva', type: 'raster', source: 'mml_ortokuva' }
      ]
    }
  };
}
