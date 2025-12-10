import React, { useMemo } from 'react';
import { MapContainer, TileLayer, Marker, Popup } from 'react-leaflet';
import MarkerClusterGroup from 'react-leaflet-cluster';
import L from 'leaflet';
import { BusinessEntity, BusinessStatus } from '../types';
import { MapPin, Phone, ExternalLink } from 'lucide-react';

// Correção para ícones padrão do Leaflet
delete (L.Icon.Default.prototype as any)._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png',
  iconUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png',
  shadowUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
});

interface ResultsMapProps {
  data: BusinessEntity[];
}

export const ResultsMap: React.FC<ResultsMapProps> = ({ data }) => {
  const mapCenter: [number, number] = useMemo(() => {
    const validPoints = data.filter(d => d.lat && d.lng);
    
    if (validPoints.length === 0) return [-23.5505, -46.6333]; // Default SP

    const latSum = validPoints.reduce((sum, d) => sum + (d.lat || 0), 0);
    const lngSum = validPoints.reduce((sum, d) => sum + (d.lng || 0), 0);
    return [latSum / validPoints.length, lngSum / validPoints.length];
  }, [data]);

  const validData = data.filter(d => d.lat !== undefined && d.lng !== undefined);

  const getStatusColor = (status: BusinessStatus) => {
    switch (status) {
      case BusinessStatus.VERIFIED: return 'text-emerald-400 font-bold';
      case BusinessStatus.ACTIVE: return 'text-blue-400 font-bold';
      case BusinessStatus.SUSPICIOUS: return 'text-amber-400 font-bold';
      case BusinessStatus.CLOSED: return 'text-red-400 font-bold';
      default: return 'text-slate-400 font-bold';
    }
  };

  return (
    <div className="w-full h-96 bg-slate-800 rounded-xl border border-slate-700 overflow-hidden shadow-lg mb-8 relative z-0">
      <MapContainer 
        center={mapCenter} 
        zoom={12} 
        style={{ height: '100%', width: '100%', zIndex: 0 }}
      >
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
          className="map-tiles"
        />
        
        {/* Cluster Group Wrapper */}
        <MarkerClusterGroup
          chunkedLoading
          showCoverageOnHover={false}
          maxClusterRadius={40}
        >
          {validData.map((biz) => (
            <Marker 
              key={biz.id} 
              position={[biz.lat!, biz.lng!]}
            >
              <Popup>
                <div className="min-w-[200px] text-slate-100 font-sans">
                  <h3 className="text-lg font-bold border-b border-slate-600 pb-1 mb-2">{biz.name}</h3>
                  <div className="text-sm space-y-1">
                    <p className="flex items-center gap-1">
                      <span className={getStatusColor(biz.status)}>{biz.status}</span>
                    </p>
                    <p className="text-slate-400 italic">{biz.category}</p>
                    <p className="flex items-start gap-1 text-slate-300">
                      <MapPin size={14} className="mt-1 shrink-0 text-slate-400" />
                      {biz.address}
                    </p>
                    {biz.phone && (
                       <p className="flex items-center gap-1 text-slate-300">
                          <Phone size={14} className="text-slate-400" />
                          {biz.phone}
                       </p>
                    )}
                    {biz.website && (
                      <a href={biz.website} target="_blank" rel="noopener" className="flex items-center gap-1 text-blue-400 hover:text-blue-300 hover:underline mt-2">
                         <ExternalLink size={14} /> Visitar Site
                      </a>
                    )}
                  </div>
                </div>
              </Popup>
            </Marker>
          ))}
        </MarkerClusterGroup>
      </MapContainer>
      
      <div className="absolute top-2 right-2 z-[1000] bg-slate-900/90 p-2 rounded border border-slate-700 text-xs text-slate-300">
         Mostrando {validData.length} pontos mapeados de {data.length}
      </div>
    </div>
  );
};