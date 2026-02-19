import type { MapStyles } from '../common/types';

const mmlKey = process.env.PUBLIC_MML_API_KEY ?? '';
const tfKey = process.env.PUBLIC_THUNDERFOREST_API_KEY ?? '';

const mmlTile = (layer: string, ext: string) =>
  `https://avoin-karttakuva.maanmittauslaitos.fi/avoin/wmts/1.0.0/${layer}/default/WGS84_Pseudo-Mercator/{z}/{y}/{x}.${ext}?api-key=${mmlKey}`;

export function mapStyles(): MapStyles {
  return {
    satellite: {
      version: 8,
      sources: {
        'google-satellite': {
          type: 'raster',
          tiles: [
            'https://mt0.google.com/vt/lyrs=s&x={x}&y={y}&z={z}',
            'https://mt1.google.com/vt/lyrs=s&x={x}&y={y}&z={z}',
            'https://mt2.google.com/vt/lyrs=s&x={x}&y={y}&z={z}',
            'https://mt3.google.com/vt/lyrs=s&x={x}&y={y}&z={z}'
          ],
          tileSize: 256,
          maxzoom: 20,
          attribution: '© Google'
        }
      },
      layers: [
        { id: 'google-satellite', type: 'raster', source: 'google-satellite' }
      ]
    },
    topo: {
      version: 8,
      sources: {
        thunderforest: {
          type: 'raster',
          tiles: [
            `https://a.tile.thunderforest.com/outdoors/{z}/{x}/{y}.png?apikey=${tfKey}`,
            `https://b.tile.thunderforest.com/outdoors/{z}/{x}/{y}.png?apikey=${tfKey}`,
            `https://c.tile.thunderforest.com/outdoors/{z}/{x}/{y}.png?apikey=${tfKey}`
          ],
          tileSize: 256,
          maxzoom: 22,
          attribution: '© Thunderforest, © OpenStreetMap contributors'
        }
      },
      layers: [{ id: 'thunderforest', type: 'raster', source: 'thunderforest' }]
    },
    mml_maastokartta: {
      version: 8,
      sources: {
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
        {
          id: 'background',
          type: 'background',
          paint: { 'background-color': '#ffffff' }
        },
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
          bounds: [19.0, 59.5, 31.6, 70.1],
          attribution: '© Maanmittauslaitos'
        }
      },
      layers: [
        {
          id: 'background',
          type: 'background',
          paint: { 'background-color': '#ffffff' }
        },
        { id: 'mml_ortokuva', type: 'raster', source: 'mml_ortokuva' }
      ]
    }
  };
}
