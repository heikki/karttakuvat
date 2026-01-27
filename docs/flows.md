# User Flows

## Browse the collection

User opens the app and sees all photos on the map, zoomed to fit. The stats panel shows the total count and date range. Clicking the count or "photos found" opens a full-screen viewer starting from the oldest photo, with arrow keys to step through chronologically.

## Find a specific photo on the map

User sees markers on the map and clicks one. A popup appears with a thumbnail, date, and coordinates. If the popup is cut off by the screen edge, the map pans to make room.

The user can press left/right arrow keys to step through all filtered photos chronologically. The popup moves to each photo's marker on the map. Clicking the thumbnail opens the full-screen viewer. Clicking elsewhere on the map dismisses the popup.

## Explore a cluster of nearby photos

When photos are close together, the user shift+drags a rectangle over the area. A popup appears showing how many photos were selected and their date range, with a scrollable thumbnail strip at the bottom. The map zooms to the selected area.

The user browses the group by clicking thumbnails or pressing left/right arrow keys. Each step highlights the corresponding marker on the map. Clicking the main image opens the full-screen viewer scoped to just this group.

The selection rectangle stays visible until the popup is dismissed (click away or Escape).

If the user clicks a marker that belongs to the current group, it selects that photo within the group rather than opening a new popup.

## View a photo's full size

From any popup or from the stats panel count, the user can enter the full-screen viewer. It shows the photo at full resolution with date, coordinates, and a position counter (e.g. "3 of 45").

- If entered from a popup group: arrows cycle within that group only
- If entered from the stats panel or a single-photo popup: arrows cycle through all filtered photos

Close with Escape or clicking outside the image. The "Open in Photos" link jumps to the photo in Apple Photos.

## Filter by year

The user picks a year from the dropdown. The map updates to show only that year's photos. If any of the remaining photos are outside the current view, the map re-fits to include them. If they're all already visible, the view stays unchanged — no unnecessary zoom.

The stats panel updates to reflect the filtered count and date range.

## Filter by location precision

The user picks a GPS precision level (precise GPS, inferred, or user-modified) from the dropdown. This combines with the year filter — both apply at once. Same map fitting logic as year filter.

## Switch map style

The user picks a different base map (topo, satellite, street, cycling). The map tiles change while keeping the same view position. Photo markers reappear after the new tiles load.

## Open a photo in Apple Photos

Single-photo popup, multi-photo popup, and the full-screen viewer all show an "Open in Photos" link when available. Clicking it opens Apple Photos at that specific photo.

## Dismiss things

- **Popup**: click map background or press Escape
- **Full-screen viewer**: click outside the image or press Escape
- **Selection rectangle**: dismissed automatically when its popup closes
- If both the viewer and a popup are open, Escape closes the viewer first
