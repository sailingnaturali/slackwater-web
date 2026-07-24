#!/usr/bin/env bash
# Build public/land.pmtiles: OSM coastline land polygons for the Salish Sea.
# Pipeline from ../slackwater/docs/land-tiles-problem.md (z0-14). ~4.8 MB for the
# app-wide box below (the doc's 3.2 MB was a smaller bbox to 49.6N).
# Requires: ogr2ogr (gdal), tippecanoe — both `brew install`able.
# Known limit, recorded in the spec: tidal estuaries (Everett/Olympia deltas)
# are outside natural=coastline; fix path is the seamap Planetiler profile.
set -euo pipefail
cd "$(dirname "$0")/.."

# App-wide Salish box (minLon minLat maxLon maxLat = -125.5 47.0 -122.0 50.5),
# passed as a WKT polygon rather than four bare numbers: GDAL's arg parser reads
# a leading "-125.5" as an option ("Too few arguments for -clipsrc") and silently
# clips nothing, producing an empty tileset.
CLIP_WKT="POLYGON((-125.5 47.0,-122.0 47.0,-122.0 50.5,-125.5 50.5,-125.5 47.0))"
SRC_URL="https://osmdata.openstreetmap.de/download/land-polygons-split-4326.zip"
WORK=$(mktemp -d)
trap 'rm -rf "$WORK"' EXIT

curl -fL "$SRC_URL" -o "$WORK/land.zip"
unzip -q "$WORK/land.zip" -d "$WORK"

# -nlt PROMOTE_TO_MULTI: the source mixes Polygon and MultiPolygon; without this
# ogr2ogr fixes the FlatGeobuf layer type to Polygon and dies on the first
# MultiPolygon feature ("Mismatched geometry type").
ogr2ogr -f FlatGeobuf -nlt PROMOTE_TO_MULTI -clipsrc "$CLIP_WKT" "$WORK/salish-land.fgb" \
  "$WORK/land-polygons-split-4326/land_polygons.shp"

tippecanoe -Z0 -z14 -l land --coalesce-densest-as-needed --force \
  -o public/land.pmtiles "$WORK/salish-land.fgb"

ls -la public/land.pmtiles
