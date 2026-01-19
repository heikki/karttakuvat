import type { MapStyles } from './types';

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
  osm: {
    version: 8,
    sources: {
      osm: {
        type: 'raster',
        tiles: [
          'https://a.tile.openstreetmap.org/{z}/{x}/{y}.png',
          'https://b.tile.openstreetmap.org/{z}/{x}/{y}.png',
          'https://c.tile.openstreetmap.org/{z}/{x}/{y}.png'
        ],
        tileSize: 256,
        attribution: '© OpenStreetMap contributors'
      }
    },
    layers: [{ id: 'osm', type: 'raster', source: 'osm' }]
  },
  cyclosm: {
    version: 8,
    sources: {
      cyclosm: {
        type: 'raster',
        tiles: [
          'https://a.tile-cyclosm.openstreetmap.fr/cyclosm/{z}/{x}/{y}.png',
          'https://b.tile-cyclosm.openstreetmap.fr/cyclosm/{z}/{x}/{y}.png',
          'https://c.tile-cyclosm.openstreetmap.fr/cyclosm/{z}/{x}/{y}.png'
        ],
        tileSize: 256,
        attribution: '© CyclOSM, OpenStreetMap contributors'
      }
    },
    layers: [{ id: 'cyclosm', type: 'raster', source: 'cyclosm' }]
  }
};
