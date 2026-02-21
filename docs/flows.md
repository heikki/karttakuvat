# User Flows

## Browse the collection

User opens the app and sees all photos and videos on the map, zoomed to fit. The filter panel shows the total count. Clicking "Fit" re-fits the map and opens a popup on the oldest item.

If the user previously had a URL with filters or a selected photo, the app restores that state on load — the same filters, map position, map style, marker style, and open popup are restored.

## Find a specific photo on the map

User sees markers on the map (color-coded circles in Classic mode, or white glowing dots in Points mode) and clicks one. A popup appears with a thumbnail, date, coordinates, and overlay buttons (info, Photos.app link).

The user can press left/right arrow keys to step through all filtered items chronologically. The popup moves to each item's marker on the map. Clicking the thumbnail opens the full-screen viewer. Pressing Space also opens the viewer. Clicking elsewhere on the map dismisses the popup.

## View a photo's full size

From a popup, the user can enter the full-screen viewer by clicking the thumbnail or pressing Space. It shows the photo at full resolution with date (including timezone), coordinates, and camera name.

Arrow keys cycle through all filtered items. Close with Escape, Space, or clicking outside the image. Info and "Open in Photos" buttons are available as overlays.

## Filter by year

The user picks a year from the dropdown. The album and camera dropdowns are repopulated to show only options available within that year. The map updates to show only matching items. The filter panel updates the count. All filter changes are persisted in the URL.

## Filter by album

The user picks an album from the dropdown (options are filtered by the selected year). The camera dropdown is repopulated to show only cameras used in photos matching the current year + album. If GPX track data is available for the selected album, it is loaded and displayed on the map, and a "Tracks" toggle button appears.

## Filter by camera

The user picks a camera from the dropdown (options are filtered by year + album).

## Filter by media type

The user clicks toggle buttons to show/hide photos and videos. Single-click toggles one type. Double-click solos that type (e.g. double-click "Videos" to show only videos).

## Filter by location precision

The user clicks location toggle buttons (Exif, Inferred, User, None). Same single-click/double-click behavior. Buttons are color-coded to match marker colors on the map. By default, "None" is excluded — photos without GPS are hidden until the user activates the None button.

## Switch map style

The user clicks one of the map style buttons (Aerial, Topo, Maasto, Orto). The active button gets highlighted. Map tiles change while keeping the same view position. Photo markers, GPX tracks, and measurement layers reappear after the new tiles load. The selected style is saved in the URL.

## Switch marker style

The user clicks one of the marker style buttons (Classic, Points). Classic mode (default) shows color-coded circles with white outlines (blue for GPS, amber for inferred, green for user-set, gray for no location). The selected marker gets a dark highlight ring behind it. Points mode shows minimalist white dots with a WebGL bloom glow effect and integrated night shadow. The selected marker style is saved in the URL.

## Switch map projection

The user clicks the globe control (bottom-right) to toggle between globe and flat (mercator) projections. In globe mode, an animated cosmic background (nebula and twinkling stars) is visible behind the globe. When using the Points marker style, a day/night shadow overlay shows the sun position. The current popup is re-rendered at its position after the projection switch.

## Reset the app

The user clicks the "Reset" button. This closes any open popup, exits measure mode, resets all filters to their defaults (all years, all media types, location types excluding None), resets the map style to satellite, clears the URL, and fits the map to all photos.

## Open in Apple Maps / Google Maps

The user clicks the "Apple Maps" or "Google Maps" button in the filter panel. If a photo is currently selected, the external map opens centered on that photo's location. Otherwise, it opens at the current map center and zoom level. Apple Maps opens in satellite view.

## Set a photo's location

From a popup, the user clicks "set" in the location row. The popup closes, markers hide, a placement panel appears showing the photo's thumbnail and date, and the cursor becomes a crosshair. The user clicks on the map to place the photo. The marker reappears at the new location with a popup. The change is stored as a pending edit.

The user can cancel placement mode by pressing Escape.

## Copy and paste a location

The user clicks "copy" on a photo's location row. Then navigates to another photo and clicks "paste" (which appears when a different location is copied). The pasted location becomes a pending edit.

## Adjust a photo's date/time

From a popup, the user clicks "edit" on the date row. Time adjustment buttons appear: ±1 day, ±1 hour. Each click adjusts the effective date immediately in the popup. The user clicks "done" to exit edit mode.

For precise adjustments, the user can type a date in the text input (format: `D.M.YYYY HH:MM` or just `D.M HH:MM`) and press Enter.

## Copy and paste a date

The user clicks "copy" on a photo's date row. Then navigates to another photo and clicks "paste" (which appears when a different date is copied). This computes the hour offset needed to match the copied datetime.

## Save edits

When pending edits exist, the filter panel shows "N pending edits" with Save and Discard buttons. Clicking "Save to Photos" sends the edits to the server, which applies them to Photos.app and updates items.json. The data reloads and the current popup reopens. On error, an alert is shown.

## Discard edits

Clicking "Discard" clears all pending location and time edits. Markers return to their original positions and dates revert.

## View photo metadata

The user clicks the info button (on a popup image or in the lightbox). A modal appears showing detailed metadata fetched from Photos.app: filename, dates, title, description, keywords, albums, persons, labels, AI caption, dimensions, location, EXIF data, and more. The UUID has a copy button. Close with X, backdrop click, or Escape.

## Open a photo in Apple Photos

The popup and the lightbox show a Photos.app link button (visible when the photo has a `photos_url`). Clicking it opens Apple Photos at that specific photo.

## View GPX tracks

When the user selects an album that has associated GPX files, the tracks are automatically loaded and displayed on the map as colored lines with waypoint markers. A "Tracks" button appears in the filter panel to toggle track visibility. Track visibility is persisted in the URL.

## Measure distances on the map

The user clicks the "Measure" button in the filter panel. The button highlights blue and the cursor becomes a crosshair. Each click on the map adds a point, connected by a dashed red line to previous points. A floating overlay at the top of the screen shows the cumulative distance.

To remove a point, the user clicks on it. To finish, the user presses Escape or clicks the "Measure" button again — all points and the line are cleared.

## Collapse the filter panel

The user clicks the panel header ("Karttakuvat" title area) to collapse the panel body, leaving only the header visible. Clicking again expands it.

## Dismiss things

- **Popup**: click map background or press Escape
- **Lightbox**: click outside the image, press Escape, or press Space
- **Metadata modal**: click backdrop, press Escape, or click X
- **Measurement mode**: press Escape or click "Measure" button
- **Placement mode**: press Escape
- **Date edit mode**: press Escape or click "done"
- Priority order: metadata modal > date edit > placement > measurement > lightbox > popup
