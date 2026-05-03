import type { Photo } from '@common/types';
import { getYear } from '@common/utils';

export function cascade(
  photos: Photo[],
  requested: { year: string; album: string; camera: string }
): {
  album: string;
  camera: string;
  albumOptions: string[];
  cameraOptions: string[];
  filtered: Photo[];
} {
  const yearPhotos =
    requested.year === 'all'
      ? photos
      : photos.filter((p) => getYear(p) === requested.year);

  const albumOptions = [...new Set(yearPhotos.flatMap((p) => p.albums))].sort();
  const album =
    requested.album !== 'all' && !albumOptions.includes(requested.album)
      ? 'all'
      : requested.album;

  const albumPhotos =
    album === 'all'
      ? yearPhotos
      : yearPhotos.filter((p) => p.albums.includes(album));

  const cameraOptions = [
    ...new Set(albumPhotos.map((p) => p.camera ?? '(unknown)'))
  ].sort();
  const camera =
    requested.camera !== 'all' && !cameraOptions.includes(requested.camera)
      ? 'all'
      : requested.camera;

  const filtered =
    camera === 'all'
      ? albumPhotos
      : albumPhotos.filter((p) => (p.camera ?? '(unknown)') === camera);

  return { album, camera, albumOptions, cameraOptions, filtered };
}
