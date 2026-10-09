import { useEffect, useRef } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import type { AnalysisDocument } from '../api/client';
import { api } from '../api/client';

// Fix default icon paths broken by Vite bundling
delete (L.Icon.Default.prototype as unknown as Record<string, unknown>)._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png',
  iconUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png',
  shadowUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
});

interface FloodMapProps {
  jobId: string;
  summary: AnalysisDocument;
  layers: { path: string; url: string; media_type: string }[];
  visibleLayers: Record<string, boolean>;
}

const LAYER_COLORS: Record<string, string> = {
  flood: '#1565c0',
  debris: '#f57c00',
  roads: '#555555',
  buildings: '#8e44ad',
  bridges: '#c62828',
  settlements: '#2e7d32',
};

export default function FloodMap({ jobId, summary, layers, visibleLayers }: FloodMapProps) {
  const mapRef = useRef<L.Map | null>(null);
  const mapDivRef = useRef<HTMLDivElement>(null);
  const geojsonLayersRef = useRef<Record<string, L.Layer>>({});

  // Initialize map once
  useEffect(() => {
    if (!mapDivRef.current || mapRef.current) return;

    const bbox = summary.aoi_summary.aoi_bbox_wgs84;
    const center: [number, number] = bbox.length >= 4
      ? [(bbox[1] + bbox[3]) / 2, (bbox[0] + bbox[2]) / 2]
      : [27.7, 85.3];

    const map = L.map(mapDivRef.current, {
      center,
      zoom: 10,
      zoomControl: true,
    });

    // Base layer
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '© OpenStreetMap contributors',
      maxZoom: 19,
    }).addTo(map);

    // AOI outline
    if (summary.aoi && summary.aoi.type) {
      try {
        const aoiLayer = L.geoJSON(summary.aoi as unknown as GeoJSON.GeoJsonObject, {
          style: {
            color: '#1565c0',
            weight: 2,
            fillOpacity: 0.05,
            dashArray: '6 4',
          },
        }).addTo(map);
        // Fit to AOI
        if (aoiLayer.getBounds().isValid()) {
          map.fitBounds(aoiLayer.getBounds(), { padding: [20, 20] });
        }
      } catch { /* ignore */ }
    } else if (bbox.length >= 4) {
      map.fitBounds([[bbox[1], bbox[0]], [bbox[3], bbox[2]]]);
    }

    mapRef.current = map;

    return () => {
      map.remove();
      mapRef.current = null;
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Load GeoJSON layers from backend
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    const geojsonLayers = layers.filter(l => l.media_type === 'application/geo+json');

    geojsonLayers.forEach(async layer => {
      const key = layer.path;
      if (geojsonLayersRef.current[key]) return; // already loaded

      try {
        const res = await fetch(api.getLayerUrl(jobId, layer.path));
        if (!res.ok) return;
        const geojson = await res.json();

        const isFlood = key.includes('flood');
        const isDebris = key.includes('debris');
        const isRoad = key.includes('road');
        const isBuilding = key.includes('building');
        const isBridge = key.includes('bridge');
        const isSettlement = key.includes('settlement');

        const color = isFlood ? LAYER_COLORS.flood
          : isDebris ? LAYER_COLORS.debris
          : isRoad ? LAYER_COLORS.roads
          : isBuilding ? LAYER_COLORS.buildings
          : isBridge ? LAYER_COLORS.bridges
          : isSettlement ? LAYER_COLORS.settlements
          : '#666666';

        const geoLayer = L.geoJSON(geojson, {
          style: {
            color,
            weight: isFlood ? 1 : 1.5,
            fillOpacity: isFlood ? 0.4 : 0.2,
            fillColor: color,
          },
          onEachFeature: (feature, lyr) => {
            if (feature.properties && Object.keys(feature.properties).length > 0) {
              const props = feature.properties;
              const rows = Object.entries(props)
                .filter(([, v]) => v != null)
                .map(([k, v]) => `<tr><td style="color:#52616b;padding-right:8px">${k}</td><td>${v}</td></tr>`)
                .join('');
              lyr.bindPopup(`<table style="font-size:12px;border-collapse:collapse">${rows}</table>`, { maxWidth: 300 });
            }
          },
        });

        geojsonLayersRef.current[key] = geoLayer;

        // Show/hide based on initial visibility
        const shouldShow = visibleLayers[key] !== false;
        if (shouldShow) geoLayer.addTo(map);
      } catch { /* ignore load error */ }
    });
  }, [layers, jobId, visibleLayers]);

  // Toggle layer visibility
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    Object.entries(geojsonLayersRef.current).forEach(([key, layer]) => {
      const visible = visibleLayers[key] !== false;
      if (visible && !map.hasLayer(layer)) {
        layer.addTo(map);
      } else if (!visible && map.hasLayer(layer)) {
        map.removeLayer(layer);
      }
    });
  }, [visibleLayers]);

  return (
    <div ref={mapDivRef} style={{ width: '100%', height: '100%', minHeight: 400 }} />
  );
}
