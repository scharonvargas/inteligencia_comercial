import React, { useState, useEffect, useRef } from 'react';
import { MapPin, Loader2, Globe, Navigation } from 'lucide-react';

interface AddressAutocompleteProps {
  value: string;
  onChange: (val: string) => void;
  onLocationSelect?: (lat: number, lng: number) => void;
  disabled?: boolean;
  placeholder?: string;
  className?: string;
}

interface SuggestionResult {
  place_id: string | number;
  display_name: string;
  main_text?: string;
  secondary_text?: string;
  lat: string;
  lon: string;
  source: 'google' | 'osm';
  typeStrength: number; // 3 = Rua/Endereço, 2 = Bairro/POI, 1 = Cidade/Estado
}

interface CacheEntry {
  timestamp: number;
  data: SuggestionResult[];
}

// Configuração do Cache
const CACHE_TTL = 15 * 60 * 1000; // 15 minutos em milissegundos
const suggestionCache: Record<string, CacheEntry> = {};

export const AddressAutocomplete: React.FC<AddressAutocompleteProps> = ({
  value,
  onChange,
  onLocationSelect,
  disabled,
  placeholder,
  className
}) => {
  const [suggestions, setSuggestions] = useState<SuggestionResult[]>([]);
  const [isOpen, setIsOpen] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const wrapperRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (wrapperRef.current && !wrapperRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [wrapperRef]);

  // Função auxiliar para calcular relevância do tipo de local
  const getGoogleTypeStrength = (types: string[]): number => {
    if (types.includes('street_address') || types.includes('route') || types.includes('premise')) return 3;
    if (types.includes('sublocality') || types.includes('neighborhood') || types.includes('point_of_interest')) return 2;
    return 1;
  };

  const getOsmTypeStrength = (type: string, category: string): number => {
    if (category === 'highway' || type === 'house' || type === 'residential') return 3;
    if (category === 'place' && (type === 'neighbourhood' || type === 'suburb')) return 2;
    return 1;
  };

  useEffect(() => {
    // Debounce de 300ms
    const delayDebounceFn = setTimeout(async () => {
      if (value.length > 3 && isOpen) {
        const cacheKey = value.trim().toLowerCase();

        // 1. VERIFICAÇÃO DE CACHE COM TTL
        if (suggestionCache[cacheKey]) {
          const entry = suggestionCache[cacheKey];
          const isExpired = Date.now() - entry.timestamp > CACHE_TTL;

          if (!isExpired) {
            setSuggestions(entry.data);
            setIsLoading(false);
            return;
          } else {
            // Remove entrada expirada
            delete suggestionCache[cacheKey];
          }
        }

        setIsLoading(true);
        const apiKey = process.env.API_KEY;
        let googleSuccess = false;
        let resultsToCache: SuggestionResult[] = [];

        // 2. TENTATIVA GOOGLE GEOCODING
        if (apiKey) {
            try {
                const googleRes = await fetch(
                    `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(value)}&region=br&language=pt-BR&key=${apiKey}`
                );
                const googleData = await googleRes.json();

                if (googleData.status === 'OK' && googleData.results.length > 0) {
                    const mappedResults: SuggestionResult[] = googleData.results.map((item: any) => ({
                        place_id: item.place_id,
                        display_name: item.formatted_address,
                        main_text: item.address_components[0]?.long_name || item.formatted_address.split(',')[0],
                        secondary_text: item.formatted_address,
                        lat: item.geometry.location.lat.toString(),
                        lon: item.geometry.location.lng.toString(),
                        source: 'google',
                        typeStrength: getGoogleTypeStrength(item.types)
                    }));
                    
                    // Ordena: Mais específicos primeiro (Ruas antes de Cidades)
                    mappedResults.sort((a, b) => b.typeStrength - a.typeStrength);
                    
                    resultsToCache = mappedResults;
                    setSuggestions(mappedResults);
                    googleSuccess = true;
                }
            } catch (e) {
                // Falha silenciosa
            }
        }

        // 3. FALLBACK OPENSTREETMAP
        if (!googleSuccess) {
            try {
              const osmRes = await fetch(
                `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(value)}&addressdetails=1&limit=5&countrycodes=br`
              );
              const osmData = await osmRes.json();
              
              const mappedResults: SuggestionResult[] = osmData.map((item: any) => ({
                  place_id: item.place_id,
                  display_name: item.display_name,
                  main_text: item.address?.road || item.display_name.split(',')[0],
                  secondary_text: item.display_name,
                  lat: item.lat,
                  lon: item.lon,
                  source: 'osm',
                  typeStrength: getOsmTypeStrength(item.type, item.category || '')
              }));
              
              // Ordena: Mais específicos primeiro
              mappedResults.sort((a, b) => b.typeStrength - a.typeStrength);

              resultsToCache = mappedResults;
              setSuggestions(mappedResults);
            } catch (error) {
              console.error("Erro ao buscar endereço (OSM):", error);
              setSuggestions([]);
            }
        }
        
        // Salva no cache com Timestamp se houver resultados
        if (resultsToCache.length > 0) {
          suggestionCache[cacheKey] = {
            timestamp: Date.now(),
            data: resultsToCache
          };
        }

        setIsLoading(false);
      } else if (value.length <= 3) {
        setSuggestions([]);
        setIsLoading(false);
      }
    }, 300); 

    return () => clearTimeout(delayDebounceFn);
  }, [value, isOpen]);

  const handleSelect = (item: SuggestionResult) => {
    onChange(item.display_name);
    if (onLocationSelect) {
        onLocationSelect(parseFloat(item.lat), parseFloat(item.lon));
    }
    setIsOpen(false);
    setSuggestions([]);
  };

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    onChange(e.target.value);
    if (!isOpen) setIsOpen(true);
    if (e.target.value.length > 3) setIsLoading(true);
  };

  return (
    <div ref={wrapperRef} className="relative w-full">
      <input
        type="text"
        value={value}
        onChange={handleChange}
        onFocus={() => value.length > 2 && setIsOpen(true)}
        placeholder={placeholder}
        disabled={disabled}
        className={className}
        autoComplete="off"
      />
      
      {isLoading && (
        <div className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 animate-spin">
          <Loader2 size={16} />
        </div>
      )}

      {isOpen && suggestions.length > 0 && (
        <ul className="absolute z-50 w-full bg-slate-800 border border-slate-700 rounded-lg mt-1 shadow-2xl max-h-60 overflow-y-auto custom-scrollbar animate-fadeIn">
          {suggestions.map((item) => (
            <li
              key={item.place_id}
              onClick={() => handleSelect(item)}
              className="px-4 py-3 hover:bg-slate-700 cursor-pointer border-b border-slate-700/50 last:border-none flex items-start gap-3 transition-colors text-left"
            >
              {item.typeStrength === 3 ? (
                 <MapPin size={16} className="mt-1 text-brand-400 shrink-0" />
              ) : item.typeStrength === 2 ? (
                 <Navigation size={16} className="mt-1 text-amber-400 shrink-0" />
              ) : (
                 <Globe size={16} className="mt-1 text-slate-500 shrink-0" />
              )}
              
              <div className="overflow-hidden">
                <span className={`text-sm font-medium block truncate ${item.typeStrength === 3 ? 'text-white' : 'text-slate-300'}`}>
                   {item.main_text}
                </span>
                <span className="text-slate-400 text-xs block truncate">
                  {item.secondary_text}
                </span>
              </div>
            </li>
          ))}
          <li className="px-2 py-1 text-[10px] text-right text-slate-600 bg-slate-900/50 rounded-b-lg flex justify-between">
            <span>{suggestions[0]?.source === 'google' ? 'Google Maps' : 'OpenStreetMap'}</span>
            <span>VeriCorp Geo Precision</span>
          </li>
        </ul>
      )}
    </div>
  );
};