# User Flows

## Browse the collection

User opens the app and sees all photos and videos on the map, zoomed to fit. The stats panel shows the total count. Clicking "Fit" re-fits the map and opens a popup on the oldest item.

If the user previously had a URL with filters or a selected photo, the app restores that state on load — the same filters, map position, map style, and open popup are restored.

## Find a specific photo on the map

User sees color-coded markers on the map (blue for GPS, amber for inferred, green for user-set, gray for no location) and clicks one. A popup appears with a thumbnail, date, coordinates, and overlay buttons (info, Photos.app link).

The user can press left/right arrow keys to step through all filtered items chronologically. The popup moves to each item's marker on the map. Clicking the thumbnail opens the full-screen viewer. Pressing Space also opens the viewer. Clicking elsewhere on the map dismisses the popup.

## Explore a cluster of nearby photos

When photos are close together, the user shift+drags a rectangle over the area. A popup appears showing how many photos and videos were selected and their date range, with a scrollable thumbnail strip at the bottom. The map zooms to the selected area.

The user browses the group by clicking thumbnails or pressing left/right arrow keys. Each step highlights the corresponding marker on the map with a pulsing ring. Clicking the main image or pressing Space opens the full-screen viewer scoped to just this group.

The selection rectangle stays visible until the popup is dismissed (click away or Escape).

If the user clicks a marker that belongs to the current group, it selects that photo within the group rather than opening a new popup.

## View a photo's full size

From any popup, the user can enter the full-screen viewer by clicking the thumbnail or pressing Space. It shows the photo at full resolution with date (including timezone), coordinates, camera name, and a position counter (e.g. "3 of 45").

- If entered from a group popup: arrows cycle within that group only
- If entered from a single-photo popup: arrows cycle through all filtered items

Close with Escape, Space, or clicking outside the image. Info and "Open in Photos" buttons are available as overlays.

## Filter by year

The user picks a year from the dropdown. The album and camera dropdowns are repopulated to show only options available within that year. The map updates to show only matching items. The stats panel updates the count. All filter changes are persisted in the URL.

## Filter by album

The user picks an album from the dropdown (options are filtered by the selected year). The camera dropdown is repopulated to show only cameras used in photos matching the current year + album.

## Filter by camera

The user picks a camera from the dropdown (options are filtered by year + album).

## Filter by media type

The user clicks toggle buttons to show/hide photos and videos. Single-click toggles one type. Double-click solos that type (e.g. double-click "Videos" to show only videos).

## Filter by location precision

The user clicks GPS precision toggle buttons (Exif, Inferred, User, None). Same single-click/double-click behavior. Buttons are color-coded to match marker colors on the map.

## Switch map style

The user clicks one of the map style buttons (Topo, Satellite, Maasto, Orto). The active button gets highlighted. Map tiles change while keeping the same view position. Photo markers reappear after the new tiles load. The selected style is saved in the URL.

## Switch map projection

The user clicks the globe control (bottom-right) to toggle between globe and flat (mercator) projections. In globe mode, a day/night shadow overlay is visible, showing the sun position corresponding to the currently viewed photo's date and time. The shadow animates smoothly when navigating between photos.

## Reset the app

The user clicks the "Reset" button next to "Fit". This closes any open popup, clears the selection, resets the night layer to the current time, resets all filters to their defaults (all years, all media types, all GPS types), clears the URL, and fits the map to all photos.

## Set a photo's location

From a single-photo popup, the user clicks "set" in the location row. The popup closes, markers hide, a placement panel appears showing the photo's thumbnail and date, and the cursor becomes a crosshair. The user clicks on the map to place the photo. The marker reappears at the new location with a popup. The change is stored as a pending edit.

The user can cancel placement mode by pressing Escape.

## Copy and paste a location

The user clicks "copy" on a photo's location row. Then navigates to another photo and clicks "paste" (which appears when a different location is copied). The pasted location becomes a pending edit.

## Adjust a photo's date/time

From a popup, the user clicks "edit" on the date row. Time adjustment buttons appear: ±1 day, ±1 hour. Each click adjusts the effective date immediately in the popup. The user clicks "done" to exit edit mode.

For precise adjustments, the user can type a date in the text input (format: `D.M.YYYY HH:MM` or just `D.M HH:MM`) and press Enter.

## Copy and paste a date

The user clicks "copy" on a photo's date row. Then navigates to another photo and clicks "paste" (which appears when a different date is copied). This computes the hour offset needed to match the copied datetime.

## Save edits

When pending edits exist, the stats panel shows "N pending edits" with Save and Discard buttons. Clicking "Save to Photos" sends the edits to the server, which applies them to Photos.app and updates items.json. The data reloads and the current popup reopens.

## Discard edits

Clicking "Discard" clears all pending location and time edits. Markers return to their original positions and dates revert.

## View photo metadata

The user clicks the info button (on a popup image or in the lightbox). A modal appears showing detailed metadata fetched from Photos.app: filename, dates, title, description, keywords, albums, persons, labels, AI caption, dimensions, location, EXIF data, and more. The UUID has a copy button. Close with X, backdrop click, or Escape.

## Open a photo in Apple Photos

Single-photo popup, multi-photo popup, and the lightbox all show a Photos.app link button (visible when the photo has a `photos_url`). Clicking it opens Apple Photos at that specific photo.

## Measure distances on the map

The user clicks the "Measure" button in the stats panel. The button highlights blue and the cursor becomes a crosshair. Each click on the map adds a point, connected by a dashed red line to previous points. A floating overlay at the top of the screen shows the cumulative distance.

To remove a point, the user clicks on it. To finish, the user presses Escape or clicks the "Measure" button again — all points and the line are cleared.

## Dismiss things

- **Popup**: click map background or press Escape
- **Lightbox**: click outside the image, press Escape, or press Space
- **Selection rectangle**: dismissed automatically when its popup closes
- **Metadata modal**: click backdrop, press Escape, or click X
- **Measurement mode**: press Escape or click "Measure" button
- **Placement mode**: press Escape
- **Date edit mode**: press Escape or click "done"
- Priority order: metadata modal > date edit > placement > measurement > lightbox > popup
