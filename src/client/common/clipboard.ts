let copiedLocation: { lat: number; lon: number } | null = null;

export function copyLocation(lat: number, lon: number) {
  copiedLocation = { lat, lon };
}

export function getCopiedLocation(): { lat: number; lon: number } | null {
  return copiedLocation;
}

let copiedDate: string | null = null;

export function copyDate(datePart: string) {
  copiedDate = datePart;
}

export function getCopiedDate(): string | null {
  return copiedDate;
}
