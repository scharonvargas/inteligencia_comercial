
import React from 'react';
import { MapContainer, TileLayer, Marker, Popup } from 'react-leaflet';
import { MapPin, X, ExternalLink, AlertTriangle } from 'lucide-react';
import { BusinessEntity } from '../types';

interface LocationModalProps {
  biz: BusinessEntity;
  onClose: () => void;
}

export const LocationModal: React.FC<LocationModalProps> = ({ biz, onClose }) => {
  if (!biz.lat || !biz.lng) return null;

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-950/80 backdrop-blur-sm p-4 animate-fadeIn" onClick={onClose}>
      <div className="bg-slate-800 w-full max-w-lg rounded-xl border border-slate-700 shadow-2xl overflow-hidden relative" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between p-4 bg-slate-900/50 border-b border-slate-700">
          <div className="flex items-center gap-2">
            <MapPin className="text-brand-500" size={20} />
            <h3 className="text-slate-100 font-bold">{biz.name}</h3>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-white transition-colors p-1 hover:bg-slate-700 rounded-full">
            <X size={20} />
          </button>
        </div>
        <div className="h-64 w-full relative z-0">
          <MapContainer
            center={[biz.lat, biz.lng]}
            zoom={16}
            style={{ height: '100%', width: '100%' }}
          >
            <TileLayer
              attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
              url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
            />
            <Marker position={[biz.lat, biz.lng]}>
              <Popup>
                <div className="text-slate-800 font-sans text-sm">
                  <strong>{biz.name}</strong><br />
                  {biz.address}
                </div>
              </Popup>
            </Marker>
          </MapContainer>
        </div>
        <div className="p-4 bg-slate-800 text-sm">
          <p className="text-slate-300 mb-2 flex items-start gap-2">
            <MapPin size={16} className="shrink-0 mt-0.5 text-slate-500" />
            {biz.address}
          </p>
          <a
            href={`https://www.google.com/maps/search/?api=1&query=${biz.lat},${biz.lng}`}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-2 text-brand-400 hover:text-brand-300 hover:underline text-xs"
          >
            Abrir no Google Maps <ExternalLink size={12} />
          </a>
        </div>
      </div>
    </div>
  );
};
